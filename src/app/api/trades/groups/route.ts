import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { recomputeRRForAccount } from "@/lib/analytics/rr";
import { normalizeSymbol } from "@/lib/mt/symbols";
import {
  aggregateGroup,
  validateSelection,
  type GroupMember,
} from "@/lib/trades/grouping";

// Объединение нескольких импортированных позиций в одну сделку и обратная
// операция. См. lib/trades/grouping.ts — там и логика свёртки, и объяснение,
// почему группа хранится строкой той же таблицы.
//
// POST   { tradeIds: string[] }  → создать группу
// DELETE ?groupKey=<id строки-группы> → разгруппировать

// Ключ сделки в TradeAnnotation — "accountId:externalId" (см. tradeList.ts).
const keyOf = (t: { accountId: string; externalId: string }) =>
  `${t.accountId}:${t.externalId}`;

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const body = (await req.json()) as { tradeIds?: unknown };
    const ids = Array.isArray(body.tradeIds)
      ? body.tradeIds.filter((v): v is string => typeof v === "string")
      : [];
    if (ids.length < 2) {
      return NextResponse.json({ error: "tooFew" }, { status: 400 });
    }

    // Строки приходят с клиента по ключу "accountId:externalId" — тому же, по
    // которому список сделок отдаёт id. Владение проверяем через счета
    // пользователя, а не доверяем идентификаторам из запроса.
    const accounts = await prisma.exchangeAccount.findMany({
      where: { userId: user.userId },
      select: { id: true, accountCurrency: true },
    });
    const owned = new Map(accounts.map((a) => [a.id, a]));

    const pairs = ids.map((id) => {
      const sep = id.indexOf(":");
      return { accountId: id.slice(0, sep), externalId: id.slice(sep + 1) };
    });
    if (pairs.some((p) => !owned.has(p.accountId))) return unauthorized();

    const rows = await prisma.importedTrade.findMany({
      where: { OR: pairs.map((p) => ({ accountId: p.accountId, externalId: p.externalId })) },
    });
    if (rows.length !== ids.length) {
      return NextResponse.json({ error: "notFound" }, { status: 404 });
    }
    // Сетка живёт на одном счёте: средняя цена входа по позициям с разных
    // счетов бессмысленна, да и 1R у счетов разный.
    const accountId = rows[0].accountId;
    if (rows.some((r) => r.accountId !== accountId)) {
      return NextResponse.json({ error: "mixedAccounts" }, { status: 400 });
    }
    // Уже объединённое повторно не группируем — сначала надо разгруппировать.
    if (rows.some((r) => r.groupId || r.isGroup)) {
      return NextResponse.json({ error: "alreadyGrouped" }, { status: 409 });
    }

    const check = validateSelection(
      rows.map((r) => ({ ...(r as unknown as GroupMember), symbol: r.symbol })),
    );
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 400 });
    }

    const agg = aggregateGroup(rows as unknown as GroupMember[]);
    const account = owned.get(accountId)!;
    const info = normalizeSymbol(rows[0].symbol, account.accountCurrency ?? "USD");
    const pips =
      info.pipSize > 0
        ? Number(
            (((agg.exitPrice - agg.entryPrice) / info.pipSize) *
              (agg.side === "long" ? 1 : -1)).toFixed(1),
          )
        : null;

    // Строка-группа и проставление groupId — одной транзакцией: если бы
    // участники успели пометиться, а строка-группа не создалась, их PnL просто
    // исчез бы из статистики.
    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.importedTrade.create({
        data: {
          accountId,
          source: rows[0].source,
          // Префикс "group:" отличает синтетическую строку от тикета брокера и
          // не конфликтует с (accountId, externalId) реального импорта.
          externalId: `group:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          symbol: rows[0].symbol,
          base: rows[0].base,
          quote: rows[0].quote,
          market: rows[0].market,
          side: agg.side,
          lots: agg.lots,
          qty: agg.qty,
          contractSize: rows[0].contractSize,
          entryTime: agg.entryTime,
          exitTime: agg.exitTime,
          entryPrice: agg.entryPrice,
          exitPrice: agg.exitPrice,
          stopLoss: agg.stopLoss,
          takeProfit: agg.takeProfit,
          commission: agg.commission,
          swap: agg.swap,
          grossProfit: agg.grossProfit,
          netPnl: agg.netPnl,
          pips,
          currency: rows[0].currency,
          comment: rows[0].comment,
          isGroup: true,
          memberCount: agg.memberCount,
          stopSpread: agg.stopSpread,
          stopMin: agg.stopMin,
          stopMax: agg.stopMax,
        },
      });
      await tx.importedTrade.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { groupId: created.id },
      });
      return created;
    });

    // Аннотации участников переносим на группу: заполнять паттерн и ошибку
    // пять раз человек не должен. Разные значения склеиваются, чтобы ничего
    // не потерять молча — что именно осталось, видно в карточке сделки.
    await mergeAnnotations(user.userId, rows, keyOf(group));

    // R группы считается заново от средних цен и суммарного лота, а не
    // складыванием R участников: сетка набрана так, что её общий стоп стоит
    // ровно 1R. Заодно пересобираются почасовые агрегаты.
    await recomputeRRForAccount(accountId);

    return NextResponse.json({ ok: true, groupKey: keyOf(group) });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Склеить аннотации участников в одну на группе. Непустые значения одного поля
// объединяются через « · », дубликаты убираются.
async function mergeAnnotations(
  userId: string,
  rows: { accountId: string; externalId: string }[],
  groupKey: string,
): Promise<void> {
  const keys = rows.map(keyOf);
  const existing = await prisma.tradeAnnotation.findMany({
    where: { userId, tradeKey: { in: keys } },
  });
  if (existing.length === 0) return;

  const join = (vals: (string | null | undefined)[]) => {
    const uniq = [...new Set(vals.filter((v): v is string => !!v && v.trim() !== ""))];
    return uniq.length ? uniq.join(" · ") : null;
  };
  const first = <T>(vals: (T | null | undefined)[]) => vals.find((v) => v != null) ?? null;

  const data = {
    entryPoint: join(existing.map((a) => a.entryPoint)),
    entryType: join(existing.map((a) => a.entryType)),
    mistake: join(existing.map((a) => a.mistake)),
    pattern: join(existing.map((a) => a.pattern)),
    note: join(existing.map((a) => a.note)),
    // Стоп группы берётся из агрегата, а не из аннотации участника: ручное
    // переопределение стопа у одной позиции сетки к средней не применимо.
    imageUrl: first(existing.map((a) => a.imageUrl)),
    imageProvider: first(existing.map((a) => a.imageProvider)),
    imageFileId: first(existing.map((a) => a.imageFileId)),
    imagePublicUrl: first(existing.map((a) => a.imagePublicUrl)),
  };
  await prisma.tradeAnnotation.upsert({
    where: { userId_tradeKey: { userId, tradeKey: groupKey } },
    create: { userId, tradeKey: groupKey, ...data },
    update: data,
  });
}

export async function DELETE(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const groupKey = new URL(req.url).searchParams.get("groupKey") ?? "";
    const sep = groupKey.indexOf(":");
    if (sep === -1) return NextResponse.json({ error: "badKey" }, { status: 400 });
    const accountId = groupKey.slice(0, sep);
    const externalId = groupKey.slice(sep + 1);

    const account = await prisma.exchangeAccount.findFirst({
      where: { id: accountId, userId: user.userId },
      select: { id: true },
    });
    if (!account) return unauthorized();

    const group = await prisma.importedTrade.findFirst({
      where: { accountId, externalId, isGroup: true },
      select: { id: true },
    });
    if (!group) return NextResponse.json({ error: "notFound" }, { status: 404 });

    // Удаление строки-группы снимает groupId с участников (FK ON DELETE SET
    // NULL), и позиции возвращаются в статистику по отдельности. Аннотация
    // группы уходит вместе с ней — у участников свои остались нетронутыми.
    await prisma.$transaction([
      prisma.importedTrade.delete({ where: { id: group.id } }),
      prisma.tradeAnnotation.deleteMany({ where: { userId: user.userId, tradeKey: groupKey } }),
    ]);
    await recomputeRRForAccount(accountId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
