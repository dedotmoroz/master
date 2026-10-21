# Найти мастера

Биржа строительных заказов и исполнителей. Новый проект находится в двух независимых каталогах:

- `backend/` — Node.js 24+, TypeScript, Fastify, PostgreSQL, гексагональная архитектура, Swagger.
- `frontend/` — Next.js со статическим экспортом. В Docker работает Nginx, а не Next.js-сервер.

У каждой части собственные `Dockerfile`, `.dockerignore`, `package.json` и lock-файл. Их можно собирать и развёртывать независимо. Старые PHP-исходники, SQL-дампы, резервные копии, `.env`, зависимости и результаты сборки в Git не включаются.

## Отдельная сборка

Из корня репозитория:

```sh
docker build -t naitimastera-backend:local ./backend
docker build -t naitimastera-frontend:local ./frontend
```

Фронтенд не обращается к работающему API при сборке. Единственный публичный build-аргумент — `NEXT_PUBLIC_TURNSTILE_SITE_KEY` для защиты гостевых загрузок. Секреты передаются только бэкенду при запуске, никогда через build-аргументы.

## Совместный локальный запуск

`compose.yml` поднимает **только приложения**, не базы/хранилище. Он не заменяет существующие инфраструктурные compose-файлы в `backend/` и не затрагивает их тома.

1. Создайте `backend/.env.docker` на основе `backend/.env.docker.example`, например командой `cp backend/.env.docker.example backend/.env.docker`.
2. Задайте новый случайный `VERIFICATION_TOKEN_SECRET` (например, результат `openssl rand -hex 32`), проверьте адреса и учётные данные PostgreSQL, S3 и ClamAV. Смена секрета делает прежние ссылки подтверждения недействительными.
3. Для локальной инфраструктуры на этом Mac пример использует `host.docker.internal`, PostgreSQL на `55433`, S3 на `59000`, ClamAV на `53310`. На Linux/сервере задайте достижимые DNS-имена сервисов; `127.0.0.1` внутри контейнера означает сам контейнер.
4. Существующая база должна быть мигрирована. Для новой базы сначала выполните `docker compose run --rm backend node scripts/migrate.ts`. Автоматические миграции по умолчанию выключены, как и удаление неиспользуемых файлов аккаунтов.

```sh
docker compose up -d --build --wait
docker compose ps
docker compose logs --tail=100 backend
```

Сайт: <http://127.0.0.1:8080>, Swagger: <http://127.0.0.1:3002/docs>, готовность API: <http://127.0.0.1:3002/health/ready>.

В локальном режиме ссылки подтверждения появляются в журнале бэкенда. Это не production-конфигурация. Не публикуйте такие журналы: они содержат одноразовые ссылки входа.

Остановка приложений: `docker compose down` из корня. Внешняя база/хранилище продолжают работать. Не используйте `down -v` для инфраструктуры с нужными данными.

## Независимый запуск

```sh
docker network create naitimastera-app
docker run -d --name backend --network naitimastera-app \
  --env-file backend/.env.docker --init --read-only --tmpfs /tmp \
  -p 127.0.0.1:3002:3000 naitimastera-backend:local
docker run -d --name frontend --network naitimastera-app \
  -e API_UPSTREAM=backend:3000 \
  -p 127.0.0.1:8080:8080 naitimastera-frontend:local
```

`API_UPSTREAM` — доверенный адрес API вида `backend:3000` или `host.docker.internal:3000`, **без** `http://`, пути и пароля. Меняется при запуске, пересборка фронтенда не нужна. Docker DNS разрешается заново, поэтому перезапуск API не требует перезапуска Nginx. Все страницы отдаются статически, `/api/*` проксируется с сохранением метода, query и Bearer-заголовка. API остаётся ответственным за валидацию, права доступа и rate limiting.

## Файлы и S3

Загрузка и просмотр файлов идут непосредственно из браузера по подписанным S3-URL. Поэтому `STORAGE_ENDPOINT` должен быть доступен **и контейнеру API, и браузеру**, а CORS бакета должен разрешать origin сайта. `http://storage:9000` — внутренний Docker-адрес, он не подходит для браузерных ссылок. На сервере используйте внешний HTTPS-адрес S3, доступный API; при необходимости настройте split DNS. Для локального `host.docker.internal` проверьте разрешение этого имени на своей ОС; при его отсутствии задайте общий достижимый адрес.

Создание нового бакета и CORS выполняются явно:

```sh
docker compose run --rm backend node scripts/init-storage.ts
docker compose run --rm backend node scripts/storage-cors.ts
```

## Перед production

Не отключайте проверки конфигурации: задайте `NODE_ENV=production`, SMTP, `PUBLIC_WEB_URL` с HTTPS, приватные учётные данные S3, ClamAV и `TURNSTILE_SECRET_KEY`. Публичный ключ Turnstile передайте при **сборке** фронтенда:

```sh
docker build --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-public-site-key \
  -t naitimastera-frontend:local ./frontend
```

Разместите HTTPS reverse proxy перед Nginx, ограничьте прямой доступ к API и настройте доверенную цепочку прокси/IP по реальной сетевой схеме. Порты в примере привязаны к localhost, а не ко всем интерфейсам. TLS, SMTP, production-секреты и резервное копирование здесь автоматически не настраиваются. Версии базовых образов закреплены по веткам; для релиза закрепляйте проверенные digest и планово обновляйте их.

## Проверки разработки

```sh
cd backend
npm ci
npm run typecheck
npm test
cd ../frontend
npm ci
npm test
npm run check
npm run build
npm run test:export
```

Интеграционные тесты запускаются отдельно с `TEST_DATABASE_URL` и `TEST_S3_ENDPOINT` на тестовой инфраструктуре, не на рабочей базе. Часть интеграционных тестов бэкенда использует исходники фронтенда — для них нужен весь репозиторий, но Docker-образы друг от друга при сборке не зависят.

После сборки обоих образов: `node scripts/docker-smoke.mjs`. Проверка создаёт отдельную временную PostgreSQL, случайно именованные контейнеры и сеть, тестирует статику, API, Swagger и native Sharp, затем удаляет только свои ресурсы. Рабочие `.env`, базы и S3 не используются.

Подробности: [Backend](backend/README.md), [Frontend](frontend/README.md), [сквозная проверка](backend/docs/e2e-browser-check.md).
