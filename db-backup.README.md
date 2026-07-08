# db-backup.sh — Руководство по экспорту и импорту БД проекта TradingStats

Скрипт выполняет **экспорт** и **импорт** базы данных с поддержкой **дедубликации** (пропуск строк, которые уже существуют в БД по первичному ключу).

---

## 1. 📋 Быстрый старт

```bash
# Перейти в корень проекта
cd /Users/sergejbuzuk/Documents/projects/trading_statistics

# Сделать скрипт исполняемым (один раз)
chmod +x db-backup.sh

# Экспорт базы (файл: db-backup_YYYYMMDD_HHMMSS.sql)
./db-backup.sh export

# Экспорт только данных (без схемы, формат INSERT)
./db-backup.sh export-data

# Импорт с пропуском дубликатов (ON CONFLICT DO NOTHING)
./db-backup.sh import backup_20260707.sql

# Импорт с полной заменой (TRUNCATE + import)
./db-backup.sh import-clean backup_20260707.sql
```

---

## 2. 🔧 Требования

| Инструмент | Для чего |
|-----------|----------|
| **Docker / Docker Compose** | Скрипт запускает `pg_dump`/`psql` внутри контейнера `db`. |
| **Файл `.env`** | Наличие переменной `DATABASE_URL` в корне проекта. |
| **Контейнер `db` запущен** | `docker compose up -d db` (или `docker compose up -d`). |

---

## 3. 📋 Команды

| Команда | Описание |
|---------|----------|
| `export [filename]` | Полный экспорт: схема + данные в формате plain SQL. |
| `export-data [filename]` | Только данные в формате `INSERT` (для поддержки дедубликации при импорте). |
| `import <filename>` | Импорт с дедубликацией: строки с существующим PK пропускаются. |
| `import-clean <filename>` | Полная замена: `TRUNCATE` таблиц перед импортом. |

---

## 4. 🔍 Как работает дедубликация

### 4.1. Принцип

При вызове `import` скрипт:

1. **Читает SQL-дамп** (файл экспорта).
2. **Находит все `INSERT`-операторы** и добавляет к ним `ON CONFLICT DO NOTHING`.
3. **Выполняет модифицированный дамп**: Postgres сам пропустит строки, которые уже есть в таблице (по первичному ключу или уникальному индексу).

```sql
-- До обработки:
INSERT INTO "Trade" (id, symbol, side, ...) VALUES ('abc123', 'BTCUSDT', 'long', ...);

-- После обработки (импорт):
INSERT INTO "Trade" (id, symbol, side, ...) VALUES ('abc123', 'BTCUSDT', 'long', ...)
  ON CONFLICT DO NOTHING;
```

### 4.2. Ограничения

- Работает только с дампами в формате **`INSERT`** (не `COPY`).
  → Используйте `export-data` для получения дампа, совместимого с дедубликацией.
- Требует наличия **первичного ключа** (PRIMARY KEY) на таблице.
- Если таблица имеет составной PK — `ON CONFLICT DO NOTHING` также работает корректно.

### 4.3. Почему `export-data` вместо `export`?

| Формат | Совместимость с дедубликацией |
|--------|------------------------------|
| `export` (plain SQL с `COPY`) | ❌ Не поддерживает `ON CONFLICT` (COPY не умеет). |
| `export-data` (`--column-inserts`) | ✅ Поддерживает `ON CONFLICT DO NOTHING`. |

---

## 5. 📦 Перенос БД между серверами

```bash
# На сервере-источнике
./db-backup.sh export-data prod_data.sql
scp prod_data.sql user@target-server:/path/to/project/

# На целевом сервере (в корне проекта с тем же .env)
./db-backup.sh import prod_data.sql
```

---

## 6. 🔧 Дополнительные опции

### 6.1. Изменение формата экспорта

По умолчанию `export` использует `.sql` (plain text). Для сжатия добавьте:

```bash
# Ручное сжатие после экспорта
gzip db-backup_*.sql
```

### 6.2. Исключение таблиц из экспорта

Измените функцию `cmd_export` в скрипте:

```bash
run_pg_dump --no-owner --exclude-table='ObSnapshot' ...
```

### 6.3. Параллельный экспорт (для больших БД)

```bash
run_pg_dump --jobs=4 --format=directory ...
```

---

## 7. ⚠️ Частые проблемы

| Проблема | Решение |
|----------|---------|
| `no such service: db` | Запустите контейнер: `docker compose up -d db`. |
| `connection to server failed` | Проверьте `DATABASE_URL` в `.env` (хост/порт). |
| `password authentication failed` | Пароль в `DATABASE_URL` не совпадает с паролем контейнера. |
| `ON CONFLICT DO NOTHING` не работает | Убедитесь, что дамп в формате `INSERT` (используйте `export-data`). |
| Импорт зависает | Проверьте размер файла: большие дампы могут занять минуты. |

---

## 8. 🔐 Безопасность

- **Не коммитьте** `.sql`-файлы в Git — они содержат все данные (сделки, ключи API, пользователи).
- **Шифруйте** бэкапы при передаче: `scp` через SSH или `gpg`.
- **Храните** бэкапы на защищённом носителе (внешний диск, S3 с шифрованием).

---

## 9. 💡 Рекомендации по использованию

1. **Регулярно делайте бэкапы** перед деплоем: `./db-backup.sh export`.
2. **Для миграции между серверами** используйте `export-data` + `import`.
3. **Для восстановления "с нуля"** используйте `import-clean`.
4. **Тестируйте импорт** на staging-окружении перед применением к проду.

---

## 10. 📝 Примеры вывода

```text
$ ./db-backup.sh export
📤 Exporting FULL database (schema + data) to /path/db-backup_20260707_143022.sql...
✅ Export completed: /path/db-backup_20260707_143022.sql (142M)

$ ./db-backup.sh import db-backup_20260707_143022.sql
📥 Importing with deduplication (ON CONFLICT DO NOTHING)...
🔄 Processing dump to add ON CONFLICT DO NOTHING...
📥 Executing import...
✅ Import completed (duplicates skipped).
```

---

> **Файл:** `db-backup.sh` — скрипт  
> **Обновлено:** 2026-07-07  
> **Автор:** TradingStats team