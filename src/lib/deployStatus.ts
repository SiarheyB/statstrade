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
      /** Когда сделан запущенный коммит (ISO) — null, если GitHub не ответил. */
      runningDate: string | null;
      latestSha: string;
      latestShaShort: string;
      /** Когда сделан последний коммит main (ISO). */
      latestDate: string | null;
      upToDate: boolean;
    };

type Commit = { sha: string | null; date: string | null };

let cache: { at: number; commit: Commit; error?: string } | null = null;
// Даты по конкретным SHA не меняются никогда, поэтому кэш без TTL — он нужен
// только чтобы не тратить лимит публичного API на повторные заходы в админку.
const dateBySha = new Map<string, string | null>();

/** Дата коммита из ответа GitHub: committer точнее author при rebase/cherry-pick. */
function commitDate(data: unknown): string | null {
  const c = (data as { commit?: { committer?: { date?: unknown }; author?: { date?: unknown } } })?.commit;
  const raw = c?.committer?.date ?? c?.author?.date;
  return typeof raw === "string" ? raw : null;
}

async function fetchCommit(ref: string): Promise<{ commit: Commit; error?: string }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${ref}`, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) return { commit: { sha: null, date: null }, error: `GitHub API ${res.status}` };
    const data = await res.json();
    return { commit: { sha: typeof data.sha === "string" ? data.sha : null, date: commitDate(data) } };
  } catch (err) {
    return { commit: { sha: null, date: null }, error: (err as Error).message };
  }
}

async function fetchLatestMain(): Promise<{ commit: Commit; error?: string }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  const { commit, error } = await fetchCommit("main");
  cache = { at: Date.now(), commit, error };
  if (commit.sha) dateBySha.set(commit.sha, commit.date);
  return cache;
}

/** Дата запущенного коммита. Отдельный запрос нужен, только когда он не main. */
async function dateOf(sha: string): Promise<string | null> {
  const hit = dateBySha.get(sha);
  if (hit !== undefined) return hit;
  const { commit } = await fetchCommit(sha);
  dateBySha.set(sha, commit.date);
  return commit.date;
}

export async function getDeployStatus(): Promise<DeployStatus> {
  const runningSha = process.env.GIT_SHA || null;
  if (!runningSha) {
    return { available: false, reason: "GIT_SHA не задан в этом окружении (обычно — локальная разработка)" };
  }
  const { commit: latest, error } = await fetchLatestMain();
  if (!latest.sha) {
    return { available: false, reason: error ?? "Не удалось получить последний коммит с GitHub" };
  }
  const upToDate = runningSha === latest.sha;
  return {
    available: true,
    runningSha,
    runningShaShort: runningSha.slice(0, 7),
    runningDate: upToDate ? latest.date : await dateOf(runningSha),
    latestSha: latest.sha,
    latestShaShort: latest.sha.slice(0, 7),
    latestDate: latest.date,
    upToDate,
  };
}
