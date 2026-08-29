import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { prisma } from "@/lib/db";
import { getFeatureConfig } from "@/lib/featureConfig";
import { getServerT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/provider";
import LocaleMenu from "@/components/LocaleMenu";
import MentorTrades from "@/components/mentor/MentorTrades";
import {
  computePublicSummary,
  computePublicTrades,
  formatRangeDate,
  isExpired,
  touchShareView,
  PUBLIC_TRADES_LIMIT,
} from "@/lib/mentorShare";

export const dynamic = "force-dynamic";

// ПУБЛИЧНАЯ страница без авторизации (вне /dashboard — middleware её не
// закрывает). «Режим ментора»: журнал сделок только на чтение по ссылке с
// длинным токеном, чтобы показать наставнику свою торговлю, не отдавая вход
// в аккаунт.
//
// Ни одной денежной величины: ни в сводке, ни в списке сделок. Ментор смотрит
// на то, КАК торгуют (паттерн, точка входа, ошибка, скриншот), а размер счёта
// и заработок — не его дело. Поэтому здесь нет ни P&L, ни комиссий, ни объёма,
// ни кривой эквити (она в долларах) — эти поля даже не выбираются из базы.
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getServerT();

  const feature = await getFeatureConfig("mentorMode");
  if (!feature.enabled) return <Unavailable t={t} />;

  const link = await prisma.shareLink.findUnique({ where: { token } });
  // Истёкшая ссылка выглядит для гостя так же, как отозванная: по чужой ссылке
  // незачем понимать, была она когда-то живой или её вовсе не существовало.
  if (!link || link.revokedAt || isExpired(link.expiresAt)) return <Unavailable t={t} />;

  // Отметка «открывали» — не чаще раза в минуту на ссылку: раньше это была
  // запись в БД на каждый показ страницы (см. touchShareView).
  touchShareView(link.id);

  // link.accountId = null — ссылка на все счета сразу; обе границы null — за всё время.
  const range = { from: link.periodFrom, to: link.periodTo };
  const [s, accounts] = await Promise.all([
    computePublicSummary(link.userId, link.accountId, range),
    computePublicTrades(link.userId, link.accountId, range),
  ]);
  const shown = accounts.reduce((n, a) => n + a.trades.length, 0);
  // Что выбрал автор ссылки в календаре — показываем отдельно от фактических
  // дат первой и последней сделки ниже.
  const chosenRange = link.periodFrom || link.periodTo
    ? [
        formatRangeDate(link.periodFrom, "from") || "…",
        formatRangeDate(link.periodTo, "to") || "…",
      ].join(" – ")
    : null;
  const period =
    s.firstTradeAt && s.lastTradeAt
      ? `${s.firstTradeAt.slice(0, 10)} – ${s.lastTradeAt.slice(0, 10)}`
      : null;

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border px-4 py-3 glass-panel sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <BarChart3 size={18} />
          </span>
          TradeStats
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-faint sm:inline">{t("mentorPage.readOnly")}</span>
          <LocaleMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[100rem] flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {link.label || t("mentorPage.defaultTitle")}
        </h1>
        <p className="mt-1 text-sm text-faint">
          {t("mentorPage.subtitle", { n: s.totalTrades })}
          {/* Если автор ссылки задал период — показываем именно его. Иначе
              подставляем фактические даты первой и последней сделки. */}
          {chosenRange ?? period ? ` · ${chosenRange ?? period}` : ""}
        </p>

        {/* fmtPct тут не годится: он ставит «+» перед любым положительным
            числом, а доля прибыльных со знаком плюс и «просадка +0.5%» —
            бессмыслица. winRate и maxDrawdownPct приходят уже в процентах
            (0–100), просадка — положительной величиной потери. */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label={t("mentorPage.winRate")} value={`${s.winRate.toFixed(0)}%`} />
          <Stat label={t("mentorPage.profitFactor")} value={s.profitFactor.toFixed(2)} />
          <Stat
            label={t("mentorPage.maxDrawdown")}
            value={s.maxDrawdownPct > 0 ? `−${s.maxDrawdownPct.toFixed(1)}%` : "0%"}
            tone="loss"
          />
        </div>

        {accounts.length === 0 ? (
          <div className="card mt-5 p-10 text-center text-sm text-muted">{t("mentorPage.noTrades")}</div>
        ) : (
          <MentorTrades accounts={accounts} />
        )}

        {shown >= PUBLIC_TRADES_LIMIT && (
          <p className="mt-3 text-xs text-faint">{t("mentorPage.limit", { n: PUBLIC_TRADES_LIMIT })}</p>
        )}

        <p className="mt-8 text-center text-xs text-faint">{t("mentorPage.footer")}</p>
      </main>
    </div>
  );
}

function Unavailable({ t }: { t: T }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="text-center text-muted">
        <p className="text-lg font-medium">{t("mentorPage.unavailable")}</p>
        <p className="mt-1 text-sm text-faint">{t("mentorPage.unavailableHint")}</p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-faint">{label}</div>
      <div
        className={`text-lg font-semibold tabular-nums ${
          tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
