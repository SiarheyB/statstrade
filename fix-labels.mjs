import fs from "fs";

const path = "src/app/dashboard/orderflow/page.tsx";
let content = fs.readFileSync(path, "utf8");
content = content.replace(/\r\n/g, "\n");

// 1. Restore fmtDate function, change fmtDateTime back to old format, keep fmtAxisLabel
const oldFns = `// Полная дата/время для подписи оси X: использует Intl.DateTimeFormat
// с учётом локали пользователя — «пт 24 июл. 2026 г., 14:00» для ru,
// «Fri, Jul 24, 2026, 14:00» для en. Делает метку читаемой: виден год,
// день недели и месяц, а не просто «20.07 04:00».
function fmtAxisLabel(ms: number, tz: TimezoneId, locale: string): string {
  const { ms: shifted } = shiftedMs(ms, tz);
  const d = new Date(shifted);
  const f = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return f.format(d);
}
function dayKey(ms: number, tz: TimezoneId): number {
  const { y, mo, d } = zonedParts(ms, tz);
  return y * 10000 + mo * 100 + d;
}
// Дата + время для подсказки свечи (тот же формат, что и на оси).
function fmtDateTime(ms: number, tz: TimezoneId, locale: string): string {
  return fmtAxisLabel(ms, tz, locale);
}`;

const newFns = `// Полная дата/время для перекрестия: использует Intl.DateTimeFormat
// с учётом локали пользователя — «пт, 24 июл. 2026 г., 14:00» для ru.
// Для статических подписей оси X используется fmtDate + fmtTime (ниже).
function fmtCrosshairLabel(ms: number, tz: TimezoneId, locale: string): string {
  const { ms: shifted } = shiftedMs(ms, tz);
  const d = new Date(shifted);
  const f = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return f.format(d);
}
// Статическая подпись оси X: DD.MM (коротко, без года — меток много).
function fmtDate(ms: number, tz: TimezoneId): string {
  const { d, mo } = zonedParts(ms, tz);
  const p = (z: number) => String(z).padStart(2, "0");
  return \`\${p(d)}.\${p(mo + 1)}\`;
}
function dayKey(ms: number, tz: TimezoneId): number {
  const { y, mo, d } = zonedParts(ms, tz);
  return y * 10000 + mo * 100 + d;
}
// Статическая подпись оси X: DD.MM HH:MM.
function fmtDateTime(ms: number, tz: TimezoneId): string {
  const { d, mo, h, mi } = zonedParts(ms, tz);
  const p = (z: number) => String(z).padStart(2, "0");
  return \`\${p(d)}.\${p(mo + 1)} \${p(h)}:\${p(mi)}\`;
}`;

content = content.replace(oldFns, newFns);

// 2. Revert axis label rendering to the old logic (new day → date+time, same day → time)
const oldLabelLogic = `      // Всегда показываем полную дату/время через fmtAxisLabel — с годом,
      // днём недели и месяцем, чтобы было понятно «пт 24 июл. '26 14:00»,
      // а не «20.07 04:00» (без года и дня недели непонятно).
      const label = fmtAxisLabel(ms, timezone, locale);
      ctx.fillStyle = "#9aa2b3";
      ctx.fillText(label, x, H - 6);`;

const newLabelLogic = `      // Первая метка новых суток показывает дату, иначе только время.
      const day = dayKey(ms, timezone);
      const isDayStep = timeStep >= 86400000;
      const isNewDay = day !== lastDay;
      lastDay = day;
      const label = isDayStep ? fmtDate(ms, timezone) : isNewDay ? \`\${fmtDate(ms, timezone)} \${fmtTime(ms, timezone)}\` : fmtTime(ms, timezone);
      ctx.fillStyle = isDayStep || isNewDay ? "#9aa2b3" : "#6b7384";
      ctx.fillText(label, x, H - 6);`;

content = content.replace(oldLabelLogic, newLabelLogic);

// 3. Update tooltip to use fmtCrosshairLabel instead of fmtDateTime
content = content.replace(
  'const timeLabel = fmtDateTime(cndl ? cndl.t : ms, timezone, locale);',
  'const timeLabel = fmtCrosshairLabel(cndl ? cndl.t : ms, timezone, locale);'
);

// Restore CRLF
content = content.replace(/\n/g, "\r\n");
fs.writeFileSync(path, content, "utf8");
console.log("done");