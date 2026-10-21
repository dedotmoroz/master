# Подключение frontend к Naiti Mastera API

Swagger UI: `/docs/`. JSON OpenAPI: `/openapi.json` или `/docs/json`, YAML: `/docs/yaml`.
Swagger работает на том же сервере, что API; его CSS/JS раздаются локально.
В примерах IDs и токены — placeholders, используйте значения реальных ответов.

## Общие правила

- Префикс бизнес-методов — `/api/v1`. Тело запросов и ответов — JSON, кроме прямой загрузки файла в S3 и ответов `204`.
- Суммы задаются целыми копейками RUB. `null` — сумма не указана. Все даты — ISO 8601 UTC.
- В защищённом запросе передавайте `Authorization: Bearer SESSION_TOKEN`.
- Для Swagger нажмите **Authorize** и вставьте только `session.token`, без слова `Bearer`. UI не сохраняет токен между перезагрузками.
- При `401` завершите локальную сессию и предложите вход. Не выполняйте `response.json()` для пустого `204`.
- Массивы списков находятся в `items`; `total` — общее число результатов фильтра. Страница 10 по 20 элементов: `limit=20&offset=180`.
- Чужие заказы, файлы и уведомления возвращают `404`, как отсутствующие.
- Полные тела `PUT` обязательны: пропущенные обязательные поля и неизвестные свойства отклоняются.

## 1. Гостевой заказ и первая сессия

1. Получить `GET /api/v1/work-categories`; выбрать активную категорию `selectable: true`.
2. Получить `GET /api/v1/regions` и искать населённый пункт через `GET /api/v1/locations?query=Моск`. Страна фиксирована: `RU`.
3. Отправить `POST /api/v1/guest-orders`:

```json
{
  "email": "customer@example.com",
  "contactName": "Анна",
  "categoryId": "house-building",
  "locationId": "ru-locality-1",
  "title": "Построить загородный дом",
  "description": "Ищу бригаду для строительства дома по готовому проекту.",
  "budgetMinMinor": 500000000,
  "budgetMaxMinor": 700000000,
  "temporaryAttachments": [],
  "consentVersion": "2026-01"
}
```

4. На `202` показать экран «Проверьте почту». Заказ ещё не опубликован.
5. На frontend-странице `/orders/confirm?token=...` извлечь токен и отправить **POST** `/api/v1/guest-orders/confirm` с `{"token":"TOKEN_FROM_EMAIL"}`.
6. Из ответа сохранить сессию согласно политике frontend, взять `orderId` и открыть собственный заказ через `GET /api/v1/customer/orders/ORDER_ID` с Bearer token.

В development ссылка подтверждения выводится в лог backend. Повторное подтверждение не создаёт второй заказ.

## 2. Вход и регистрация исполнителя

Для регистрации: `POST /api/v1/auth/registrations` с `{"email":"contractor@example.com"}`.
Для входа: `POST /api/v1/auth/login-requests` с тем же форматом.
Оба метода отвечают `202 pending_email`, не раскрывая существование аккаунта.

Frontend обрабатывает `/auth/register/confirm?token=...` или `/auth/login/confirm?token=...`
и отправляет токен в соответствующий `/api/v1/auth/registrations/confirm` или `/api/v1/auth/login-requests/confirm`.
Ответ содержит `account` и `session`. Текущий аккаунт — `GET /api/v1/auth/me`.
Выход: `DELETE /api/v1/auth/session`, выход из всех устройств — `DELETE /api/v1/auth/sessions`.

Профиль сохраняется авторизованным `PUT /api/v1/contractor/profile`:

```json
{
  "displayName": "Бригада Мастер",
  "bio": "Строим дома под ключ.",
  "avatarAttachmentId": null,
  "specializationIds": ["house-building"],
  "serviceLocationIds": ["ru-region-43"],
  "portfolio": []
}
```

Список исполнителей: `GET /api/v1/contractors?specializationId=house-building&regionId=ru-region-43&sort=rating&limit=20&offset=0`.
Названия специализаций и локаций уже находятся в `specializations` и `serviceLocations`.

## 3. Отклик → выбор → завершение → отзыв

Используйте разные аккаунты заказчика и исполнителя.

1. Исполнитель ищет заказ: `GET /api/v1/orders?query=дом&sort=relevance&limit=20&offset=0`.
2. Исполнитель отправляет `POST /api/v1/orders/ORDER_ID/bids` со своей сессией:

```json
{
  "message": "Готов выполнить работу качественно и в срок.",
  "priceMinMinor": 500000000,
  "priceMaxMinor": 650000000,
  "durationDaysMin": 90,
  "durationDaysMax": 120,
  "visibility": "private"
}
```

3. Заказчик читает `GET /api/v1/customer/orders/ORDER_ID/bids`.
4. Заказчик выбирает отклик: `POST /api/v1/customer/orders/ORDER_ID/bids/BID_ID/select` без тела.
5. Заказ переходит в `in_progress`. Публичная карточка перестаёт быть доступна; кабинет заказчика использует свой endpoint. Редактирование и обычная отмена теперь запрещены.
6. Любой из двух участников завершает работу: `POST /api/v1/orders/ORDER_ID/complete`.
7. Участник оставляет отзыв: `POST /api/v1/orders/ORDER_ID/reviews` с `{"score":5,"text":"Работа выполнена качественно и в срок."}`.

Переписка по отклику доступна обоим собеседникам через GET/POST `/api/v1/bids/BID_ID/messages`. GET принимает limit/offset, возвращает canSend; POST — `{text, clientMessageId: crypto.randomUUID()}`. Для повторной отправки того же запроса сохраняйте clientMessageId. История идёт newest first, UI разворачивает страницу для чата. authorId=null у старого сообщения — неизвестный/удалённый автор, не текущий пользователь. Текст обычный, его нужно экранировать. В message_received из inbox есть bidId для открытия диалога. Письма регулируются email.messageReceived. Полные правила приватности, состояний и повторов: [bid-messaging.md](bid-messaging.md).

Отзывы профиля — единая лента `GET /api/v1/contractors/CONTRACTOR_ID/reviews?limit=20&offset=0`, без отдельного блока старых отзывов. Перенесённые положительные отзывы имеют score=5, отрицательные score=2. У отзыва без заказа orderId и orderTitle равны null: не рисуйте фиктивную ссылку на сделку. `ratingAverage` и `reviewCount` профиля/каталога считают новые и перенесённые опубликованные отзывы вместе; скрытые/оспариваемые исключены. Среднее округляется до 2 знаков; при отсутствии отзывов ratingAverage=null, reviewCount=0. Баллы за входы, PRO, портфолио и прочую активность не используются.

Собственные отклики: `GET /api/v1/contractor/bids`. Отзыв своего активного отклика: `POST /api/v1/contractor/bids/BID_ID/withdraw`.
Автор и получатель отзыва определяются сервером; повторный отзыв возвращает `409 REVIEW_ALREADY_EXISTS`.

## 4. Файлы

1. Гость запрашивает `POST /api/v1/guest-attachments/upload-requests`; аккаунт — `POST /api/v1/attachments/upload-requests`.
2. Передать имя, MIME и точный `file.size`. Для аккаунта также передать `purpose`: `profile_avatar`, `portfolio` или `order`.
3. В production гостевому запросу нужен `captchaToken` Turnstile с action `guest_attachment_upload`.
4. Выполнить прямой **PUT бинарного содержимого** на `uploadUrl` со всеми `uploadHeaders`. Не отправлять Bearer token API в S3, не оборачивать файл в JSON или multipart.
5. Подтвердить через `POST /api/v1/attachments/ATTACHMENT_ID/confirm` с Bearer token либо `POST /api/v1/guest-attachments/ATTACHMENT_ID/confirm` с `{"claimToken":"CLAIM_TOKEN"}`.
6. Повторять подтверждение с интервалом до `ready` или `rejected`. Статус `processing` означает проверку антивирусом и обработку изображения.
7. Гость передаёт пары `attachmentId` + `claimToken` в `temporaryAttachments` заказа. Аккаунт передаёт готовые IDs в профиль или редактируемый заказ.

Аватар: JPEG/PNG/WebP, до 5 MiB. Портфолио и заказ: те же изображения или PDF, до 20 MiB.
Открытый файл: `GET /api/v1/attachments/ATTACHMENT_ID/download-url`, превью — `/preview-url`.
URL короткоживущий: после истечения запросите новый. До привязки к публичному объекту URL не выдаётся.

## 5. Редактирование и уведомления

Заказчик меняет заказ полным `PUT /api/v1/customer/orders/ORDER_ID` только в `draft`/`published`.
Тело содержит `categoryId`, `locationId`, `title`, `description`, `budgetMinMinor`, `budgetMaxMinor`, `attachmentIds`.
Отмена: `POST /api/v1/customer/orders/ORDER_ID/cancel`. Существующие отклики сохраняются при редактировании; при отмене закрываются.

Уведомления: `GET /api/v1/notifications?limit=20&offset=0`, прочтение — `POST /api/v1/notifications/NOTIFICATION_ID/read`.
`unreadCount` считается по всему кабинету. Уведомления появляются после обработки outbox, поэтому обновляйте список с интервалом.
Email-настройки читаются и заменяются через `GET`/`PUT /api/v1/notification-preferences`:

```json
{"email":{"bidSubmitted":false,"bidSelected":true,"orderCompleted":true}}
```

Отключение email не убирает уведомления из кабинета и не отключает письма входа/безопасности.

## 6. Смена email и удаление аккаунта

Смена email: авторизованный `POST /api/v1/auth/email-change-requests` с `{"email":"new@example.com"}`.
Frontend обрабатывает `/auth/email-change/confirm?token=...` и отправляет `POST /api/v1/auth/email-change-requests/confirm` с токеном.
После `204` все старые сессии отозваны — предложить вход на новый адрес.

Удаление: авторизованный `POST /api/v1/auth/account-deletion-requests` без тела. Это только отправляет письмо.
Страница `/auth/account-deletion/confirm?token=...` должна явно предложить подтвердить необратимое удаление, затем выполнить `POST /api/v1/auth/account-deletion-requests/confirm` с токеном.
При `204` очистить локальную сессию. При заказах в работе сервер возвращает `409 ACCOUNT_HAS_ONGOING_ORDERS` и ничего не удаляет.

## Ошибки

```json
{"error":{"code":"ORDER_NOT_EDITABLE","message":"Order can no longer be edited","requestId":"req-1","details":{}}}
```

Frontend ориентируется на `error.code`, а не на английский `message`. `requestId` пригодится для обращения в поддержку.
`details` может отсутствовать. `400` — форма запроса; `401` — сессия; `404` — объект/токен не найден;
`409` — состояние; `410` — истёкшая ссылка; `422` — бизнес-валидация; `429` — лимит с заголовком `Retry-After`; `500` — ошибка сервера.
Подробные ограничения полей, enum-значения и ответы каждого метода находятся в Swagger.
