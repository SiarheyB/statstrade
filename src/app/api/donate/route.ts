import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

// Список включённых кошельков для доната + QR-код каждого адреса (как в
// 2FA-setup — data URL, генерируется на сервере).
//
// НЕ кэшируем намеренно. Раньше тут стоял sharedCacheHeaders(300, 3600), и
// админ, добавивший первый кошелёк, ещё до часа видел в модалке «кошельки не
// настроены»: браузер отдавал сохранённый пустой ответ (stale-while-revalidate)
// и не спрашивал сервер. Сбросить этот кэш из админки нечем, а запрос идёт
// только по клику на «Донат» — экономить тут нечего.
const NO_CACHE = { "Cache-Control": "no-store" };

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
    return NextResponse.json({ wallets: items }, { headers: NO_CACHE });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
