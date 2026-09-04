"use client";

// Кабинет трейдера — сцена, которая меняется вместе с покупками.
//
// Зачем это в игре про графики: цифры прогресса («престиж 47») ощущаются
// хуже, чем вид собственного рабочего места, где стоят купленные мониторы, а
// в окне вместо стены соседнего дома — панорама или море. Это самый дешёвый
// способ показать «ты вырос», и именно так делают браузерные экономические
// игры.
//
// Рисуем SVG, а не картинки: сцена должна перекрашиваться под купленную тему
// терминала и одинаково выглядеть на любом экране.
import { useI18n } from "@/lib/i18n/provider";
import type { LifestyleState } from "@/engine/entities/types";

// Вид из окна — по «лучшему» купленному жилью. Порядок важен: проверяем от
// самого статусного к простому.
function windowView(owned: string[]): "sea" | "skyline" | "city" | "wall" {
  if (owned.includes("life_seaside")) return "sea";
  if (owned.includes("life_penthouse")) return "skyline";
  if (owned.includes("life_studio")) return "city";
  return "wall";
}

function monitorCount(owned: string[]): number {
  if (owned.includes("gear_quad_setup")) return 4;
  if (owned.includes("gear_second_monitor")) return 2;
  return 1;
}

export default function TraderOffice({ lifestyle }: { lifestyle: LifestyleState }) {
  const { t } = useI18n();
  const owned = lifestyle.ownedItemIds;
  const view = windowView(owned);
  const monitors = monitorCount(owned);

  const skyTop = view === "sea" ? "#0e3a4f" : view === "skyline" ? "#111a2e" : view === "city" ? "#141c2b" : "#161b24";
  const skyBottom = view === "sea" ? "#1f7f8f" : view === "skyline" ? "#2a2140" : view === "city" ? "#232c3c" : "#1b212b";

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium">{t("game.office.title")}</div>
        <div className="text-xs text-faint">{t(`game.office.view.${view}`)}</div>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-border">
        <svg viewBox="0 0 640 280" className="block w-full" role="img" aria-label={t("game.office.title")}>
          <defs>
            <linearGradient id="office-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={skyTop} />
              <stop offset="100%" stopColor={skyBottom} />
            </linearGradient>
            <linearGradient id="office-desk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2b3546" />
              <stop offset="100%" stopColor="#1a2130" />
            </linearGradient>
            <linearGradient id="office-screen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.08" />
            </linearGradient>
          </defs>

          {/* Стена и окно */}
          <rect x="0" y="0" width="640" height="280" fill="var(--color-surface)" />
          <rect x="40" y="20" width="560" height="150" rx="6" fill="url(#office-sky)" />

          {view === "sea" && (
            <>
              <circle cx="500" cy="70" r="22" fill="#ffd98a" opacity="0.85" />
              <rect x="40" y="120" width="560" height="50" fill="#0d5f6e" opacity="0.7" />
              {[0, 1, 2, 3, 4].map((i) => (
                <rect key={i} x={60 + i * 110} y={132 + (i % 2) * 10} width="70" height="2" rx="1" fill="#8fd7e0" opacity="0.6" />
              ))}
            </>
          )}

          {(view === "skyline" || view === "city") && (
            // Силуэт города: у пентхауса он ниже линии взгляда (смотришь
            // сверху), у студии — вровень с окном.
            <g opacity={view === "skyline" ? 0.75 : 0.55}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
                const height = 30 + ((i * 37) % 70);
                const y = 170 - height;
                return (
                  <g key={i}>
                    <rect x={55 + i * 62} y={y} width="46" height={height} rx="2" fill="#0b1220" />
                    {[0, 1, 2].map((row) => (
                      <rect
                        key={row}
                        x={62 + i * 62}
                        y={y + 8 + row * 14}
                        width="32"
                        height="5"
                        fill="var(--color-accent)"
                        opacity={(i + row) % 3 === 0 ? 0.5 : 0.15}
                      />
                    ))}
                  </g>
                );
              })}
            </g>
          )}

          {view === "wall" && (
            <g opacity="0.5">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <line key={i} x1={40} y1={40 + i * 20} x2={600} y2={40 + i * 20} stroke="#232a36" strokeWidth="2" />
              ))}
            </g>
          )}

          <rect x="40" y="20" width="560" height="150" rx="6" fill="none" stroke="var(--color-border)" strokeWidth="3" />

          {/* Стол */}
          <rect x="20" y="196" width="600" height="16" rx="4" fill="url(#office-desk)" />
          <rect x="60" y="212" width="10" height="56" fill="#1a2130" />
          <rect x="570" y="212" width="10" height="56" fill="#1a2130" />

          {/* Мониторы: их число зависит от купленного сетапа */}
          {Array.from({ length: monitors }).map((_, i) => {
            const width = monitors === 1 ? 200 : monitors === 2 ? 170 : 130;
            const gap = 12;
            const total = monitors * width + (monitors - 1) * gap;
            const startX = 320 - total / 2;
            const x = startX + i * (width + gap);
            const height = monitors === 4 ? 78 : 92;
            const y = 196 - height - 6;
            return (
              <g key={i}>
                <rect x={x} y={y} width={width} height={height} rx="4" fill="#0b1017" stroke="var(--color-border)" />
                <rect x={x + 4} y={y + 4} width={width - 8} height={height - 8} rx="2" fill="url(#office-screen)" />
                {/* «График» на экране — ломаная, чтобы сцена не выглядела мёртвой */}
                <polyline
                  points={Array.from({ length: 10 })
                    .map((__, k) => {
                      const px = x + 8 + (k * (width - 16)) / 9;
                      const py = y + height / 2 + Math.sin(k * 1.3 + i) * (height / 5);
                      return `${px.toFixed(1)},${py.toFixed(1)}`;
                    })
                    .join(" ")}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth="1.5"
                  opacity="0.9"
                />
                <rect x={x + width / 2 - 12} y={y + height} width="24" height="6" fill="#1a2130" />
              </g>
            );
          })}

          {/* Мелочи на столе — только купленные */}
          {owned.includes("gear_coffee") && (
            <g>
              <rect x="86" y="176" width="18" height="20" rx="3" fill="#e6eaf2" opacity="0.85" />
              <path d="M104 181 h6 a5 5 0 0 1 0 10 h-6" fill="none" stroke="#e6eaf2" strokeWidth="2" opacity="0.85" />
              <path d="M90 172 q3 -6 6 0" fill="none" stroke="#8ea0b6" strokeWidth="1.5" opacity="0.6" />
            </g>
          )}
          {owned.includes("gear_data_terminal") && (
            <g>
              <rect x="520" y="168" width="60" height="28" rx="3" fill="#0b1017" stroke="var(--color-border)" />
              <rect x="526" y="174" width="48" height="16" rx="2" fill="var(--color-accent)" opacity="0.25" />
            </g>
          )}
          {owned.includes("life_watch") && (
            <g>
              <circle cx="470" cy="188" r="7" fill="none" stroke="#d4af37" strokeWidth="2" />
              <line x1="470" y1="188" x2="470" y2="184" stroke="#d4af37" strokeWidth="1.5" />
            </g>
          )}

          {/* Кресло */}
          <rect x="286" y="230" width="68" height="12" rx="6" fill={owned.includes("gear_chair") ? "#38445a" : "#232a36"} />
          <rect x="298" y="242" width="44" height="26" rx="4" fill={owned.includes("gear_chair") ? "#2b3546" : "#1c2330"} />
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {owned.length === 0 && <span className="text-xs text-faint">{t("game.career.nothingOwned")}</span>}
        {["life_car", "life_yacht", "status_whale", "status_analyst"].map((id) =>
          owned.includes(id) ? (
            <span key={id} className="rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-muted">
              {t(`game.shop.item.${id}.name`)}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
