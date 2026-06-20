import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { generateSecret, otpauthURL } from "@/lib/totp";

// Begin enabling 2FA: generate a fresh secret, store it (still disabled until the
// user confirms a code), and return the QR + manual key for the authenticator app.
export async function POST() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const existing = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { twoFactorEnabled: true },
    });
    if (existing?.twoFactorEnabled) {
      return badRequest("Двухфакторная аутентификация уже включена");
    }

    const secret = generateSecret();
    await prisma.user.update({
      where: { id: user.userId },
      data: { twoFactorSecret: encrypt(secret), twoFactorEnabled: false },
    });

    const otpauth = otpauthURL(secret, user.email);
    const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 220 });
    return NextResponse.json({ secret, otpauth, qr });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
