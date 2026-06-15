// Generates trading-themed background SVGs into /public.
// Run: node scripts/gen-backgrounds.mjs
import { writeFileSync } from "node:fs";

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genCandles({ seed, trend, up, down, line, op }) {
  const W = 1440;
  const H = 900;
  const rng = mulberry(seed);
  const n = 46;
  const slot = W / n;
  const bodyW = slot * 0.5;
  let price = H * 0.5;
  const drift =
    trend === "up" ? -H * 0.007 : trend === "down" ? H * 0.007 : 0;
  const closes = [];
  let svg = "";
  for (let i = 0; i < n; i++) {
    const wave = trend === "wave" ? Math.sin(i * 0.5) * H * 0.06 : 0;
    const open = price;
    const move = (rng() - 0.5) * H * 0.09 + drift + (i > 0 ? wave - 0 : 0);
    let close = open + move;
    close = Math.max(H * 0.12, Math.min(H * 0.88, close));
    const isUp = close <= open; // screen y: smaller = higher price
    const color = isUp ? up : down;
    const x = slot * i + slot / 2;
    const hi = Math.min(open, close) - rng() * H * 0.03 - 4;
    const lo = Math.max(open, close) + rng() * H * 0.03 + 4;
    svg += `<line x1="${x.toFixed(1)}" y1="${hi.toFixed(1)}" x2="${x.toFixed(1)}" y2="${lo.toFixed(1)}" stroke="${color}" stroke-width="2" stroke-opacity="${op}"/>`;
    const top = Math.min(open, close);
    const h = Math.max(3, Math.abs(close - open));
    svg += `<rect x="${(x - bodyW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" fill-opacity="${op}"/>`;
    closes.push([x, close]);
    price = close;
  }
  // smooth trend polyline through closes
  const pts = closes.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  svg += `<polyline points="${pts}" fill="none" stroke="${line}" stroke-width="2.5" stroke-opacity="${(op * 1.4).toFixed(3)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${svg}</svg>`;
}

const themes = {
  "bg-midnight": { seed: 7, trend: "wave", up: "#3b82f6", down: "#64748b", line: "#3b82f6", op: 0.06 },
  "bg-terminal": { seed: 21, trend: "up", up: "#22c55e", down: "#166534", line: "#22c55e", op: 0.07 },
  "bg-bull": { seed: 42, trend: "up", up: "#16c784", down: "#b45309", line: "#f0b90b", op: 0.07 },
  "bg-bear": { seed: 99, trend: "down", up: "#7c3aed", down: "#ef4444", line: "#f43f5e", op: 0.07 },
};

for (const [name, cfg] of Object.entries(themes)) {
  writeFileSync(`public/${name}.svg`, genCandles(cfg));
  console.log("wrote public/" + name + ".svg");
}
