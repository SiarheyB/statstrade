
/**
 * «Как это работает» — вместо прежней сетки 3×3 из одинаковых плиток.
 *
 * Плитки были равны по весу, размеру и оформлению: девять одинаковых карточек
 * читались как стена, ничего не выделялось, и главной вещи — ежедневного
 * отбора уровней — там вообще не было.
 *
 * Здесь фичи разложены по циклу работы трейдера (до сделки → после сделки →
 * всегда), и каждая колонка открывается СВОИМ визуалом одинаковой высоты:
 * воронка отбора, кривая капитала, шкалы риска. Это отвечает на вопрос
 * «как оно выглядит», не требуя скриншотов, и держит блок ровным.
 */

type Item = { title: string; text: string; lead?: boolean };

function Column({
  kicker,
  title,
  items,
  children,
}: {
  kicker: string;
  title: string;
  items: Item[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="card p-2.5 mb-3.5">{children}</div>

      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">{kicker}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <h3 className="mb-3 text-[17px] font-semibold tracking-tight">{title}</h3>

      {items.map((item) => (
        <div key={item.title} className="grid grid-cols-[18px_1fr] gap-3 border-t border-border py-2.5 first:border-t-0 first:pt-0">
          <span className={`mt-2 h-1.5 w-1.5 rounded-full ${item.lead ? "bg-accent" : "bg-border-strong"}`} />
          <div>
            <h4 className={`text-[13.5px] font-semibold ${item.lead ? "text-accent" : ""}`}>{item.title}</h4>
            <p className="mt-0.5 text-xs leading-relaxed text-faint">{item.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Воронка отбора: сколько пар сканируется и сколько доходит до выдачи.
 * Свечи с уровнем здесь были бы третьим таким же графиком подряд — карточка
 * сигнала дня прямо над этим блоком уже их показывает. Воронка же объясняет
 * ровно то, чего не видно больше нигде: масштаб отсева.
 */
function ScreeningFunnel({ scanned, setups, t }: { scanned: number; setups: number; t: (k: string, v?: Record<string, string | number>) => string }) {
  // Узкая полоса выдачи не должна схлопываться в невидимую точку: 689 → 9 это
  // 1,3%, поэтому у неё есть минимальная ширина, а честность даёт подпись.
  const width = Math.max(6, scanned > 0 ? (setups / scanned) * 100 : 6);
  const passedWidth = `${width}%`;
  return (
    <svg viewBox="0 0 300 74" className="block h-[74px] w-full" aria-hidden="true">
      <text x="2" y="12" fill="var(--color-muted)" fontSize="9">{t("features.funnel.scanned")}</text>
      <text x="298" y="12" fill="var(--color-fg)" fontSize="10" textAnchor="end" fontFamily="ui-monospace, monospace">
        {scanned}
      </text>
      <rect x="2" y="18" width="296" height="12" rx="3" fill="var(--color-surface-2)" />
      <rect x="2" y="18" width="296" height="12" rx="3" fill="var(--color-accent)" opacity="0.28" />

      {/* Трапеция-переход: наглядно показывает, что от левого края остаётся
          узкая полоска — это и есть отсев. */}
      <path d={`M2 32 L298 32 L${2 + (296 * width) / 100} 44 L2 44 Z`} fill="var(--color-accent)" opacity="0.12" />

      <text x="2" y="58" fill="var(--color-muted)" fontSize="9">{t("features.funnel.passed")}</text>
      <text x="298" y="58" fill="var(--color-accent)" fontSize="10" textAnchor="end" fontFamily="ui-monospace, monospace">
        {setups}
      </text>
      <rect x="2" y="62" width={passedWidth} height="10" rx="3" fill="var(--color-accent)" />
    </svg>
  );
}

/** Кривая капитала — иллюстрация, а не данные конкретного счёта. */
function EquityCurve() {
  return (
    <svg viewBox="0 0 300 74" className="block h-[74px] w-full" aria-hidden="true">
      <defs>
        <linearGradient id="landing-equity" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-profit)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--color-profit)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M4 60 L37 55 L70 58 L103 44 L136 48 L169 34 L202 38 L235 24 L268 27 L296 12 L296 70 L4 70 Z"
        fill="url(#landing-equity)"
      />
      <path
        d="M4 60 L37 55 L70 58 L103 44 L136 48 L169 34 L202 38 L235 24 L268 27 L296 12"
        fill="none"
        stroke="var(--color-profit)"
        strokeWidth="1.6"
      />
      <circle cx="296" cy="12" r="2.6" fill="var(--color-profit)" />
    </svg>
  );
}

/** Шкалы риск-менеджера: жёлтая — предупреждение, зелёная — в норме. */
function RiskBars({ daily, perTrade }: { daily: string; perTrade: string }) {
  return (
    <svg viewBox="0 0 300 74" className="block h-[74px] w-full" aria-hidden="true">
      <text x="2" y="12" fill="var(--color-muted)" fontSize="9">{daily}</text>
      <text x="298" y="12" fill="var(--color-warn)" fontSize="9" textAnchor="end" fontFamily="ui-monospace, monospace">
        70%
      </text>
      <rect x="2" y="18" width="296" height="9" rx="4.5" fill="var(--color-surface-2)" />
      <rect x="2" y="18" width="207" height="9" rx="4.5" fill="var(--color-warn)" />
      <text x="2" y="48" fill="var(--color-muted)" fontSize="9">{perTrade}</text>
      <text x="298" y="48" fill="var(--color-profit)" fontSize="9" textAnchor="end" fontFamily="ui-monospace, monospace">
        0,7R / 2R
      </text>
      <rect x="2" y="54" width="296" height="9" rx="4.5" fill="var(--color-surface-2)" />
      <rect x="2" y="54" width="104" height="9" rx="4.5" fill="var(--color-profit)" />
    </svg>
  );
}

export default function LandingFeatures({
  metricsCount,
  symbolsScanned,
  setupsFound,
  exchanges,
  t,
}: {
  metricsCount: number;
  symbolsScanned: number;
  setupsFound: number;
  exchanges: string[];
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <section className="max-w-6xl mx-auto px-6 py-14">
      <h2 className="text-[22px] font-semibold tracking-tight">{t("features.title")}</h2>
      <p className="mt-1 mb-6 text-sm text-faint">{t("features.subtitle")}</p>

      <div className="grid gap-6 lg:grid-cols-3">
        <Column
          kicker={t("features.before.kicker")}
          title={t("features.before.title")}
          items={[
            {
              title: t("features.before.f1.title"),
              text: t("features.before.f1.text", { symbols: symbolsScanned }),
              lead: true,
            },
            { title: t("features.before.f2.title"), text: t("features.before.f2.text") },
            { title: t("features.before.f3.title"), text: t("features.before.f3.text") },
          ]}
        >
          <ScreeningFunnel scanned={symbolsScanned} setups={setupsFound} t={t} />
        </Column>

        <Column
          kicker={t("features.after.kicker")}
          title={t("features.after.title")}
          items={[
            { title: t("features.after.f1.title", { count: metricsCount }), text: t("features.after.f1.text"), lead: true },
            { title: t("features.after.f2.title"), text: t("features.after.f2.text") },
            { title: t("features.after.f3.title"), text: t("features.after.f3.text") },
          ]}
        >
          <EquityCurve />
        </Column>

        <Column
          kicker={t("features.always.kicker")}
          title={t("features.always.title")}
          items={[
            { title: t("features.always.f1.title"), text: t("features.always.f1.text"), lead: true },
            { title: t("features.always.f2.title"), text: t("features.always.f2.text") },
            { title: t("features.always.f3.title"), text: t("features.always.f3.text") },
          ]}
        >
          <RiskBars daily={t("features.risk.daily")} perTrade={t("features.risk.perTrade")} />
        </Column>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
        <span className="mr-1 text-xs text-faint">{t("features.connect")}</span>
        {exchanges.map((name) => (
          <span key={name} className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium">
            {name}
          </span>
        ))}
        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
          {t("features.mt")}
        </span>
      </div>
    </section>
  );
}
