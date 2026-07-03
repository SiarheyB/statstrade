import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError, sharedCacheHeaders } from "@/lib/api";

export const dynamic = "force-dynamic";

// Список включённых кошельков для доната + QR-код каждого адреса (как в
// 2FA-setup — data URL, генерируется на сервере). Список почти не меняется,
// поэтому можно недолго кэшировать на edge — но данные не зависят от юзера,
// только от читаемости требует сессии (как и остальные общие данные проекта).
const CACHE = sharedCacheHeaders(300, 3600);

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const wallets = await prisma.donateWallet.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
    });
    const items = await Promise.all(
      wallets.map(async (w) => ({
        id: w.id,
        network: w.network,
        coin: w.coin,
        address: w.address,
        qr: await QRCode.toDataURL(w.address, { margin: 1, width: 220 }),
      })),
    );
    return NextResponse.json({ wallets: items }, { headers: CACHE });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
