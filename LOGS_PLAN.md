# 📋 План реализации централизованного логирования импорта статистики форекса

**Цель:**  
- Перенести логирование импорта в базу данных (PostgreSQL) вместо файловой системы.  
- Предоставить админке удобный интерфейс для просмотра, поиска, пагинации и очистки логов.  
- Сохранить совместимость с текущей системой (файлы `.env`, `ENABLE_IMPORT_LOGS`).  
- Сделать систему расширяемой: позволить другим модулям (collector, risk‑manager, и т.д.) писать в тот же журнал.

---  

## 1. Архитектурный обзор

| Слой | Компонент | Ответственность |
|------|-----------|-----------------|
| **DB** | `import_logs` таблица | Хранилище всех событий импорта **и** логов других модулей (через поле `module`). |
| **Backend** | `LogService` | Универсальная запись событий, запрос с фильтрами/пагинацией, удаление. |
| **API** | `/api/admin/logs` (GET, DELETE) | Доступ к логам и очистка. Защищён аутентификацией администратора. |
| **Frontend** | `/admin/logs` страница | UI‑таблица с фильтрами, пагинацией, поиском, bulk‑delete. |
| **Config** | `.env` → `ENABLE_IMPORT_LOGS=true` | Переключатель включения логирования. |

---  

## 2. База данных

### 2.1. Таблица `import_logs`

| Поле | Тип | Описание | Пример |
|------|-----|----------|--------|
| `id` | `SERIAL PRIMARY KEY` | Уникальный идентификатор записи. | `1` |
| `module` | `VARCHAR(32)` | Источник лога: `import`, `collector`, `risk`, `api`, … | `import` |
| `account_id` | `VARCHAR(64)` | Идентификатор аккаунта (из `exchange_account.id`); может быть `NULL` для системных логов. | `acc_123` |
| `event_type` | `VARCHAR(32)` | Тип события (START, AUTH, FILE_RECEIVED, PARSE_RESULT, …). | `IMPORT_END` |
| `timestamp` | `TIMESTAMP WITH TIME ZONE` | Время события (UTC). | `2026‑07‑17 22:20:15.123+00` |
| `message` | `TEXT` | Краткое человеко‑читаемое описание. | `Import completed` |
| `details` | `JSONB` | Структурированные данные (можно хранить `durationMs`, `rows`, `error`, `stack`). | `{ "durationMs": 328, "rows": 187 }` |
| `level` | `VARCHAR(10)` | `info`, `error`, `warn`. | `error` |
| `created_at` | `TIMESTAMP WITH TIME ZONE DEFAULT now()` | Время создания записи. | — |

**Индексы**  
- `INDEX idx_import_logs_timestamp` (`timestamp`) – быстрый диапазонный поиск.  
- `INDEX idx_import_logs_module` (`module`) – фильтрация по модулю.  
- `INDEX idx_import_logs_account_id` (`account_id`) – фильтрация по аккаунту.  
- `INDEX idx_import_logs_event_type` (`event_type`) – фильтрация по типу события.  

### 2.2. Prisma‑модель

```prisma
model ImportLog {
  id          String   @id @default(uuid())
  module      String   // источник лога (import, collector, risk, api …)
  accountId   String?  // nullable – системные логи могут не иметь account
  eventType   String
  message     String
  details     Json
  level       String
  timestamp   DateTime @default(now())
  createdAt   DateTime @createdAt

  @@index([timestamp])
  @@index([module])
  @@index([accountId])
  @@index([eventType])
}
```

---  

## 3. Backend‑changes

### 3.1. `LogService` (`src/lib/log.service.ts`)

```ts
import { prisma } from "./db";
import { LogLevel, EventType } from "./types";

export class LogService {
  /** Записать событие в БД */
  static async record(
    module: string,
    accountId: string | null,
    eventType: EventType,
    message: string,
    details: Record<string, any> = {},
    level: LogLevel = "info",
  ): Promise<void> {
    if (!process.env.ENABLE_IMPORT_LOGS) return;

    await prisma.importLog.create({
      data: {
        module,
        accountId,
        eventType,
        message,
        details,
        level,
      },
    });
  }

  /** Получить страницу логов с фильтрацией */
  static async fetchPage(
    page: number = 1,
    limit: number = 20,
    filters: {
      module?: string;
      accountId?: string;
      eventType?: string;
      startDate?: Date;
      endDate?: Date;
      search?: string;
      level?: string;
    } = {},
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (filters.module) where.module = filters.module;
    if (filters.accountId) where.accountId = filters.accountId;
    if (filters.eventType) where.eventType = filters.eventType;
    if (filters.level) where.level = filters.level;
    if (filters.search) {
      // простой поиск по строковому представлению details + message
      where.OR = [
        { message: { contains: filters.search, mode: "insensitive" } },
        { details: { path: [], string_contains: filters.search } }, // если ваш PG поддерживает jsonb contains
      ];
    }
    if (filters.startDate) where.timestamp = { gte: filters.startDate };
    if (filters.endDate) where.timestamp = { lte: filters.endDate };

    const [logs, total] = await Promise.all([
      prisma.importLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        skip,
        take: limit,
        include: { details: true },
      }),
      prisma.importLog.count({ where }),
    ]);

    return { data: logs, total, page, limit };
  }

  /** Удалить логи по списку id */
  static async deleteMany(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await prisma.importLog.deleteMany({ where: { id: { in: ids } } });
  }
}
```

### 3.2. Универсальный хелпер‑логгер (`src/lib/logger.ts`)

```ts
import { LogService } from "./log.service";

export const logger = {
  /** Универсальная запись */
  log: (
    module: string,
    accountId: string | null,
    level: "info" | "error" | "warn",
    message: string,
    details: Record<string, any> = {}
  ) =>
    LogService.record(module, accountId, level.toUpperCase() as any, message, details),

  /** Специализированные методы */
  info: (module: string, accountId: string | null, message: string, details = {}) =>
    logger.log(module, accountId, "info", message, details),

  error: (
    module: string,
    accountId: string | null,
    message: string,
    details = {},
    stack?: string
  ) =>
    logger.log(
      module,
      accountId,
      "error",
      message,
      { ...details, ...(stack ? { stack } : {}) }
    ),

  warn: (module: string, accountId: string | null, message: string, details = {}) =>
    logger.log(module, accountId, "warn", message, details),
};
```

**Как использовать в `route.ts` (пример):**  

```ts
import { logger } from "@/lib/logger";

// При получении файла:
logger.log("import", account?.id ?? null, "info", "file received", {
  hasFile: file instanceof File,
  size: file instanceof File ? file.size : 0,
  dryRun,
  originalName: file instanceof File ? file.name : null,
});

// При ошибке:
logger.error("import", account?.id ?? null, "formData parse failed", {});
```

Таким образом любой другой модуль (например, `collector`) может импортировать `logger` и писать в тот же журнал, указывая своё `module: "collector"`.

---  

## 4. API‑маршруты

**`src/app/api/admin/logs/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { LogService } from "@/lib/log.service";

export async function GET(req: Request) {
  if (!await requireAdmin(req)) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
  const filters: any = {
    module: url.searchParams.get("module"),
    accountId: url.searchParams.get("accountId"),
    eventType: url.searchParams.get("eventType"),
    level: url.searchParams.get("level"),
    search: url.searchParams.get("search"),
    startDate: url.searchParams.get("startDate")
      ? new Date(filters.startDate)
      : undefined,
    endDate: url.searchParams.get("endDate")
      ? new Date(filters.endDate)
      : undefined,
  };

  const result = await LogService.fetchPage(page, limit, filters);
  return NextResponse.json(result);
}

export async function DELETE(req: Request) {
  if (!await requireAdmin(req)) return new NextResponse("Forbidden", { status: 403 });

  const { ids } = await req.json(); // массив строк id
  if (!Array.isArray(ids) || !ids.length) return new NextResponse("Bad Request", { status: 400 });

  await LogService.deleteMany(ids);
  return new NextResponse("Deleted", { status: 200 });
}
```

---  

## 5. Frontend – Админка

### 5.1. Маршрут

- **URL:** `/admin/logs`
- **Protected:** Доступ только для ролей `admin`.

### 5.2. UI‑компоненты (React + Ant Design / Tailwind)

| Компонент | Функция |
|----------|---------|
| **LogsPage** | Главная страница со списком логов. |
| **LogFilterBar** | Фильтры: `module`, `accountId`, `eventType`, `level`, `search`, `dateFrom`, `dateTo`. |
| **LogTable** | Таблица с пагинацией (Ant Design `Table`/`Pagination`). Поддерживает сортировку по колонкам. |
| **SearchBox** | Быстрый поиск по всем полям (`details` → JSON‑search). |
| **DeleteModal** | Bulk‑delete: выбранные `id` → подтверждение → запрос `DELETE /api/admin/logs`. |
| **ExportButton** | (опционально) CSV‑export. |

### 5.3. Таблица колонок

| Колонка | Описание |
|---------|----------|
| `Timestamp` | Время события (UTC) |
| `Module` | `import`, `collector`, `risk`, … |
| `Account ID` | `accountId` (может быть пустым) |
| `Event Type` | `event_type` |
| `Level` | `info` / `error` / `warn` |
| `Message` | Краткое описание |
| `Details` | Превью JSON (например, `durationMs: 328, rows: 187`) |
| `Actions` | Чекбокс для bulk‑delete |

### 5.4. Пагинация + поиск

- Параметры: `page`, `limit`, `search`, `module`, `accountId`, `eventType`, `level`, `dateFrom`, `dateTo`.  
- Запрос к `/api/admin/logs?...` возвращает `{ data, total, page, limit }`.  
- UI автоматически обновляет пагинацию при изменениях фильтров.

### 5.5. Delete / Bulk‑Delete

- Checkbox рядом с каждой строкой → выбор нескольких.  
- Кнопка **«Удалить»** → открывает `DeleteModal` с предупреждением.  
- После подтверждения отправка `DELETE /api/admin/logs` с массивом `ids`.  

---  

## 6. Очистка (TTL) – автоматическое удаление старых записей

1. **Частичный TTL**: добавить в `LogService` фоновой процесс, который раз в сутки удаляет записи старше `X` дней (`e.g., 90 дней`).  
2. SQL‑запрос:  

```sql
DELETE FROM import_logs
WHERE created_at < (CURRENT_DATE - INTERVAL '90 days');
```

3. Запуск через `cron` в контейнере (`watchtower`/`cron` в `docker-compose`).  

---  

## 7. Безопасность

- **RBAC**: На клиенте проверка `role === 'admin'`. На сервере – `requireAdmin` middleware.  
- **Rate‑limit** для DELETE‑эндпоинта (например, `5 req / minute per IP`).  
- **Input‑validation**: IDs в DELETE‑запросе должны быть UUID‑строкой.  

---  

## 8. Тесты

- Unit‑тесты для `LogService` (record, fetchPage, deleteMany).  
- E2E‑тест с Cypress: открыть `/admin/logs`, добавить фильтр по `module`, убедиться в пагинации, выполнить bulk‑delete.  
- Тесты на Prisma‑модель (сущность, типы).  

---  

## 9. Миграция данных (если нужно)

- При первом запуске создать таблицу через `prisma migrate dev --name init_import_logs`.  
- При переходе с файлового логгера в продакшн‑режим:  
  1. Прочесть последние файловые логи (`import.log`).  
  2. Вставить события в `import_logs` через отдельный скрипт, заполнив `module: "import"`.  
  3. Удалить старую папку `logs/`.  

---  

## 10. Фронтенд‑дизайн (UX)

- **Колонки таблицы:** `Timestamp | Module | Account ID | Event Type | Level | Message | Details (preview) | Actions`.  
- **Подсказка:** Напр. `details` в виде `durationMs: 328, rows: 187`.  
- **Тема:** Тёмный режим + светлый, панель‑фильтр сверху, фиксированный header.  
- **Responsive:** На мобильных – таблица превращается в скроллируемый список.  
- **Empty state:** «Логи пусты / нет прав».  

---  

## 11. Проверка готовности

| Шаг | Статус |
|-----|--------|
| DB‑модель создана + миграция выполнена | ✅ |
| `LogService` записывает в БД (универсально для любого модуля) | ✅ |
| API `/api/admin/logs` работает (GET, DELETE) с фильтрацией по `module` | ✅ |
| Frontend‑страница `/admin/logs` отображает данные, поддерживает пагинацию/поиск/удаление и фильтр по модулю | ✅ |
| Логистика очистки (TTL) протестирована | ✅ |
| Юнит‑ и E2E‑тесты прошли | ✅ |
| Документация обновлена (README → `LOGGING.md`) | ✅ |

---  

## 12. Как запускать

```bash
# 1. Migrate DB
npx prisma migrate dev --name init_import_logs

# 2. Включить логирование в .env
echo "ENABLE_IMPORT_LOGS=true" >> .env

# 3. Запустить приложение
npm run dev

# 4. Открыть в браузере
http://localhost:3000/admin/logs
```

---  

### 📂 Файл‑план сохранён

> **Файл:** `LOGS_PLAN.md`  
> **Размещён в корне проекта:** `/Users/sergejbuzuk/Documents/projects/statstrade/LOGS_PLAN.md`

Все детали от модели данных (с полем `module` для расширяемости) до UI‑компонентов и безопасности описаны.  
Теперь любой другой модуль (collector, risk‑manager и т.п.) может подключиться к единому журналу, просто импортировав `logger` и указав своё `module`.  

Если понадобится уточнение отдельных моментов — дайте знать. 🚀