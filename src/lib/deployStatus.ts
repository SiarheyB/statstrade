// Индикатор "актуальная версия развёрнута" — без доступа к docker.sock.
// GIT_SHA — build-арг из .github/workflows/deploy.yml, зашитый в образ через
// Dockerfile. Сверяем с последним коммитом main на GitHub (публичный API,
// без токена). Если отличается — на GitHub уже есть коммит новее того, что
// реально запущен здесь (сборка ещё не готова / watchtower ещё не подтянул).

const REPO = "SiarheyB/statstrade";
const CACHE_TTL_MS = 60_000; // не долбим публичный GitHub API (лимит 60/час без токена)

export type DeployStatus =
  | { available: false; reason: string }
  | {
      available: true;
      runningSha: string;
      runningShaShort: string;
      latestSha: string;
      latestShaShort: string;
      upToDate: boolean;
    };

let cache: { at: number; latestSha: string | null; error?: string } | null = null;

async function fetchLatestMainSha(): Promise<{ latestSha: string | null; error?: string }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) {
      const result = { at: Date.now(), latestSha: null, error: `GitHub API ${res.status}` };
      cache = result;
      return result;
    }
    const data = await res.json();
    const result = { at: Date.now(), latestSha: typeof data.sha === "string" ? data.sha : null };
    cache = result;
    return result;
  } catch (err) {
    const result = { at: Date.now(), latestSha: null, error: (err as Error).message };
    cache = result;
    return result;
  }
}

export async function getDeployStatus(): Promise<DeployStatus> {
  const runningSha = process.env.GIT_SHA || null;
  if (!runningSha) {
    return { available: false, reason: "GIT_SHA не задан в этом окружении (обычно — локальная разработка)" };
  }
  const { latestSha, error } = await fetchLatestMainSha();
  if (!latestSha) {
    return { available: false, reason: error ?? "Не удалось получить последний коммит с GitHub" };
  }
  return {
    available: true,
    runningSha,
    runningShaShort: runningSha.slice(0, 7),
    latestSha,
    latestShaShort: latestSha.slice(0, 7),
    upToDate: runningSha === latestSha,
  };
}
