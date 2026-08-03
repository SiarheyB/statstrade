// Тонкая обёртка над Yandex OAuth2 + Disk REST API (fetch, без SDK — у
// Яндекса нет официального Node-пакета, только голый REST).
//
// Scope — строго "cloud_api:disk.app_folder": приложение видит и может
// изменять ТОЛЬКО свою собственную папку "Приложения/TradeStats" на диске
// пользователя, не весь диск. Аналог drive.file у Google.

const OAUTH_AUTH_URL = "https://oauth.yandex.ru/authorize";
const OAUTH_TOKEN_URL = "https://oauth.yandex.ru/token";
const OAUTH_REVOKE_URL = "https://oauth.yandex.ru/revoke_token";
const API_BASE = "https://cloud-api.yandex.net/v1/disk";

const SCOPE = "cloud_api:disk.app_folder";

export class YandexDiskError extends Error {}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new YandexDiskError(`${name} is not set`);
  return v;
}

function clientId(): string {
  return requireEnv("YANDEX_DISK_CLIENT_ID");
}
function clientSecret(): string {
  return requireEnv("YANDEX_DISK_CLIENT_SECRET");
}
function redirectUri(): string {
  return requireEnv("YANDEX_DISK_REDIRECT_URI");
}

export function isYandexDiskConfigured(): boolean {
  return !!(
    process.env.YANDEX_DISK_CLIENT_ID &&
    process.env.YANDEX_DISK_CLIENT_SECRET &&
    process.env.YANDEX_DISK_REDIRECT_URI
  );
}

// Публичный origin приложения — из того же соображения, что и у Google Drive
// (см. lib/integrations/googleDrive.ts:getPublicOrigin): req.url за реверс-
// прокси отражает внутренний адрес контейнера, не публичный домен.
export function getPublicOrigin(): string {
  return new URL(redirectUri()).origin;
}

export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: redirectUri(),
    scope: SCOPE,
    force_confirm: "yes", // гарантирует новый consent (и свежий refresh_token) даже при повторном подключении
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
};

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
    }),
  });
  if (!res.ok) throw new YandexDiskError(`token exchange failed: ${res.status}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
    }),
  });
  if (!res.ok) throw new YandexDiskError(`token refresh failed: ${res.status}`);
  return res.json();
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(OAUTH_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: token,
      client_id: clientId(),
      client_secret: clientSecret(),
    }),
  }).catch(() => {}); // best-effort
}

// Логин/email пользователя для отображения "подключено как ...".
export async function getUserLogin(accessToken: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}?fields=user`, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d?.user?.display_name ?? d?.user?.login ?? null;
}

// Подпапка внутри изолированной папки приложения ("Приложения/TradeStats/
// tradingstat_deal"), а не прямо в её корне — на случай, если позже туда
// добавится что-то ещё, и просто для аккуратности.
const DEAL_FOLDER = "tradingstat_deal";

function appPath(filename: string, subDirs: string[] = []): string {
  return `app:/${[DEAL_FOLDER, ...subDirs, filename].join("/")}`;
}

// Создаёт папку (путь целиком, включая все промежуточные сегменты), если её
// ещё нет (идемпотентно — 409 "уже существует" не считаем ошибкой). Яндекс
// не создаёт родителей автоматически, поэтому для вложенных путей вида
// "tradingstat_deal/2026-08/breakout" создаём каждый уровень по очереди.
async function ensureFolder(accessToken: string, path: string): Promise<void> {
  const res = await fetch(`${API_BASE}/resources?${new URLSearchParams({ path })}`, {
    method: "PUT",
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok && res.status !== 409) {
    throw new YandexDiskError(`create folder failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}

async function ensureDealFolder(accessToken: string, subDirs: string[] = []): Promise<void> {
  let path = `app:/${DEAL_FOLDER}`;
  await ensureFolder(accessToken, path);
  for (const dir of subDirs) {
    path = `${path}/${dir}`;
    await ensureFolder(accessToken, path);
  }
}

// Загружает файл в изолированную папку приложения на диске пользователя
// ("Приложения/TradeStats/tradingstat_deal[/год-месяц/паттерн]"). Двухшаговый
// API Яндекса: сначала получаем upload-URL, затем PUT байтов туда напрямую.
export async function uploadFile(
  accessToken: string,
  filename: string,
  mimeType: string,
  data: Buffer,
  subDirs: string[] = [],
): Promise<{ path: string }> {
  await ensureDealFolder(accessToken, subDirs);
  const path = appPath(filename, subDirs);
  const uploadUrlRes = await fetch(
    `${API_BASE}/resources/upload?${new URLSearchParams({ path, overwrite: "true" })}`,
    { headers: { Authorization: `OAuth ${accessToken}` } },
  );
  if (!uploadUrlRes.ok) {
    throw new YandexDiskError(`get upload url failed: ${uploadUrlRes.status} ${await uploadUrlRes.text().catch(() => "")}`);
  }
  const { href } = await uploadUrlRes.json();

  const putRes = await fetch(href, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: new Uint8Array(data),
  });
  if (!putRes.ok) {
    throw new YandexDiskError(`upload failed: ${putRes.status} ${await putRes.text().catch(() => "")}`);
  }
  return { path };
}

// Делает файл доступным по ссылке всем, у кого она есть (не листинг диска).
export async function publishResource(accessToken: string, path: string): Promise<void> {
  const res = await fetch(`${API_BASE}/resources/publish?${new URLSearchParams({ path })}`, {
    method: "PUT",
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) throw new YandexDiskError(`publish failed: ${res.status}`);
}

export async function unpublishResource(accessToken: string, path: string): Promise<void> {
  await fetch(`${API_BASE}/resources/unpublish?${new URLSearchParams({ path })}`, {
    method: "PUT",
    headers: { Authorization: `OAuth ${accessToken}` },
  }).catch(() => {});
}

export async function deleteResource(accessToken: string, path: string): Promise<void> {
  await fetch(`${API_BASE}/resources?${new URLSearchParams({ path, permanently: "true" })}`, {
    method: "DELETE",
    headers: { Authorization: `OAuth ${accessToken}` },
  }).catch(() => {});
}

// В отличие от Google Drive, у Яндекс.Диска нет постоянной прямой ссылки на
// байты файла — только КОРОТКОЖИВУЩИЙ подписанный download-URL, который надо
// перевыпускать на каждый просмотр (см. /api/trade-images/view). public_url
// (страница просмотра) для этого не годится — она открывает вьюер Яндекса,
// а не отдаёт сам файл, и не встраивается как <img src>.
export async function getFreshDownloadHref(accessToken: string, path: string): Promise<string> {
  const res = await fetch(`${API_BASE}/resources/download?${new URLSearchParams({ path })}`, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) throw new YandexDiskError(`get download href failed: ${res.status}`);
  const { href } = await res.json();
  return href;
}
