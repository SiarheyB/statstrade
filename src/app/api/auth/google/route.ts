import { NextResponse } from "next/server";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { createSessionCookie, createPendingCookie } from "@/lib/auth";
import { badRequest, serverError } from "@/lib/api";

const schema = z.object({ credential: z.string().min(10) });

// Google's public keys for verifying the id_token signature (cached by jose).
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

// Sign in / sign up with Google. The client (Google Identity Services) returns a
// signed id_token; we verify it server-side, then find or create the user.
export async function POST(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return serverError("Google вход не настроен на сервере");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Некорректный запрос");

  let email: string;
  let googleId: string;
  let name: string | null;
  try {
    const { payload } = await jwtVerify(parsed.data.credential, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    if (!payload.email || payload.email_verified === false) {
      return badRequest("Google не подтвердил email");
    }
    email = String(payload.email).toLowerCase();
    googleId = String(payload.sub);
    name = payload.name ? String(payload.name) : null;
  } catch {
    return badRequest("Не удалось проверить вход через Google");
  }

  try {
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // New Google-only account (no password).
      user = await prisma.user.create({ data: { email, googleId, name } });
    } else if (!user.googleId) {
      // Existing email account — link the Google identity.
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
    }

    // Respect 2FA: even via Google, require the TOTP code if enabled.
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      await createPendingCookie(user.id);
      return NextResponse.json({ twoFactorRequired: true });
    }

    await createSessionCookie({ userId: user.id, email: user.email });
    return NextResponse.json({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
