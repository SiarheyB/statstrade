# План: загрузка скриншота сделки на облако пользователя (Google Drive / Яндекс.Диск)

## Обновление постановки (важно!)

Это НЕ "вставить ссылку вручную". Правильная механика:

1. Пользователь **один раз подключает свой облачный сервис** (Google Drive
   или Яндекс.Диск) через OAuth в настройках — даёт нашему приложению право
   загружать туда файлы.
2. В разделе сделок рядом с каждой сделкой — кнопка **«Загрузить»**.
3. Клик → выбор файла (image picker) → файл грузится **напрямую в облако
   пользователя** через API этого сервиса от имени приложения.
4. После успешной загрузки кнопка "Загрузить" заменяется на **ссылку на
   файл** + иконку **корзины** рядом.
5. Корзина удаляет **только ссылку у нас** (саму запись `imageUrl`) — файл
   в облаке пользователя не трогаем. После удаления снова показывается
   кнопка «Загрузить».
6. Клик по ссылке — модалка поверх таблицы сделок с картинкой (как в
   первой версии плана).

## Выбор сервиса — рекомендация

Поддержать **оба**, но в MVP можно ограничиться одним. Сравнение:

| | Google Drive API | Яндекс.Диск REST API |
|---|---|---|
| OAuth | Полноценный OAuth2 (Google Cloud Console, требует consent screen, для публичного приложения — верификацию, если запрашивать чувствительные scopes) | OAuth2 через Яндекс ID (oauth.yandex.ru), проще пройти модерацию |
| SDK | `googleapis` (npm, официальный) либо легковесно — прямые REST-вызовы через `google-auth-library` | Официального Node SDK нет — просто REST (`fetch`) |
| Scope для аплоада | `drive.file` (доступ только к файлам, созданным этим приложением — не ко всему диску, менее пугающе для пользователя при consent) | `cloud_api:disk.write` / `cloud_api:disk.app_folder` — можно грузить в изолированную папку приложения |
| Публичная ссылка на файл | Нужно отдельно выставить permission `type=anyone, role=reader` после аплоада, затем взять `webContentLink`/`webViewLink` | Нужно вызвать `PUT /v1/disk/resources/publish` после аплоада, затем взять `public_url` |
| Верификация приложения Google | При использовании только `drive.file` (не полного доступа к диску) верификация обычно не требуется даже при выходе за 100 тестовых пользователей — это важно, `drive.file` scope safe для unverified app в большинстве случаев | Модерация приложения в Яндексе более простая/быстрая |

**Рекомендация:** начать с **Google Drive** (`drive.file` scope) — самый
популярный сервис у пользователей, `drive.file` не требует полной
Google-верификации, есть готовая SDK. Яндекс.Диск добавить вторым провайдером
по тому же интерфейсу (провайдер как enum/strategy), если будет спрос —
архитектуру сразу делаем расширяемой (`CloudProvider: "google_drive" |
"yandex_disk"`).

## Архитектура

### 1. Хранение OAuth-токенов пользователя

Новая модель в `prisma/schema.prisma` (аналог `ExchangeAccount`, который уже
хранит зашифрованные секреты через `src/lib/crypto.ts` — тот же
AES-256-GCM, тот же `ENCRYPTION_KEY`, ничего нового в крипто-инфре не
нужно):

```prisma
model CloudStorageAccount {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider      String   // "google_drive" | "yandex_disk"
  accessToken   String   // encrypted (AES-256-GCM, см. src/lib/crypto.ts)
  refreshToken  String   // encrypted
  expiresAt     DateTime
  accountEmail  String?  // для отображения "подключено как you@gmail.com"
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([userId, provider])
  @@index([userId])
}
```

`TradeAnnotation.imageUrl` — как в первой версии плана, плюс
`imageProvider String?` (какой сервис, для иконки/подписи) и опционально
`imageFileId String?` (id файла в облаке — вдруг понадобится для будущего
удаления/повторной публикации, не обязателен для MVP, но дёшево сохранить
сразу).

### 2. OAuth consent flow (подключение сервиса)

Новые роуты:
- `GET /api/integrations/google-drive/connect` — редиректит на Google OAuth
  consent screen (`response_type=code`, `scope=https://www.googleapis.com/auth/drive.file`,
  `access_type=offline`, `prompt=consent` чтобы гарантированно получить
  `refresh_token`).
- `GET /api/integrations/google-drive/callback` — принимает `code`, меняет
  на `access_token`+`refresh_token` через Google token endpoint, сохраняет
  зашифрованные токены в `CloudStorageAccount`, редиректит обратно в
  настройки с success/error.
- (Аналогично `/api/integrations/yandex-disk/connect|callback`, если делаем
  вторым провайдером.)
- `DELETE /api/integrations/[provider]` — отключить сервис (удалить запись
  `CloudStorageAccount`, опционально отозвать токен через revoke endpoint
  провайдера).

UI: `src/app/dashboard/settings/` — новая вкладка/секция **«Интеграции»**
с кнопкой «Подключить Google Drive» (по образцу формы подключения биржи в
`src/app/dashboard/accounts/page.tsx`). После подключения — показывает
email аккаунта и кнопку «Отключить».

### 3. Загрузка файла

Новый роут `POST /api/trade-images/upload`:
- Принимает `multipart/form-data`: `tradeKey` + `file` (image).
- Проверка: файл — изображение (`content-type` начинается с `image/`),
  ограничение размера (например 10 МБ — задать константой).
- Достаёт `CloudStorageAccount` пользователя для провайдера, который у него
  подключен (если подключено несколько — берём выбранный по умолчанию/первый
  подключённый; для MVP можно требовать ровно один активный провайдер).
- Если `accessToken` истёк (`expiresAt < now`) — обновляет через
  `refreshToken` (`refresh_token` grant), перезаписывает в БД.
- Грузит файл в Google Drive через `googleapis` (`drive.files.create`,
  в специальную папку приложения или просто в root — `drive.file` scope
  это разрешает для файлов, созданных приложением).
- Делает файл публично читаемым: `drive.permissions.create({fileId,
  type: "anyone", role: "reader"})`.
- Берёт прямую ссылку — для Google Drive лучше сконструировать
  `https://drive.google.com/uc?export=view&id=<fileId>` (эта форма рендерится
  как `<img src>` без доп. кликов, в отличие от `webViewLink`, который
  открывает вьюер-страницу) — это специфика Google Drive, обязательно
  протестировать что `<img>` реально грузится по такой ссылке.
- Сохраняет `imageUrl` + `imageProvider` (+`imageFileId`) в
  `TradeAnnotation` (upsert по `tradeKey`+`userId`, как для `note`).
- Возвращает `{ imageUrl }` клиенту.

Для Яндекс.Диска аналогично: `POST https://cloud-api.yandex.net/v1/disk/resources/upload`
(получить upload URL) → `PUT` файл по этому URL → `PUT
/v1/disk/resources/publish?path=...` → взять `public_url` из `GET
/v1/disk/resources?path=...`.

### 4. Удаление ссылки (не файла)

`DELETE /api/trade-images/[tradeKey]` (или расширить существующий
`/api/annotations` upsert, передавая `imageUrl: null`) — просто обнуляет
поля в `TradeAnnotation`. Файл в облаке пользователя остаётся нетронутым
(это явное требование).

### 5. UI в таблице сделок

`src/app/dashboard/trades/page.tsx`:
- Новая колонка «Изображение».
- Ячейка — три состояния:
  - **Нет подключённого облачного сервиса** → кнопка выглядит как
    disabled/ссылка на настройки: «Подключите облако» → ведёт в
    `/dashboard/settings#integrations`.
  - **Сервис подключён, ссылки нет** → кнопка **«Загрузить»**
    (`<input type="file" accept="image/*" hidden>` + обычная кнопка,
    триггерящая клик по input) → на выбор файла сразу шлём
    `POST /api/trade-images/upload` (`FormData`), показываем спиннер на
    кнопке пока грузится.
  - **Ссылка есть** → сокращённая ссылка/иконка (клик — модалка с
    картинкой, как в первой версии плана) + иконка корзины рядом
    (`lucide-react` `Trash2`, `text-faint hover:text-red-500`) → confirm
    (небольшой native `confirm()` или мини-попап) → `DELETE`-запрос →
    возвращаемся в состояние «Загрузить».
- Модалка просмотра — переиспользуемый `ImagePreviewModal` (как в первой
  версии плана).

### 6. Настройки/интеграции UI

Новая секция в `src/app/dashboard/settings/` (например
`src/app/dashboard/settings/integrations/page.tsx` или блок на общей
странице настроек):
- Список провайдеров (Google Drive, [Яндекс.Диск]) с состоянием
  подключено/нет, email аккаунта, кнопка Подключить/Отключить.

### 7. Зависимости и env

`package.json`: добавить `googleapis` (или легковесно —
`google-auth-library` + `node-fetch`/встроенный `fetch` для Drive REST,
что уменьшит вес бандла — стоит решить на этапе реализации, `googleapis`
довольно тяжёлый пакет).

`.env.example`, новые переменные:
```
GOOGLE_CLIENT_SECRET=""          # уже есть GOOGLE_CLIENT_ID, но он для Identity Services sign-in — уточнить: нужен ли отдельный OAuth client в Google Cloud Console с типом "Web application" и redirect URI, отличный от текущего sign-in клиента
GOOGLE_DRIVE_REDIRECT_URI=""     # https://<домен>/api/integrations/google-drive/callback
YANDEX_CLIENT_ID=""
YANDEX_CLIENT_SECRET=""
YANDEX_DISK_REDIRECT_URI=""
```

**Важно:** текущий `GOOGLE_CLIENT_ID` (`.env.example:22`) используется для
Google Identity Services (вход по Google) — это НЕ то же самое, что OAuth2
Authorization Code flow, нужный для Drive API. Понадобится завести
отдельный OAuth Client ID (тип Web application) в Google Cloud Console,
включить Drive API, настроить OAuth consent screen (сфера действия —
External, добавить себя тестовым пользователем на этапе разработки, пока
приложение не проходит верификацию Google).

### 8. Прод/деплой нюансы (см. CLAUDE.md проекта)

- Новые env-переменные — правки `.env`/`docker-compose.prod.yml` **не
  подхватываются watchtower** автоматически, на сервере нужен ручной
  `git pull && docker compose -f docker-compose.prod.yml up -d`.
- Redirect URI для OAuth должен указывать на реальный публичный домен
  (через Tailscale Funnel) — прописать в Google Cloud Console /
  Яндекс OAuth App заранее.
- Миграция Prisma (`CloudStorageAccount` + поля в `TradeAnnotation`)
  применится автоматически при старте контейнера `app` (`prisma migrate
  deploy` в CMD).

## Безопасность

- Токены (`accessToken`, `refreshToken`) — шифруются AES-256-GCM тем же
  `ENCRYPTION_KEY`, что уже используется для `ExchangeAccount` секретов и
  `twoFactorSecret` (`src/lib/crypto.ts`) — переиспользуем, не изобретаем
  новое.
- Scope запрашиваем максимально узкий: `drive.file` (не полный доступ к
  диску пользователя).
- Валидация загружаемого файла: тип (`image/*`), размер (лимит), избегаем
  SSRF — сам файл прилетает от клиента через `multipart/form-data`,
  сервер не ходит по произвольным URL.
- CSRF: роут `/api/integrations/.../connect` — стандартный OAuth `state`
  параметр (случайная строка, сверяем в callback) — обязательно, защита от
  подмены OAuth-редиректа.
- При удалении `CloudStorageAccount` — не забыть каскадно обнулять
  `imageUrl` у всех аннотаций пользователя, использовавших этот провайдер
  (иначе останутся "битые" ссылки с кнопкой корзины, указывающей на
  несуществующий токен) — или просто оставить ссылки как есть (они всё
  ещё валидны, т.к. файл публичный и токен на чтение не нужен) — **решение:
  ссылки не трогать**, они продолжат работать, отключается только
  возможность новых загрузок.

## Порядок работ (чек-лист)

1. [x] Prisma: модель `CloudStorageAccount` + поля `imageUrl`/`imageProvider`/
      `imageFileId` в `TradeAnnotation` + миграция
      (`prisma/migrations/20260801120000_add_trade_image_and_cloud_storage`)
2. [ ] **Требует действий пользователя вручную** — Google Cloud Console:
      создать OAuth Client (Web), включить Drive API, настроить consent
      screen, добавить redirect URI. Инструкция: `docs/SELF_HOSTING.md`
      раздел «5.1 Google Drive». Без этого шага кнопка подключения скрыта.
3. [x] Без `googleapis` — лёгкая обёртка на `fetch` (меньше поверхность
      атаки, легче аудировать): `src/lib/integrations/googleDrive.ts`
4. [x] `src/lib/integrations/googleDrive.ts` — getAuthUrl, exchangeCode,
      refreshAccessToken, uploadImage, makeFilePublic, revokeToken;
      `src/lib/integrations/cloudStorage.ts` — getValidGoogleDriveToken
      (авто-рефреш токена)
5. [x] Роуты `/api/integrations/google-drive/connect` (GET, редирект +
      state-cookie), `/api/integrations/google-drive/callback` (GET),
      `/api/integrations/google-drive` (GET статус, DELETE отключить +
      revoke)
6. [x] `/api/trade-images` (POST — загрузка через FormData, DELETE —
      удаление только ссылки по `?tradeKey=`)
7. [x] `src/components/CloudStorageSettings.tsx`, подключён в
      `dashboard/settings/page.tsx`
8. [x] Колонка в `trades/page.tsx` (`src/components/TradeImageCell.tsx`):
      три состояния — «Подключить облако» / «Загрузить» / ссылка+корзина
9. [x] `src/components/ImagePreviewModal.tsx` — оверлей, закрытие по фону/
      крестику/Esc, обработка ошибки загрузки картинки
10. [x] i18n ключи en/ru (`trades.col.image`, `trades.image.*`,
      `settings.gdrive*`)
11. [x] `.env.example` — `GOOGLE_DRIVE_CLIENT_ID/SECRET/REDIRECT_URI`;
      `docs/SELF_HOSTING.md` раздел 5.1 с пошаговой инструкцией
12. [ ] **Ручное тестирование** (нужны реальные Google-креды, см. п.2):
       подключение аккаунта, загрузка картинки, проверка что `<img>`
       рендерится по итоговой ссылке, удаление ссылки, повторная загрузка,
       протухание/рефреш токена
13. [ ] (Не делаем, см. решения выше) Яндекс.Диск — вне скопа первой
       итерации

## Реализованная защита от угроз (важно)

- **Подделка типа файла**: сервер не доверяет `Content-Type` от клиента —
  реальный тип определяется по magic bytes (`src/lib/imageValidation.ts:
  detectImageType`), разрешены только PNG/JPEG/WEBP/GIF. Отсекает файлы
  вроде HTML/SVG со скриптом, переименованные в `.png`.
- **Размер файла**: жёсткий лимит 10 МБ и на клиенте (быстрый отказ), и на
  сервере (`MAX_IMAGE_BYTES`, `src/app/api/trade-images/route.ts`).
- **SSRF**: сервер никогда не делает fetch по URL, присланному
  пользователем — файл приходит как raw-байты в `multipart/form-data`,
  сервер только проксирует их в Drive API (fixed upload-эндпоинт Google).
- **Rate limiting**: `/api/trade-images` (20 загрузок/10 мин на IP+юзера) и
  `/api/integrations/google-drive/connect` (10/10 мин) — `src/lib/ratelimit.ts`.
- **CSRF на OAuth-редиректе**: случайный `state` кладётся в httpOnly-cookie
  при `/connect` и сверяется в `/callback` — подмена стороннего редиректа
  невозможна.
- **Хранение токенов**: `accessToken`/`refreshToken` шифруются AES-256-GCM
  тем же `ENCRYPTION_KEY`, что и секреты бирж (`src/lib/crypto.ts`) — в БД
  никогда не лежат в открытом виде; при компрометации БД без ключа
  токены бесполезны.
- **Узкий OAuth scope**: `drive.file` — приложение видит и может менять
  ТОЛЬКО файлы, созданные им самим, не весь диск пользователя.
- **Авторизация**: все новые роуты проверяют `getAuthUser()`; `/api/trade-images`
  DELETE и загрузка привязаны к `userId` через `TradeAnnotation` — чужой
  `tradeKey` не даст доступа к чужой аннотации.
- **XSS через `<img>`**: изображение рендерится строго как `<img src>`,
  никогда не как HTML/iframe — даже при удачной подмене типа браузер не
  исполнит код, только попытается декодировать как картинку и упадёт в
  `onError` (см. `ImagePreviewModal`).

## Решения (зафиксировано пользователем 2026-08-01)

- **Провайдер:** только **Google Drive** на первую итерацию. Яндекс.Диск —
  не делаем; шаги 2-5, 13 чек-листа и раздел "выбор сервиса" — только про
  Google. Если понадобится Яндекс.Диск позже, `provider` в
  `CloudStorageAccount` уже задел под расширение (enum-строка), но
  дополнительную интеграцию сейчас не пишем.
- **Картинок на сделку:** ровно **одна**. Модель данных — просто `imageUrl`
  (+`imageProvider`, `imageFileId`) в `TradeAnnotation`, без отдельной
  таблицы `TradeImage`. UI — одна кнопка/ссылка/корзина на сделку, без
  списков.

## Оставшийся открытый вопрос

- Ограничение размера файла (МБ) и допустимые форматы (png/jpeg/webp?) —
  предлагаю дефолт: до 10 МБ, `image/png`, `image/jpeg`, `image/webp` —
  уточнить перед реализацией, либо просто взять эти значения как разумные
  по умолчанию.
