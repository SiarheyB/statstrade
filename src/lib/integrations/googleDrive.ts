// Тонкая обёртка над Google OAuth2 + Drive REST API (без тяжёлого пакета
// googleapis — только fetch, легче аудировать и меньше поверхность атаки).
//
// Scope — строго "drive.file": приложение видит и может изменять ТОЛЬКО те
// файлы, которые само создало. Это НЕ полный доступ к диску пользователя.

const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const DRIVE_API_URL = "https://www.googleapis.com/drive/v3/files";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const SCOPE = "https://www.googleapis.com/auth/drive.file openid email";

export class GoogleDriveError extends Error {}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new GoogleDriveError(`${name} is not set`);
  return v;
}

function clientId(): string {
  return requireEnv("GOOGLE_DRIVE_CLIENT_ID");
}
function clientSecret(): string {
  return requireEnv("GOOGLE_DRIVE_CLIENT_SECRET");
}
function redirectUri(): string {
  return requireEnv("GOOGLE_DRIVE_REDIRECT_URI");
}

// Публичный origin приложения, выведенный из GOOGLE_DRIVE_REDIRECT_URI (он
// обязан указывать на реальный публичный домен, иначе Google откажет в
// callback). Используем его вместо req.url при построении редиректа из
// callback-роута — за реверс-прокси (Tailscale Funnel/nginx) req.url
// отражает внутренний адрес контейнера (http://localhost:3000), а не
// публичный домен, и редирект уводит пользователя на нерабочий localhost.
export function getPublicOrigin(): string {
  return new URL(redirectUri()).origin;
}

// Google Drive OAuth не настроен — фича должна быть скрыта в UI, а не падать.
export function isGoogleDriveConfigured(): boolean {
  return !!(
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
    process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
    process.env.GOOGLE_DRIVE_REDIRECT_URI
  );
}

export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // гарантирует refresh_token даже при повторном подключении
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new GoogleDriveError(`token exchange failed: ${res.status}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new GoogleDriveError(`token refresh failed: ${res.status}`);
  return res.json();
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(OAUTH_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => {}); // best-effort — не блокируем отключение сервиса в UI
}

export async function getUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const d = await res.json();
  return typeof d.email === "string" ? d.email : null;
}

// Находит папку с этим именем среди файлов, СОЗДАННЫХ этим приложением
// (drive.file-scope и так видит только их — фильтр по mimeType/trashed
// достаточен, без q=owners=... — нам чужие папки не видны в принципе), а
// если её ещё нет — создаёт. Кладём сюда скриншоты сделок, а не в корень
// "Мой диск" пользователя, чтобы не засорять его обычный вид диска.
export async function getOrCreateAppFolder(accessToken: string, name: string): Promise<string> {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await fetch(`${DRIVE_API_URL}?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1" })}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!searchRes.ok) throw new GoogleDriveError(`folder search failed: ${searchRes.status}`);
  const found = await searchRes.json();
  if (found.files?.[0]?.id) return found.files[0].id;

  const createRes = await fetch(DRIVE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!createRes.ok) throw new GoogleDriveError(`folder create failed: ${createRes.status}`);
  const created = await createRes.json();
  return created.id;
}

// Multipart upload (metadata + raw bytes) в один запрос — стандартный способ
// Drive API для файлов среднего размера (< ~5MB держим себя, см. MAX_IMAGE_BYTES).
export async function uploadImage(
  accessToken: string,
  filename: string,
  mimeType: string,
  data: Buffer,
  folderId?: string,
): Promise<{ id: string }> {
  const boundary = `tsboundary_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: filename, mimeType, ...(folderId ? { parents: [folderId] } : {}) });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      "utf8",
    ),
    data,
    Buffer.from(`\r\n--${boundary}--`, "utf8"),
  ]);

  const res = await fetch(DRIVE_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new GoogleDriveError(`upload failed: ${res.status} ${await res.text().catch(() => "")}`);
  const d = await res.json();
  return { id: d.id };
}

// Делает файл доступным по прямой ссылке всем, у кого есть ссылка (не listing).
export async function makeFilePublic(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_API_URL}/${encodeURIComponent(fileId)}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!res.ok) throw new GoogleDriveError(`permission grant failed: ${res.status}`);
}

// Удаляет файл в Drive пользователя (используется только если явно решим
// удалять сам файл — по умолчанию мы удаляем только ссылку, см. план).
export async function deleteFile(accessToken: string, fileId: string): Promise<void> {
  await fetch(`${DRIVE_API_URL}/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}

// Прямая ссылка на просмотр картинки (рендерится в <img src>), а не
// wrapper-страница вьюера Drive (webViewLink).
//
// НЕ используем `drive.google.com/uc?export=view&id=...` — этот endpoint
// у Google нестабилен для хотлинка в <img>: часто отдаёт HTML-страницу
// (интерстишл/предупреждение о вирус-скане) вместо самих байт картинки,
// из-за чего <img> падает с ошибкой загрузки. `thumbnail` — официальный
// путь встраивания превью файла, отдаёт непосредственно image/*.
export function directImageUrl(fileId: string): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w2000`;
}
