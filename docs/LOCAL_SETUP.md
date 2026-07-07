# Полное руководство по локальному запуску проекта StatTrade

Это пошаговое руководство предназначено для людей, которые **никогда не работали с Docker, базами данных и кодом**. Следуйте пунктам по порядку — ничего не пропускайте.

---

## 1️⃣ Предварительные требования

| Что установить | Где скачать | Как проверить |
|----------------|-------------|---------------|
| **Node.js** (версия 18 или 20 LTS) | <https://nodejs.org> → кнопка **LTS** | Откройте командную строку → введите `node -v` → должно показать `v18.x.x` или `v20.x.x` |
| **Docker Desktop** | <https://www.docker.com/products/docker-desktop> → **Download for Windows** | После установки запустите Docker Desktop (иконка в трее). Внизу слева должно быть **“Docker is running”** |
| (Опционально) **VS Code** — удобный редактор кода | <https://code.visualstudio.com> | Откройте, если увидели окно редактора — всё ок |

> **Важно:** После установки Docker Desktop **перезагрузите компьютер**. Затем откройте Docker Desktop и убедитесь, что статус **“Docker is running”**.

---

## 2️⃣ Получаем проект на компьютер

### Вариант А — если у вас уже есть папка проекта
Перейдите в неё (см. шаг 3).

### Вариант Б — скачать ZIP с GitHub
1. Зайдите на <https://github.com/SiarheyB/statstrade>
2. Нажмите **Code → Download ZIP**
3. Распакуйте архив, например в `C:\Users\Sergey\IdeaProjects\statstrade`

### Вариант В — через Git (если умеете)
```bash
git clone https://github.com/SiarheyB/statstrade.git C:\Users\Sergey\IdeaProjects\statstrade
```

---

## 3️⃣ Открываем терминал в папке проекта

1. Нажмите `Win + R`, введите `cmd`, нажмите Enter.
2. В открывшемся чёрном окне выполните:
   ```cmd
   cd C:\Users\Sergey\IdeaProjects\statstrade
   ```
   (Замените путь на ваш, если папка в другом месте.)

> Все последующие команды выполняйте **в этом же окне**.

---

## 4️⃣ Поднимаем базу данных PostgreSQL в Docker

Выполните **одну команду** (скопируйте целиком, вставьте правой кнопкой мыши → Enter):

```cmd
docker run -d --name statstrade-db -p 5432:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=statstrade postgres:16
```

### Что делает эта команда
| Параметр | Назначение |
|----------|------------|
| `-d` | Запуск в фоне |
| `--name statstrade-db` | Имя контейнера (для удобства) |
| `-p 5432:5432` | Проброс порта 5432 (PostgreSQL) на ваш компьютер |
| `-e POSTGRES_USER=postgres` | Пользователь БД |
| `-e POSTGRES_PASSWORD=postgres` | Пароль пользователя |
| `-e POSTGRES_DB=statstrade` | Имя базы данных |
| `postgres:16` | Официальный образ PostgreSQL 16 |

### Проверка, что контейнер запустился
```cmd
docker ps
```
Должна появиться строка примерно такая:
```
CONTAINER ID   IMAGE         COMMAND                  CREATED        STATUS       PORTS                      NAMES
a1b2c3d4e5f6   postgres:16   "docker-entrypoint.s…"   2 minutes ago  Up 2 minutes 0.0.0.0:5432->5432/tcp   statstrade-db
```
- **STATUS = Up** — контейнер работает.
- **PORTS = 0.0.0.0:5432->5432/tcp** — порт проброшен верно.

Если контейнера нет или статус `Exited` — удалите его и запустите снова:
```cmd
docker rm -f statstrade-db
```
Повторите команду запуска из начала этого пункта.

---

## 5️⃣ Создаём файл конфигурации `.env`

Этот файл говорит приложению, где искать базу данных.

### Способ 1 — одной командой в cmd (самый быстрый)
```cmd
echo DATABASE_URL="postgresql://postgres:postgres@localhost:5432/statstrade" > .env
```

### Способ 2 — если у вас PowerShell
```powershell
"DATABASE_URL=""postgresql://postgres:postgres@localhost:5432/statstrade""" | Set-Content -Encoding utf8 .env
```

### Способ 3 — вручную через Блокнот
1. Откройте **Блокнот** (Win → начните писать «Блокнот» → Enter).
2. Вставьте **ровно одну строку** (без лишних пробелов и кавычек):
   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/statstrade"
   ```
3. Нажмите **Файл → Сохранить как…**
   - В поле **Имя файла** напишите `.env` (с точкой в начале, без `.txt`).
   - В поле **Тип файла** выберите **Все файлы (*.*)**.
   - Папка — корень проекта (там, где лежит `package.json`).
   - Нажмите **Сохранить**.

### Проверка
```cmd
type .env
```
Должен вывестись ровно:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/statstrade"
```
Если что-то другое — удалите файл (`del .env`) и создайте заново.

---

## 6️⃣ Устанавливаем зависимости Node.js

```cmd
npm install
```
- Это скачает все библиотеки в папку `node_modules`.
- Ожидайте 1–3 минуты. В конце может появиться предупреждение про уязвимости — **игнорируйте**, это нормально.

> Если ошибка `npm не является внутренней или внешней командой` — значит Node.js не в PATH. Перезапустите командную строку **после установки Node.js** и попробуйте снова.

---

## 7️⃣ Применяем структуру базы данных (миграции)

```cmd
npx prisma migrate deploy
```
- Прочитает `prisma/schema.prisma` и создаст все таблицы в PostgreSQL.
- Ожидаемый вывод (пример):
  ```
  Prisma schema loaded from prisma\schema.prisma
  Escaping migration `20260707000000_init`
  Applying migration `20260707000000_init` ... done
  ```

Если ошибка подключения — проверьте пункт 5 (файл `.env`) и убедитесь, что контейнер БД работает (пункт 4).

---

## 8️⃣ Запускаем веб-приложение

```cmd
npm run dev
```
- Next.js соберёт проект и поднимет сервер на порту 3000.
- В консоли появится примерно:
  ```
  ready - compiled successfully
  🚀  Local:   http://localhost:3000
  🚀  Network: http://192.168.x.x:3000
  ```

### Открываем в браузере
1. Откройте любой браузер (Chrome, Edge, Firefox).
2. В адресной строке введите:
   ```
   http://localhost:3000
   ```
3. Нажмите Enter. Страница загрузится (может потребоваться 5–10 секунд при первом запуске).

---

## 9️⃣ Проверяем появление колонки «ВХОД»

1. В меню слева (или на главной) перейдите в **Dashboard → Trades** (или прямо по адресу `http://localhost:3000/dashboard/trades`).
2. В таблице сделок найдите заголовок **«ВХОД»** — он должен находиться **перед колонкой «ЗАКРЫТИЕ»**.
3. В строках таблицы будут отображаться даты открытия сделок (например, `07.07.2026 14:30`).
4. Если таблица пуста — это нормально, колонка всё равно присутствует в заголовке.

---

## 🔟 Краткая шпаргалка (все команды подряд)

```cmd
cd C:\Users\Sergey\IdeaProjects\statstrade

# 1. База данных
docker run -d --name statstrade-db -p 5432:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=statstrade postgres:16
docker ps

# 2. Конфиг
echo DATABASE_URL="postgresql://postgres:postgres@localhost:5432/statstrade" > .env
type .env

# 3. Зависимости и миграции
npm install
npx prisma migrate deploy

# 4. Запуск приложения
npm run dev
```
Потом откройте в браузере `http://localhost:3000`.

---

## 🛠️ Типичные проблемы и решения

| Проблема | Что проверить / сделать |
|----------|-------------------------|
| `docker: command not found` | Убедитесь, что Docker Desktop запущен (иконка в трее). Перезагрузите ПК после установки Docker. |
| Контейнер сразу падает (`Exited`) | Удалите старый: `docker rm -f statstrade-db` и запустите команду из пункта 4 снова. |
| Ошибка `connect ECONNREFUSED 127.0.0.1:5432` при `prisma migrate deploy` | 1) Проверьте `docker ps` — контейнер должен быть `Up`. 2) Проверьте `.env` — строка должна быть **ровно** как в пункте 5. |
| `npm run dev` висит, но страница не открывается | Антивирус/брандмауэр может блокировать порт 3000. Временно отключите или добавьте исключение. |
| Пустая таблица сделок | Сделок пока нет. Добавьте тестовую через админ-панель (`http://localhost:3000/admin`) или создайте вручную в БД. |

---

## 📚 Полезные команды для дальнейшей работы

| Действие | Команда |
|----------|---------|
| Остановить приложение | В консоли с `npm run dev` нажмите **Ctrl + C** |
| Остановить и удалить контейнер БД (данные потеряются) | `docker stop statstrade-db && docker rm statstrade-db` |
| Зайти в консоль PostgreSQL (посмотреть сырые данные) | `docker exec -it statstrade-db psql -U postgres -d statstrade` |
| Внутри psql: показать все сделки | `SELECT * FROM "Trade";` |
| Выйти из psql | `\q` |

---

## ✅ Готово!

Теперь у вас полностью рабочий локальный стенд StatTrade:
- PostgreSQL в Docker,
- Приложение на Next.js с горячей перезагрузкой,
- Колонка **«ВХОД»** в таблице сделок.

Если на каком-то этапе застряли — скопируйте **точный текст ошибки** и обратитесь за помощью (в Issues проекта или к разработчику). Удачи! 🚀