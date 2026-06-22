# Graph Report - .  (2026-06-20)

## Corpus Check
- Corpus is ~42,057 words - fits in a single context window. You may not need a graph.

## Summary
- 447 nodes · 1155 edges · 22 communities (21 shown, 1 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 49 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_API Route Handlers|API Route Handlers]]
- [[_COMMUNITY_Exchange Sync (CCXT)|Exchange Sync (CCXT)]]
- [[_COMMUNITY_Analytics Engine|Analytics Engine]]
- [[_COMMUNITY_Risk Manager|Risk Manager]]
- [[_COMMUNITY_App Shell & i18n Core|App Shell & i18n Core]]
- [[_COMMUNITY_UI Components|UI Components]]
- [[_COMMUNITY_Overview Dashboard|Overview Dashboard]]
- [[_COMMUNITY_News Aggregation|News Aggregation]]
- [[_COMMUNITY_Charts|Charts]]
- [[_COMMUNITY_Trades Table|Trades Table]]
- [[_COMMUNITY_Trade Chart & Formatting|Trade Chart & Formatting]]
- [[_COMMUNITY_Metric Definitions|Metric Definitions]]
- [[_COMMUNITY_Auth Forms & Google|Auth Forms & Google]]
- [[_COMMUNITY_Account Settings|Account Settings]]
- [[_COMMUNITY_i18n Provider & News Page|i18n Provider & News Page]]
- [[_COMMUNITY_Journal & Shared Types|Journal & Shared Types]]
- [[_COMMUNITY_P&L Heatmap|P&L Heatmap]]
- [[_COMMUNITY_Accounts Page|Accounts Page]]
- [[_COMMUNITY_CSVPDF Export|CSV/PDF Export]]
- [[_COMMUNITY_Dashboard Navigation|Dashboard Navigation]]
- [[_COMMUNITY_Background Scheduler|Background Scheduler]]
- [[_COMMUNITY_Auth Middleware|Auth Middleware]]

## God Nodes (most connected - your core abstractions)
1. `useI18n()` - 56 edges
2. `getAuthUser()` - 45 edges
3. `unauthorized()` - 44 edges
4. `serverError()` - 40 edges
5. `badRequest()` - 39 edges
6. `T` - 32 edges
7. `fmtUsd()` - 17 edges
8. `decrypt()` - 12 edges
9. `DashboardPage()` - 11 edges
10. `createSessionCookie()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `POST()` --calls--> `syncChunk()`  [INFERRED]
  src/app/api/accounts/[id]/sync/route.ts → src/lib/sync.ts
- `GET()` --calls--> `getAuthUser()`  [INFERRED]
  src/app/api/risk/settings/route.ts → src/lib/api.ts
- `GET()` --calls--> `unauthorized()`  [INFERRED]
  src/app/api/risk/settings/route.ts → src/lib/api.ts
- `PUT()` --calls--> `badRequest()`  [INFERRED]
  src/app/api/risk/settings/route.ts → src/lib/api.ts
- `PUT()` --calls--> `getAuthUser()`  [INFERRED]
  src/app/api/risk/settings/route.ts → src/lib/api.ts

## Import Cycles
- None detected.

## Communities (22 total, 1 thin omitted)

### Community 0 - "API Route Handlers"
Cohesion: 0.07
Nodes (78): DELETE(), disableSchema, GET(), createSchema, GET(), POST(), safeDecrypt(), PUT() (+70 more)

### Community 1 - "Exchange Sync (CCXT)"
Cohesion: 0.08
Nodes (42): createExchange(), ExchangeCredentials, ExchangeId, ExchangeMeta, extractRealizedPnl(), fetchBalanceUsdt(), getPublicExchange(), isExchangeId() (+34 more)

### Community 2 - "Analytics Engine"
Cohesion: 0.09
Nodes (36): bucketStats(), computeMetrics(), DailyPoint, DOW, emptySide(), mean(), median(), MONTHS (+28 more)

### Community 3 - "Risk Manager"
Cohesion: 0.09
Nodes (29): RANK, RiskResp, STYLES, Account, AccountRisk, computeAccountRisk(), defaultRiskProfile(), emptyLimit() (+21 more)

### Community 4 - "App Shell & i18n Core"
Cohesion: 0.13
Nodes (19): TOTAL_METRICS, geistMono, generateMetadata(), manrope, RootLayout(), Home(), isLocale(), Locale (+11 more)

### Community 5 - "UI Components"
Cohesion: 0.17
Nodes (22): AccountForm(), ProgressBar(), StatusPill(), AnalyticsPage(), CalendarPage(), AuthForm(), Empty(), GoogleLinkSettings() (+14 more)

### Community 6 - "Overview Dashboard"
Cohesion: 0.13
Nodes (12): StatCard(), StatRow(), DashboardPage(), Filters, maxDaily(), minDaily(), RANGE_OPTIONS, winningDays() (+4 more)

### Community 7 - "News Aggregation"
Cohesion: 0.18
Nodes (16): asLang(), attrUrl(), clean(), decodeEntities(), getNews(), ingestSource(), Lang, lastFetchAttempt (+8 more)

### Community 8 - "Charts"
Cohesion: 0.15
Nodes (9): Bucket, EquityPoint, Bin, BreakdownChart(), DailyPnlChart(), DrawdownChart(), EquityChart(), Histogram() (+1 more)

### Community 9 - "Trades Table"
Cohesion: 0.16
Nodes (6): findRiskMistake(), dateStamp(), fmtSymbol(), Ann, SortKey, TradesPage()

### Community 10 - "Trade Chart & Formatting"
Cohesion: 0.23
Nodes (10): buildSchematic(), Candle, candleCache, noRealData, seeded(), fmtDate(), fmtMoney(), fmtNum() (+2 more)

### Community 11 - "Metric Definitions"
Cohesion: 0.22
Nodes (10): formatMetric(), METRIC_GROUPS, MetricDef, MetricFormat, MetricGroup, metricTone(), NumericMetricKey, Metrics (+2 more)

### Community 12 - "Auth Forms & Google"
Cohesion: 0.24
Nodes (3): GoogleId, GoogleSignInButton(), Window

### Community 13 - "Account Settings"
Cohesion: 0.20
Nodes (6): ChangePassword(), FLAG, LocaleMenu(), Setup, TwoFactorSettings(), GeneralSettingsPage()

### Community 14 - "i18n Provider & News Page"
Cohesion: 0.22
Nodes (8): Ctx, I18nContext, I18nProvider(), setFormatLocale(), Item, NewsPage(), PILL_STYLES, Source

### Community 15 - "Journal & Shared Types"
Cohesion: 0.25
Nodes (3): DayStat, SerializedTrade, StatsResponse

### Community 16 - "P&L Heatmap"
Cohesion: 0.36
Nodes (8): Cell, formatDay(), Hover, isoDay(), pluralTrades(), PnlHeatmap(), toUtc(), fmtUsd()

### Community 17 - "Accounts Page"
Cohesion: 0.29
Nodes (5): Account, AccountsPage(), EXCHANGES, INTERVALS, Prog

### Community 18 - "CSV/PDF Export"
Cohesion: 0.48
Nodes (5): capture(), downloadCsv(), nodeToPdf(), nodeToPng(), triggerDownload()

### Community 19 - "Dashboard Navigation"
Cohesion: 0.40
Nodes (3): DashboardNav(), LINKS, SETTINGS_CHILDREN

### Community 21 - "Auth Middleware"
Cohesion: 0.67
Nodes (3): config, isValidSession(), middleware()

## Knowledge Gaps
- **95 isolated node(s):** `patchSchema`, `createSchema`, `schema`, `schema`, `schema` (+90 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useI18n()` connect `UI Components` to `Risk Manager`, `App Shell & i18n Core`, `Overview Dashboard`, `Charts`, `Trades Table`, `Trade Chart & Formatting`, `Auth Forms & Google`, `Account Settings`, `i18n Provider & News Page`, `Journal & Shared Types`, `P&L Heatmap`, `Accounts Page`, `Dashboard Navigation`?**
  _High betweenness centrality (0.125) - this node is a cross-community bridge._
- **Why does `getAuthUser()` connect `API Route Handlers` to `Exchange Sync (CCXT)`, `Analytics Engine`, `Risk Manager`, `News Aggregation`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `unauthorized()` connect `API Route Handlers` to `Exchange Sync (CCXT)`, `Analytics Engine`, `Risk Manager`, `News Aggregation`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `useI18n()` (e.g. with `ListEditor()` and `MistakeMultiSelect()`) actually correct?**
  _`useI18n()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `getAuthUser()` (e.g. with `POST()` and `GET()`) actually correct?**
  _`getAuthUser()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `unauthorized()` (e.g. with `POST()` and `GET()`) actually correct?**
  _`unauthorized()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `serverError()` (e.g. with `POST()` and `POST()`) actually correct?**
  _`serverError()` has 5 INFERRED edges - model-reasoned connections that need verification._