import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSessionCookie, createPendingCookie } from "@/lib/auth";
import { verifyGoogleCredential, GoogleAuthError } from "@/lib/google";
import { badRequest, serverError, tooManyRequests } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { kickUserSync } from "@/lib/sync";

const schema = z.object({ credential: z.string().min(10).max(4096) });

// Sign in / sign up with Google. The client (Google Identity Services) returns a
// signed id_token; we verify it server-side, then find or create the user.
export async function POST(req: Request) {
  const rl = rateLimit(`google:${clientIp(req)}`, 20, 10 * 60_000);
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Некорректный запрос");

  let identity;
  try {
    identity = await verifyGoogleCredential(parsed.data.credential);
  } catch (err) {
    if (err instanceof GoogleAuthError && err.message === "not-configured") {
      return serverError("Google вход не настроен на сервере");
    }
    return badRequest("Не удалось проверить вход через Google");
  }

  try {
    // Match by linked Google id first, then by email — so an account that linked
    // Google in settings works even if its email differs from the Google email.
    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId: identity.googleId }, { email: identity.email }] },
    });
    if (!user) {
      user = await prisma.user.create({
        data: { email: identity.email, googleId: identity.googleId, name: identity.name },
      });
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: identity.googleId },
      });
    }

    // Respect 2FA: even via Google, require the TOTP code if enabled.
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      await createPendingCookie(user.id);
      return NextResponse.json({ twoFactorRequired: true });
    }

    await createSessionCookie({ userId: user.id, email: user.email }, user.tokenVersion);
    kickUserSync(user.id); // freshen accounts on return, fire-and-forget
    return NextResponse.json({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
