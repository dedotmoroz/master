import type { OpenAPIV3 } from "openapi-types";

type Schema = OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
const text = (example?: string): OpenAPIV3.SchemaObject => ({ type: "string", ...(example ? { example } : {}) });
const id = text("b65fb61d-89dc-4929-bafe-67b2d8716a21");
const date: Schema = { type: "string", format: "date-time" };
const nullableDate: Schema = { type: "string", format: "date-time", nullable: true };
const nullableId: Schema = { type: "string", nullable: true };
const integer: Schema = { type: "integer", minimum: 0 };
const money: Schema = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER, nullable: true, description: "Сумма в копейках; null — не указана." };
const boolean: Schema = { type: "boolean" };
const ref = (name: string): OpenAPIV3.ReferenceObject => ({ $ref: `#/components/schemas/${name}` });
const array = (items: Schema): Schema => ({ type: "array", items });
const object = (properties: Record<string, Schema>, optional: string[] = []): OpenAPIV3.SchemaObject => ({
  type: "object", properties, required: Object.keys(properties).filter((key) => !optional.includes(key)), additionalProperties: false,
});
const page = (items: Schema, extra: Record<string, Schema> = {}) => object({ items: array(items), total: integer,
  limit: { type: "integer", minimum: 1, maximum: 100 }, offset: integer, ...extra });
const orderFields = { id, categoryId: text("house-building"), locationId: text("ru-locality-1"), title: text("Построить загородный дом"), budget: ref("Budget") };
const namedPlaceFields = { categoryName: text("Строительство домов и коттеджей"), locationName: text("Москва"), regionId: text("ru-region-1"), regionName: text("Москва") };
const bidFields = { id, orderId: id, contractorId: id, message: text("Готов выполнить работу качественно и в срок."), price: ref("Budget"),
  durationDaysMin: { type: "integer", minimum: 1, nullable: true } as Schema,
  durationDaysMax: { type: "integer", minimum: 1, nullable: true } as Schema,
  visibility: { type: "string", enum: ["public", "private"] } as Schema,
  status: { type: "string", enum: ["submitted", "selected", "rejected", "withdrawn", "cancelled"] } as Schema,
  submittedAt: date, decidedAt: nullableDate };
const profileFields = { displayName: text("Бригада Мастер"), bio: text("Строим дома под ключ."), avatarAttachmentId: nullableId,
  specializationIds: array(text("house-building")), serviceLocationIds: array(text("ru-region-43")), portfolio: array(ref("PortfolioItem")) };
const contractorFields = { id, avatarAttachmentId: nullableId, specializationIds: profileFields.specializationIds,
  specializations: array(object({ id: text("house-building"), name: text("Строительство домов и коттеджей") })),
  serviceLocationIds: profileFields.serviceLocationIds,
  serviceLocations: array(object({ id: text("ru-region-43"), name: text("Московская область"), kind: { type: "string", enum: ["region", "locality"] }, regionId: text("ru-region-43"), regionName: text("Московская область") })),
  memberSince: date, ratingAverage: { type: "number", minimum: 1, maximum: 5, nullable: true } as Schema,
  reviewCount: integer, completedOrderCount: integer };
const locationFields = { id: text("ru-locality-1"), kind: { type: "string", enum: ["region", "locality"] } as Schema,
  parentId: nullableId, name: text("Москва"), slug: text("moskva"), active: boolean,
  latitude: { type: "number", minimum: -90, maximum: 90, nullable: true } as Schema,
  longitude: { type: "number", minimum: -180, maximum: 180, nullable: true } as Schema };
const preferencesEmail = object({ bidSubmitted: boolean, bidSelected: boolean, orderCompleted: boolean, messageReceived: boolean });
const messageFields = { id, bidId: id, orderId: id, authorId: nullableId, text: text(), createdAt: date };

export const responseSchemas: Record<string, OpenAPIV3.SchemaObject> = {
  Error: object({ error: object({ code: text("ORDER_NOT_FOUND"), message: text("Order was not found"), requestId: text("req-1"),
    details: { type: "object", additionalProperties: true } }, ["details"]) }),
  Health: object({ status: { type: "string", enum: ["ok"] } }),
  Readiness: object({ status: { type: "string", enum: ["ready", "unavailable"] } }),
  PendingEmail: object({ status: { type: "string", enum: ["pending_email"] } }),
  Session: object({ type: { type: "string", enum: ["Bearer"] }, token: text("SESSION_TOKEN") }),
  AuthAccount: object({ id, email: { type: "string", format: "email" }, capabilities: array({ type: "string", enum: ["customer", "contractor", "admin"] }) }),
  Account: object({ id, email: { type: "string", format: "email" }, status: { type: "string", enum: ["active", "suspended", "deleted"] },
    capabilities: array({ type: "string", enum: ["customer", "contractor", "admin"] }), createdAt: date }),
  Authentication: object({ account: ref("AuthAccount"), createdAccount: boolean, session: ref("Session") }),
  GuestSubmission: object({ submissionId: id, status: { type: "string", enum: ["pending_email"] }, expiresAt: date }),
  GuestConfirmation: object({ accountId: id, orderId: id, reusedAccount: boolean, alreadyConfirmed: boolean, session: ref("Session") }),
  Budget: object({ minMinor: money, maxMinor: money, currency: { type: "string", enum: ["RUB"] } }),
  CustomerOrderSummary: object({ ...orderFields, status: { type: "string", enum: ["draft", "published", "in_progress", "completed", "cancelled"] }, createdAt: date, publishedAt: nullableDate }),
  CustomerOrder: object({ ...orderFields, customerId: id, description: text(), attachmentIds: array(id),
    status: { type: "string", enum: ["draft", "published", "in_progress", "completed", "cancelled"] }, selectedBidId: nullableId,
    contractorId: nullableId, createdAt: date, publishedAt: nullableDate, completedAt: nullableDate }),
  PublicOrderSummary: object({ ...orderFields, ...namedPlaceFields, descriptionPreview: text(), publishedAt: date, bidCount: integer }),
  PublicOrder: object({ ...orderFields, ...namedPlaceFields, description: text(), attachmentIds: array(id), publishedAt: date, bidCount: integer }),
  CustomerOrderPage: page(ref("CustomerOrderSummary")), PublicOrderPage: page(ref("PublicOrderSummary")),
  Bid: object(bidFields), BidListItem: object({ ...bidFields, orderTitle: text() }), BidPage: page(ref("BidListItem")),
  BidSelection: object({ orderId: id, bidId: id, contractorId: id, orderStatus: { type: "string", enum: ["in_progress"] } }),
  OrderCompletion: object({ orderId: id, customerId: id, contractorId: id, status: { type: "string", enum: ["completed"] }, completedAt: date }),
  OrderDeal: object({ orderId: id, title: text(), status: { type: "string", enum: ["draft", "published", "in_progress", "completed", "cancelled"] }, customerId: id, contractorId: nullableId, selectedBidId: nullableId, completedAt: nullableDate, ownReview: { anyOf: [ref("Review"), { type: "object", nullable: true, enum: [null] }] } }),
  Review: object({ id, orderId: id, authorId: id, subjectId: id, score: { type: "integer", minimum: 1, maximum: 5 }, text: text(),
    status: { type: "string", enum: ["published", "hidden", "disputed"] }, createdAt: date }),
  ReviewPage: page(object({ id, orderId: nullableId, orderTitle: { type: "string", nullable: true }, authorId: id, score: { type: "integer", minimum: 1, maximum: 5 }, text: text(), createdAt: date })),
  PortfolioItem: object({ title: text(), description: text(), attachmentIds: array(id) }),
  OwnContractorProfile: object({ accountId: id, ...profileFields, createdAt: date, updatedAt: date }),
  ContractorProfile: object({ ...contractorFields, displayName: { type: "string", nullable: true }, bio: text(), portfolio: profileFields.portfolio }),
  ContractorSummary: object({ ...contractorFields, displayName: profileFields.displayName, bioPreview: text() }),
  ContractorPage: page(ref("ContractorSummary")),
  Attachment: object({ id, ownerId: nullableId, purpose: { type: "string", enum: ["profile_avatar", "portfolio", "order", "guest_order"] },
    originalFileName: text("plan.pdf"), contentType: text("application/pdf"), sizeBytes: { type: "integer", minimum: 1 },
    status: { type: "string", enum: ["pending_upload", "processing", "ready", "rejected", "cleanup_pending"] },
    createdAt: date, expiresAt: date, uploadedAt: nullableDate, processedAt: nullableDate, previewAvailable: boolean, rejectionReason: { type: "string", nullable: true } }),
  AttachmentUpload: object({ attachment: ref("Attachment"), uploadUrl: { type: "string", format: "uri" }, uploadHeaders: { type: "object", additionalProperties: { type: "string" } } }),
  GuestAttachmentUpload: object({ attachment: ref("Attachment"), uploadUrl: { type: "string", format: "uri" }, uploadHeaders: { type: "object", additionalProperties: { type: "string" } }, claimToken: text("CLAIM_TOKEN") }),
  DownloadUrl: object({ url: { type: "string", format: "uri" }, expiresInSeconds: integer, contentType: text("image/webp") }),
  WorkCategory: object({ id: text("construction"), parentId: nullableId, name: text("Строительство"), description: text(), sortOrder: integer,
    active: boolean, selectable: boolean, children: array(ref("WorkCategory")) }),
  WorkCategories: object({ items: array(ref("WorkCategory")) }),
  RussianRegion: object(locationFields), RussianLocality: object({ ...locationFields, regionName: text("Москва") }),
  Regions: object({ countryCode: { type: "string", enum: ["RU"] }, items: array(ref("RussianRegion")) }),
  Localities: object({ countryCode: { type: "string", enum: ["RU"] }, items: array(ref("RussianLocality")) }),
  Notification: object({ id, kind: { type: "string", enum: ["bid_submitted", "bid_selected", "order_completed", "message_received"] }, orderId: id, bidId: nullableId, title: text(), text: text(), createdAt: date, readAt: nullableDate }),
  NotificationPage: page(ref("Notification"), { unreadCount: integer }),
  NotificationPreferences: object({ email: preferencesEmail }),
  BidMessage: object({ ...messageFields, authorId: id, clientMessageId: { type: "string", format: "uuid" } }),
  BidMessagePage: page(object(messageFields), { canSend: boolean }),
};

type Operation = Readonly<{
  operationId: string; summary: string; tag: string; status: number; response?: string;
  secured?: boolean; description?: string; errors?: readonly number[]; example?: unknown;
}>;
const operation = (operationId: string, summary: string, tag: string, response: string | undefined, extra: Partial<Operation> = {}): Operation => ({
  operationId, summary, tag, status: 200, ...(response ? { response } : {}), ...extra,
});
const secured = { secured: true, errors: [401, 404, 409, 422] } as const;
const confirmErrors = [404, 409, 410, 422];
const requestEmailExample = { email: "customer@example.com" };
const tokenExample = { token: "TOKEN_FROM_EMAIL_LINK" };
const guestOrderExample = { email: "customer@example.com", contactName: "Анна", categoryId: "house-building", locationId: "ru-locality-1",
  title: "Построить загородный дом", description: "Ищу бригаду для строительства дома по готовому проекту.",
  budgetMinMinor: 500000000, budgetMaxMinor: 700000000, temporaryAttachments: [], consentVersion: "2026-01" };

export const documentedOperations: Readonly<Record<string, Operation>> = {
  "GET /api/v1/bids/:bidId/messages": operation("listBidMessages", "Переписка по отклику", "Переписка", "BidMessagePage", {
    ...secured, description: "Только заказчик и автор отклика, включая публичные отклики. Чужой/несуществующий отклик — 404. Новые и достоверно связанные перенесённые сообщения вместе, newest first, limit/offset. У удалённого автора старого сообщения authorId=null. Завершённые/закрытые диалоги доступны для чтения, если оба аккаунта активны." }),
  "POST /api/v1/bids/:bidId/messages": operation("sendBidMessage", "Отправить сообщение", "Переписка", "BidMessage", {
    ...secured, status: 201, errors: [401,404,409,422,429], example: { text: "Когда удобно обсудить работу?", clientMessageId: "00000000-0000-4000-8000-000000000001" },
    description: "Текст 1–5000 символов; только активные участники при заказе published/in_progress и отклике submitted/selected. Прочие состояния — 409 CONVERSATION_READ_ONLY. clientMessageId — UUID, созданный клиентом один раз: повтор с тем же текстом возвращает прежнее сообщение, другой текст — 409. До 20 новых сообщений в минуту на аккаунт. Сообщение, уведомление собеседнику и почтовый outbox сохраняются атомарно. Текст переписки в уведомление/email не копируется." }),
  "GET /health/live": operation("getLiveness", "Проверка процесса", "Health", "Health"),
  "GET /health/ready": operation("getReadiness", "Готовность API и доступность БД", "Health", "Readiness", { errors: [503],
    description: "200 — API готов и PostgreSQL отвечает; 503 — ошибка БД, таймаут (не более 2 секунд) или завершение приложения. Доступность SMTP/S3/ClamAV не проверяется. Состояние фоновой очереди — npm run diagnostics; готовность API не гарантирует доставку писем." }),
  "GET /api/v1/work-categories": operation("listWorkCategories", "Дерево категорий работ", "Справочники", "WorkCategories", { description: "В заказах и профилях выбираются только активные selectable-категории; корневые группы не выбираются." }),
  "GET /api/v1/regions": operation("listRussianRegions", "Регионы России", "Справочники", "Regions"),
  "GET /api/v1/locations": operation("searchRussianLocalities", "Поиск населённых пунктов", "Справочники", "Localities", { errors: [422], description: "Нужны минимум два символа query или regionId; limit по умолчанию 20, максимум 50." }),
  "POST /api/v1/auth/registrations": operation("requestRegistration", "Регистрация по email", "Аккаунт", "PendingEmail", { status: 202, errors: [422, 429], example: requestEmailExample, description: "Аккаунт создаётся после подтверждения email. Уже зарегистрированный активный адрес превращает подтверждение во вход. Ответ не раскрывает наличие аккаунта." }),
  "POST /api/v1/auth/registrations/confirm": operation("confirmRegistration", "Подтверждение регистрации", "Аккаунт", "Authentication", { errors: confirmErrors, example: tokenExample }),
  "POST /api/v1/auth/login-requests": operation("requestLogin", "Запрос ссылки входа", "Аккаунт", "PendingEmail", { status: 202, errors: [422, 429], example: requestEmailExample, description: "Для неизвестного или неактивного email возвращается такой же 202, но письмо не отправляется." }),
  "POST /api/v1/auth/login-requests/confirm": operation("confirmLogin", "Вход по email-ссылке", "Аккаунт", "Authentication", { errors: confirmErrors, example: tokenExample }),
  "GET /api/v1/auth/me": operation("getOwnAccount", "Текущий аккаунт", "Аккаунт", "Account", secured),
  "DELETE /api/v1/auth/session": operation("logout", "Завершить текущую сессию", "Аккаунт", undefined, { ...secured, status: 204 }),
  "DELETE /api/v1/auth/sessions": operation("logoutAll", "Завершить все сессии", "Аккаунт", undefined, { ...secured, status: 204 }),
  "POST /api/v1/auth/email-change-requests": operation("requestEmailChange", "Запрос смены email", "Аккаунт", "PendingEmail", { ...secured, status: 202, errors: [401, 409, 422, 429], example: { email: "new@example.com" } }),
  "POST /api/v1/auth/email-change-requests/confirm": operation("confirmEmailChange", "Подтвердить новый email", "Аккаунт", undefined, { status: 204, errors: confirmErrors, example: tokenExample, description: "Все старые сессии отзываются. После подтверждения войдите через новый email." }),
  "POST /api/v1/auth/account-deletion-requests": operation("requestAccountDeletion", "Запрос удаления аккаунта", "Аккаунт", "PendingEmail", { ...secured, status: 202, errors: [401, 409, 429], description: "Удаление запрещено при заказах in_progress в роли заказчика или выбранного исполнителя." }),
  "POST /api/v1/auth/account-deletion-requests/confirm": operation("confirmAccountDeletion", "Подтвердить удаление аккаунта", "Аккаунт", undefined, { status: 204, errors: confirmErrors, example: tokenExample, description: "Необратимо: обезличивание аккаунта, отзыв сессий, очистка профиля и файлов. История завершённых сделок и отзывов сохраняется." }),
  "POST /api/v1/guest-orders": operation("submitGuestOrder", "Создать заказ без регистрации", "Гостевой заказ", "GuestSubmission", { status: 202, errors: [409, 422], example: guestOrderExample, description: "Заказ публикуется только после подтверждения email. temporaryAttachments содержит готовые гостевые файлы и их claimToken." }),
  "POST /api/v1/guest-orders/confirm": operation("confirmGuestOrder", "Подтвердить email и опубликовать заказ", "Гостевой заказ", "GuestConfirmation", { errors: confirmErrors, example: tokenExample, description: "Повторное подтверждение идемпотентно: один заказ, новый Bearer token в ответе." }),
  "POST /api/v1/guest-attachments/upload-requests": operation("requestGuestAttachmentUpload", "Загрузка гостевого вложения", "Файлы", "GuestAttachmentUpload", { status: 201, errors: [403, 422, 429], example: { originalFileName: "plan.pdf", contentType: "application/pdf", sizeBytes: 1024, captchaToken: "TURNSTILE_TOKEN" }, description: "В production обязателен Turnstile captchaToken. Сохраните claimToken. Затем PUT файла напрямую на uploadUrl со всеми uploadHeaders." }),
  "POST /api/v1/guest-attachments/:attachmentId/confirm": operation("confirmGuestAttachment", "Подтвердить гостевую загрузку", "Файлы", "Attachment", { errors: confirmErrors, example: { claimToken: "CLAIM_TOKEN" }, description: "После проверки объекта статус processing. Повторяйте запрос до ready или rejected; передавать файл в заказ можно только после ready." }),
  "POST /api/v1/attachments/upload-requests": operation("requestAttachmentUpload", "Загрузка файла аккаунта", "Файлы", "AttachmentUpload", { ...secured, status: 201, example: { purpose: "order", originalFileName: "plan.pdf", contentType: "application/pdf", sizeBytes: 1024 }, description: "purpose: order, portfolio или profile_avatar. Avatar: только изображения, до 5 MiB; остальные: изображения/PDF, до 20 MiB. После запроса загрузите файл напрямую в S3." }),
  "POST /api/v1/attachments/:attachmentId/confirm": operation("confirmAttachmentUpload", "Подтвердить загрузку своего файла", "Файлы", "Attachment", { ...secured, errors: [401, 404, 409, 410, 422], description: "Проверка MIME/размера, затем антивирус и обработка. Повторяйте до ready/rejected." }),
  "GET /api/v1/attachments/:attachmentId/download-url": operation("getPublicAttachmentUrl", "Временная ссылка на публичный файл", "Файлы", "DownloadUrl", { errors: [404], description: "Доступен только ready-файл, привязанный к публичному объекту. PDF скачивается как attachment." }),
  "GET /api/v1/attachments/:attachmentId/preview-url": operation("getPublicAttachmentPreviewUrl", "Временная ссылка на превью", "Файлы", "DownloadUrl", { errors: [404] }),
  "GET /api/v1/attachments/:attachmentId/owner-preview-url": operation("getOwnAttachmentPreviewUrl", "Превью своего проверенного файла, включая черновики", "Файлы", "DownloadUrl", { secured: true, errors: [401, 404] }),
  "GET /api/v1/attachments/:attachmentId/owner-download-url": operation("getOwnAttachmentUrl", "Скачать свой проверенный файл, включая черновики", "Файлы", "DownloadUrl", { secured: true, errors: [401, 404] }),
  "GET /api/v1/orders": operation("listPublicOrders", "Поиск опубликованных заказов", "Заказы", "PublicOrderPage", { errors: [422], description: "Пагинация limit/offset (по умолчанию 20/0). Бюджет в копейках, фильтр проверяет пересечение диапазонов. Регион включает свои населённые пункты. С query сортировка по умолчанию relevance, иначе newest." }),
  "GET /api/v1/orders/:orderId": operation("getPublicOrder", "Публичный заказ", "Заказы", "PublicOrder", { errors: [404], description: "Только опубликованные заказы активных заказчиков. После выбора исполнителя публичная карточка возвращает 404." }),
  "GET /api/v1/customer/orders": operation("listCustomerOrders", "Собственные заказы", "Кабинет заказчика", "CustomerOrderPage", secured),
  "GET /api/v1/customer/orders/:orderId": operation("getCustomerOrder", "Собственный заказ", "Кабинет заказчика", "CustomerOrder", secured),
  "PUT /api/v1/customer/orders/:orderId": operation("updateCustomerOrder", "Изменить условия заказа", "Кабинет заказчика", "CustomerOrder", { ...secured, example: { categoryId: "house-building", locationId: "ru-locality-1", title: guestOrderExample.title, description: guestOrderExample.description, budgetMinMinor: 500000000, budgetMaxMinor: 700000000, attachmentIds: [] }, description: "Полная замена редактируемых полей, только draft/published. После назначения исполнителя — 409 ORDER_NOT_EDITABLE. Дата публикации и отклики сохраняются." }),
  "POST /api/v1/customer/orders/:orderId/cancel": operation("cancelCustomerOrder", "Отменить заказ", "Кабинет заказчика", "CustomerOrder", { ...secured, description: "Только draft/published; активные отклики закрываются. Повторная отмена идемпотентна." }),
  "POST /api/v1/orders/:orderId/bids": operation("submitBid", "Откликнуться на заказ", "Отклики", "Bid", { ...secured, status: 201, example: { message: "Готов выполнить работу качественно и в срок.", priceMinMinor: 500000000, priceMaxMinor: 650000000, durationDaysMin: 90, durationDaysMax: 120, visibility: "public" }, description: "Свой заказ и повторный активный отклик запрещены. Первый отклик добавляет capability contractor." }),
  "GET /api/v1/customer/orders/:orderId/bids": operation("listOrderBids", "Отклики на свой заказ", "Отклики", "BidPage", secured),
  "POST /api/v1/customer/orders/:orderId/bids/:bidId/select": operation("selectBid", "Выбрать исполнителя", "Отклики", "BidSelection", { ...secured, description: "Выбранный отклик selected, остальные rejected, заказ in_progress. Оба участника должны быть активны." }),
  "GET /api/v1/contractor/bids": operation("listOwnBids", "Собственные отклики", "Отклики", "BidPage", secured),
  "POST /api/v1/contractor/bids/:bidId/withdraw": operation("withdrawBid", "Отозвать свой отклик", "Отклики", "Bid", secured),
  "POST /api/v1/orders/:orderId/complete": operation("completeOrder", "Завершить заказ", "Репутация", "OrderCompletion", { ...secured, description: "Только заказчик или выбранный исполнитель. Повторное завершение идемпотентно." }),
  "GET /api/v1/orders/:orderId/deal": operation("getOrderDeal", "Состояние сделки и собственный отзыв", "Репутация", "OrderDeal", { ...secured, description: "Только заказчик или выбранный исполнитель. Чужая и отсутствующая сделка дают 404; чужой отзыв не возвращается." }),
  "POST /api/v1/orders/:orderId/reviews": operation("submitReview", "Оставить отзыв по сделке", "Репутация", "Review", { ...secured, status: 201, example: { score: 5, text: "Работа выполнена качественно и в срок." }, description: "Только после завершения. Получатель определяется как второй участник; один отзыв от участника на сделку." }),
  "GET /api/v1/contractors": operation("listContractors", "Поиск исполнителей", "Исполнители", "ContractorPage", { errors: [422], description: "Пагинация limit/offset. Фильтры специализации, региона, конкретной локации и минимального рейтинга. По умолчанию rating, с query — relevance." }),
  "GET /api/v1/contractors/:contractorId": operation("getContractorProfile", "Публичный профиль исполнителя", "Исполнители", "ContractorProfile", { errors: [404] }),
  "GET /api/v1/contractors/:contractorId/reviews": operation("listContractorReviews", "Отзывы об исполнителе", "Репутация", "ReviewPage", { errors: [404],
    description: "Единая лента опубликованных отзывов, новые и перенесённые вместе; порядок createdAt DESC, id DESC, пагинация limit/offset. Старые положительные оценки переведены в 5, отрицательные в 2. У отзывов без заказа orderId и orderTitle равны null. ratingAverage и reviewCount профиля/каталога учитывают все опубликованные отзывы, без старых баллов за активность/PRO." }),
  "GET /api/v1/contractor/profile": operation("getOwnContractorProfile", "Собственный профиль исполнителя", "Исполнители", "OwnContractorProfile", secured),
  "PUT /api/v1/contractor/profile": operation("upsertContractorProfile", "Сохранить профиль исполнителя", "Исполнители", "OwnContractorProfile", { ...secured, example: { displayName: "Бригада Мастер", bio: "Строим дома под ключ.", avatarAttachmentId: null, specializationIds: ["house-building"], serviceLocationIds: ["ru-region-43"], portfolio: [] }, description: "Полная замена профиля. Вложения должны быть ready, нужного назначения и принадлежать аккаунту. До 20 проектов, от 1 до 10 файлов в каждом. Создание добавляет capability contractor." }),
  "GET /api/v1/notifications": operation("listNotifications", "Уведомления своего аккаунта", "Уведомления", "NotificationPage", { ...secured, description: "total и unreadCount — по всему списку аккаунта, независимо от limit/offset." }),
  "POST /api/v1/notifications/:notificationId/read": operation("readNotification", "Отметить уведомление прочитанным", "Уведомления", undefined, { ...secured, status: 204, description: "Идемпотентно. Чужое уведомление возвращает 404." }),
  "GET /api/v1/notification-preferences": operation("getNotificationPreferences", "Настройки email-уведомлений", "Уведомления", "NotificationPreferences", { ...secured, description: "Все четыре типа писем по умолчанию включены, в том числе messageReceived. Письма безопасности и входа обязательны." }),
  "PUT /api/v1/notification-preferences": operation("updateNotificationPreferences", "Изменить настройки email", "Уведомления", "NotificationPreferences", { ...secured, example: { email: { bidSubmitted: false, bidSelected: true, orderCompleted: true, messageReceived: true } }, description: "Полная замена трёх прежних настроек; messageReceived управляет email переписки. Для совместимости старый запрос без messageReceived сохраняет прежнее значение этой настройки. Настройки учитываются при отправке, включая повторы. Уведомления в кабинете сохраняются; повторное включение не отправляет ранее пропущенные письма." }),
};

const errorDescriptions: Record<number, string> = {
  400: "INVALID_REQUEST: ошибка структуры/типа запроса.", 401: "AUTHENTICATION_REQUIRED: нужен действующий Bearer token.",
  403: "Недостаточно прав или не пройдена проверка человека.", 404: "Объект/токен не найден. Чужие объекты также возвращают 404.",
  409: "Конфликт состояния: заказ уже в работе, адрес занят, есть незавершённые сделки или повторный отклик.",
  410: "Срок действия одноразовой ссылки или upload-запроса истёк.", 422: "Нарушено бизнес-правило: неверный диапазон, неизвестная категория/локация, непригодное вложение.",
  429: "RATE_LIMIT_EXCEEDED: повторите запрос через Retry-After секунд.", 500: "INTERNAL_ERROR: внутренняя ошибка; requestId нужен для диагностики.",
};

export function operationDocumentation(method: string, url: string) {
  const metadata = documentedOperations[`${method.toUpperCase()} ${url}`];
  if (!metadata) throw new Error(`Missing OpenAPI documentation: ${method} ${url}`);
  const response: Record<string, unknown> = {
    [metadata.status]: metadata.response ? { ...ref(metadata.response), description: "Успешный ответ" } : { type: "null", description: "Успешно. Тело ответа отсутствует." },
  };
  for (const code of new Set([400, 500, ...(metadata.errors ?? [])])) {
    response[code] = code === 503
      ? { ...ref("Readiness"), description: "База данных недоступна" }
      : { ...ref("Error"), description: errorDescriptions[code] ?? "Ошибка", ...(code === 429 ? {
        headers: { "Retry-After": { description: "Число секунд до повторной попытки", type: "integer", minimum: 0 } },
      } : code === 401 ? { headers: { "WWW-Authenticate": { type: "string", enum: ["Bearer"] } } } : {}) };
  }
  for (const item of Object.values(response) as Array<Record<string, unknown>>) {
    item.headers = { ...(item.headers as Record<string, unknown> | undefined),
      "X-Request-Id": { type: "string", format: "uuid", description: "Серверный идентификатор запроса для поиска в логах. Входящий X-Request-Id не принимается." } };
  }
  return { operationId: metadata.operationId, summary: metadata.summary, tags: [metadata.tag],
    description: metadata.description ?? metadata.summary,
    security: metadata.secured ? [{ bearerAuth: [] }] : [], response,
    example: metadata.example };
}
