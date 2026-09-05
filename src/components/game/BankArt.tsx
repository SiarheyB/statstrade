"use client";

// Здание банка.
//
// Картинка тут не украшение: раздел банка — это семь таблиц с процентами, и
// без единого образа он читается как бухгалтерская форма. Классический
// портик с колоннами узнаётся мгновенно и говорит «сюда приходят за
// деньгами» быстрее любого заголовка.
//
// SVG, а не картинка: перекрашивается под купленную тему терминала и
// одинаково выглядит на любом экране.
export default function BankArt({ capital }: { capital: number }) {
  // Свет в окнах зависит от того, как идут дела: пустой банк тёмный, богатый
  // светится. Дешёвый способ показать, что банк живой и меняется.
  const health = Math.max(0.15, Math.min(1, capital / 1_000_000_000_000));
  return (
    <svg viewBox="0 0 640 200" className="block w-full" role="img" aria-hidden>
      <defs>
        <linearGradient id="bank-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#111a2e" />
          <stop offset="100%" stopColor="#1b2231" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="640" height="200" fill="url(#bank-sky)" />

      {/* Ступени */}
      <rect x="120" y="170" width="400" height="6" fill="#2a3243" />
      <rect x="132" y="164" width="376" height="6" fill="#323c50" />
      <rect x="144" y="158" width="352" height="6" fill="#3a465c" />

      {/* Колонны */}
      {Array.from({ length: 6 }).map((_, i) => {
        const x = 168 + i * 62;
        return (
          <g key={i}>
            <rect x={x} y="86" width="26" height="72" fill="#46536b" />
            <rect x={x - 4} y="80" width="34" height="8" rx="2" fill="#55637d" />
            <rect x={x - 4} y="156" width="34" height="6" rx="2" fill="#55637d" />
            {/* Свет между колоннами — «банк работает» */}
            <rect x={x + 30} y="96" width="30" height="58" fill="var(--color-accent)" opacity={0.1 + health * 0.22} />
          </g>
        );
      })}

      {/* Антаблемент и фронтон */}
      <rect x="150" y="66" width="340" height="16" rx="2" fill="#55637d" />
      <path d="M150 66 L320 26 L490 66 Z" fill="#46536b" />
      <path d="M172 62 L320 38 L468 62 Z" fill="#3a465c" />
      {/* Циферблат на фронтоне */}
      <circle cx="320" cy="54" r="9" fill="none" stroke="var(--color-accent)" strokeWidth="2" opacity="0.8" />
      <line x1="320" y1="54" x2="320" y2="48" stroke="var(--color-accent)" strokeWidth="1.5" opacity="0.8" />
      <line x1="320" y1="54" x2="324" y2="56" stroke="var(--color-accent)" strokeWidth="1.5" opacity="0.8" />

      {/* Вывеска */}
      <rect x="286" y="88" width="68" height="4" rx="2" fill="var(--color-accent)" opacity="0.5" />
    </svg>
  );
}
