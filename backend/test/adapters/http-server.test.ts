import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { Writable } from "node:stream";
import { httpLogSerializers } from "../../src/adapters/in/http/observability.ts";
import { readFile } from "node:fs/promises";
import SwaggerParser from "@apidevtools/swagger-parser";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import type { OpenAPIV3 } from "openapi-types";
import { documentedOperations } from "../../src/adapters/in/http/openapi-contract.ts";
import { captureOpenApiResponseValidation } from "../helpers/openapi-response-validation.ts";
import { createHttpServer } from "../../src/adapters/in/http/http-server.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";

const validBody = {
  email: "Customer@Example.com",
  contactName: "Анна",
  categoryId: "house-building",
  locationId: "ru-locality-1",
  title: "Построить загородный дом",
  description: "Ищу бригаду для строительства дома по готовому проекту.",
  budgetMinMinor: 500_000_000,
  budgetMaxMinor: 700_000_000,
  temporaryAttachments: [],
  consentVersion: "2026-01",
};

const contractorProfileBody = {
  displayName: "Бригада Мастер",
  bio: "Строим дома под ключ.",
  avatarAttachmentId: "avatar-1",
  specializationIds: ["house-building"],
  serviceLocationIds: ["ru-region-43"],
  portfolio: [{
    title: "Дом в Истре",
    description: "Газобетонный дом площадью 180 м².",
    attachmentIds: ["photo-1", "photo-2"],
  }],
};

function createFixture(overrides: Readonly<{
  submit?: (command: typeof validBody) => Promise<{ submissionId: string; expiresAt: Date }>;
  confirm?: (token: string) => Promise<{
    accountId: string;
    orderId: string;
    sessionToken: string;
    reusedAccount: boolean;
    alreadyConfirmed: boolean;
  }>;
  readiness?: () => Promise<void>;
  legacyReview?: boolean;
  readinessTimeoutMs?: number;
  logger?: FastifyBaseLogger;
  guestAccess?: (input: Readonly<{
    clientAddress: string;
    humanVerificationToken: string | null;
  }>) => Promise<void>;
}> = {}) {
  const orderView = {
    id: "order-1",
    customerId: "account-1",
    categoryId: "house-building",
    categoryName: "Строительство домов и коттеджей",
    locationId: "ru-locality-1",
    locationName: "Москва",
    regionId: "ru-region-1",
    regionName: "Москва",
    title: "Построить загородный дом",
    description: "Описание заказа",
    budget: { minMinor: 500_000_000, maxMinor: 700_000_000, currency: "RUB" },
    attachmentIds: [],
    status: "published",
    selectedBidId: null,
    contractorId: null,
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    publishedAt: new Date("2026-01-01T10:05:00.000Z"),
    completedAt: null,
  };
  const { categoryName: _categoryName, locationName: _locationName, regionId: _regionId, regionName: _regionName, ...customerOrderView } = orderView;
  return createHttpServer({
    bidMessaging: {
      list: async (_accountId, _bidId, pagination) => ({ items: [], total: 0, canSend: true, ...pagination }),
      send: async (input) => ({ id: "message-1", bidId: input.bidId, orderId: "order-1", authorId: input.accountId,
        clientMessageId: input.clientMessageId, text: input.text, createdAt: new Date("2026-01-01T10:00:00.000Z") }),
    },
    getNotificationPreferences: { execute: async () => ({ email: { bidSubmitted: true, bidSelected: true, orderCompleted: true, messageReceived: true } }) },
    updateNotificationPreferences: { execute: async (_id, preferences) => ({ email: { ...preferences.email, messageReceived: preferences.email.messageReceived ?? true } }) },
    requestAccountDeletion: { execute: async () => undefined },
    confirmAccountDeletion: { execute: async () => undefined },
    requestEmailChange: { execute: async () => undefined },
    confirmEmailChange: { execute: async () => undefined },
    listNotifications: { execute: async (_id, pagination) => ({ items: [], total: 0, unreadCount: 0, ...pagination }) },
    readNotification: { execute: async () => undefined },
    listWorkCategories: {
      execute: async () => [{
        id: "construction",
        parentId: null,
        name: "Строительство",
        description: "",
        sortOrder: 10,
        active: true,
        selectable: false,
        children: [{
          id: "house-building",
          parentId: "construction",
          name: "Строительство домов и коттеджей",
          description: "",
          sortOrder: 10,
          active: true,
          selectable: true,
          children: [],
        }],
      }],
    },
    listRussianRegions: {
      execute: async () => [{
        id: "ru-region-43",
        kind: "region",
        parentId: null,
        name: "Московская область",
        slug: "moskovskaya-oblast",
        active: true,
        latitude: null,
        longitude: null,
      }],
    },
    searchRussianLocalities: {
      execute: async () => [{
        id: "ru-locality-1",
        kind: "locality",
        parentId: "ru-region-42",
        name: "Москва",
        slug: "moskva",
        active: true,
        latitude: 55.7558,
        longitude: 37.6176,
        regionName: "Москва",
      }],
    },
    submitGuestOrder: {
      execute: overrides.submit ?? (async () => ({
        submissionId: "submission-1",
        expiresAt: new Date("2026-01-02T10:00:00.000Z"),
      })),
    },
    confirmGuestOrder: {
      execute: overrides.confirm ?? (async () => ({
        accountId: "account-1",
        orderId: "order-1",
        sessionToken: "session-secret",
        reusedAccount: false,
        alreadyConfirmed: false,
      })),
    },
    sessionAuthenticator: {
      authenticate: async (token) => token === "session-secret"
        ? { accountId: "account-1", capabilities: ["customer"] }
        : null,
    },
    listCustomerOrders: {
      execute: async (_accountId, pagination) => ({
        items: [{
          id: orderView.id,
          categoryId: orderView.categoryId,
          categoryName: orderView.categoryName,
          locationId: orderView.locationId,
          locationName: orderView.locationName,
          regionId: orderView.regionId,
          regionName: orderView.regionName,
          title: orderView.title,
          budgetMinMinor: orderView.budget.minMinor,
          budgetMaxMinor: orderView.budget.maxMinor,
          budgetCurrency: orderView.budget.currency,
          status: "published",
          createdAt: orderView.createdAt,
          publishedAt: orderView.publishedAt,
        }],
        total: 1,
        ...pagination,
      }),
    },
    getCustomerOrder: { execute: async () => customerOrderView },
    updateCustomerOrder: { execute: async (command) => ({
      ...customerOrderView, categoryId: command.categoryId, locationId: command.locationId,
      title: command.title, description: command.description, attachmentIds: command.attachmentIds,
      budget: { minMinor: command.budgetMinMinor, maxMinor: command.budgetMaxMinor, currency: "RUB" },
    }) },
    cancelCustomerOrder: {
      execute: async () => ({ ...customerOrderView, status: "cancelled" }),
    },
    listPublicOrders: {
      execute: async (pagination) => ({
        items: [{
          id: orderView.id,
          categoryId: orderView.categoryId,
          categoryName: orderView.categoryName,
          locationId: orderView.locationId,
          locationName: orderView.locationName,
          regionId: orderView.regionId,
          regionName: orderView.regionName,
          title: orderView.title,
          descriptionPreview: orderView.description,
          budgetMinMinor: orderView.budget.minMinor,
          budgetMaxMinor: orderView.budget.maxMinor,
          budgetCurrency: orderView.budget.currency,
          publishedAt: orderView.publishedAt as Date,
          bidCount: 1,
        }],
        total: 1,
        limit: pagination.limit,
        offset: pagination.offset,
      }),
    },
    listContractors: {
      execute: async (pagination) => ({
        items: [{
          id: "contractor-1",
          displayName: "Бригада Мастер",
          bioPreview: "Строим дома под ключ.",
          avatarAttachmentId: "avatar-1",
          specializationIds: ["house-building"],
          specializations: [{ id: "house-building", name: "Строительство домов и коттеджей" }],
          serviceLocationIds: ["ru-region-43"],
          serviceLocations: [{
            id: "ru-region-43",
            name: "Московская область",
            kind: "region",
            regionId: "ru-region-43",
            regionName: "Московская область",
          }],
          memberSince: new Date("2026-01-01T10:00:00.000Z"),
          ratingAverage: 4.75,
          reviewCount: 4,
          completedOrderCount: 6,
        }],
        total: 1,
        limit: pagination.limit,
        offset: pagination.offset,
      }),
    },
    getPublicOrder: {
      execute: async () => ({
        id: orderView.id,
        categoryId: orderView.categoryId,
        categoryName: orderView.categoryName,
        locationId: orderView.locationId,
        locationName: orderView.locationName,
        regionId: orderView.regionId,
        regionName: orderView.regionName,
        title: orderView.title,
        description: orderView.description,
        budgetMinMinor: orderView.budget.minMinor,
        budgetMaxMinor: orderView.budget.maxMinor,
        budgetCurrency: orderView.budget.currency,
        attachmentIds: [],
        publishedAt: orderView.publishedAt as Date,
        bidCount: 1,
      }),
    },
    submitBid: {
      execute: async (command) => ({
        id: "bid-1",
        orderId: command.orderId,
        contractorId: command.contractorId,
        message: command.message,
        price: { minMinor: command.priceMinMinor, maxMinor: command.priceMaxMinor, currency: "RUB" },
        durationDaysMin: command.durationDaysMin,
        durationDaysMax: command.durationDaysMax,
        visibility: command.visibility,
        status: "submitted",
        submittedAt: new Date("2026-01-02T10:00:00.000Z"),
        decidedAt: null,
      }),
    },
    withdrawBid: {
      execute: async (contractorId, bidId) => ({
        id: bidId,
        orderId: "order-1",
        contractorId,
        message: "Готов выполнить работу.",
        price: { minMinor: 100_000, maxMinor: 150_000, currency: "RUB" },
        durationDaysMin: 5,
        durationDaysMax: 7,
        visibility: "public",
        status: "withdrawn",
        submittedAt: new Date("2026-01-02T10:00:00.000Z"),
        decidedAt: new Date("2026-01-03T10:00:00.000Z"),
      }),
    },
    listContractorBids: {
      execute: async (_contractorId, pagination) => ({ items: [], total: 0, ...pagination }),
    },
    listOrderBids: {
      execute: async (_customerId, _orderId, pagination) => ({ items: [], total: 0, ...pagination }),
    },
    selectBid: {
      execute: async (_customerId, orderId, bidId) => ({
        orderId,
        bidId,
        contractorId: "contractor-1",
        orderStatus: "in_progress",
      }),
    },
    getOrderDeal: { execute: async (_accountId, orderId) => ({ orderId, title: "Работа", status: "in_progress", customerId: "account-1", contractorId: "contractor-1", selectedBidId: "bid-1", completedAt: null, ownReview: null }) },
    completeOrder: {
      execute: async (_accountId, orderId) => ({
        orderId,
        status: "completed",
        customerId: "account-1",
        contractorId: "contractor-1",
        completedAt: new Date("2026-01-04T10:00:00.000Z"),
      }),
    },
    submitReview: {
      execute: async (review) => ({
        id: "review-1",
        orderId: review.orderId,
        authorId: review.authorId,
        subjectId: "contractor-1",
        score: review.score,
        text: review.text,
        status: "published",
        createdAt: new Date("2026-01-04T11:00:00.000Z"),
      }),
    },
    getContractorProfile: {
      execute: async (contractorId) => ({
        id: contractorId,
        displayName: "Бригада Мастер",
        bio: "Строим дома под ключ.",
        avatarAttachmentId: "avatar-1",
        specializationIds: ["house-building"],
        specializations: [{ id: "house-building", name: "Строительство домов и коттеджей" }],
        serviceLocationIds: ["ru-region-43"],
        serviceLocations: [{
          id: "ru-region-43",
          name: "Московская область",
          kind: "region",
          regionId: "ru-region-43",
          regionName: "Московская область",
        }],
        portfolio: [],
        memberSince: new Date("2026-01-01T10:00:00.000Z"),
        ratingAverage: 4.75,
        reviewCount: 4,
        completedOrderCount: 6,
      }),
    },
    listContractorReviews: {
      execute: async (_contractorId, pagination) => ({
        items: [{
          id: "review-1",
          orderId: overrides.legacyReview ? null : "order-1",
          orderTitle: overrides.legacyReview ? null : "Построить загородный дом",
          authorId: "account-1",
          score: overrides.legacyReview ? 2 : 5,
          text: "Работа выполнена качественно и в срок.",
          createdAt: new Date("2026-01-04T11:00:00.000Z"),
        }],
        total: 1,
        ...pagination,
      }),
    },
    upsertContractorProfile: {
      execute: async (profile) => ({
        ...profile,
        createdAt: new Date("2026-01-02T10:00:00.000Z"),
        updatedAt: new Date("2026-01-02T10:00:00.000Z"),
      }),
    },
    getOwnContractorProfile: {
      execute: async (accountId) => ({
        accountId,
        displayName: "Бригада Мастер",
        bio: "Строим дома под ключ.",
        avatarAttachmentId: "avatar-1",
        specializationIds: ["house-building"],
        serviceLocationIds: ["ru-region-43"],
        portfolio: [],
        createdAt: new Date("2026-01-02T10:00:00.000Z"),
        updatedAt: new Date("2026-01-02T10:00:00.000Z"),
      }),
    },
    requestAttachmentUpload: {
      execute: async (command) => ({
        attachment: {
          id: "attachment-1",
          ownerId: command.ownerId,
          purpose: command.purpose,
          originalFileName: command.originalFileName,
          contentType: command.contentType,
          sizeBytes: command.sizeBytes,
          storageKey: "attachments/account-1/attachment-1",
          status: "pending_upload",
          createdAt: new Date("2026-01-02T10:00:00.000Z"),
          expiresAt: new Date("2026-01-02T10:15:00.000Z"),
          uploadedAt: null,
          processedAt: null,
          safeStorageKey: null,
          safeContentType: null,
          safeSizeBytes: null,
          previewStorageKey: null,
          rejectionReason: null,
          guestClaimTokenHash: null,
          claimedSubmissionId: null,
        },
        uploadUrl: "http://storage.local/upload",
        uploadHeaders: { "content-type": command.contentType },
      }),
    },
    confirmAttachmentUpload: {
      execute: async (ownerId, attachmentId) => ({
        id: attachmentId,
        ownerId,
        purpose: "portfolio",
        originalFileName: "house.webp",
        contentType: "image/webp",
        sizeBytes: 1024,
        storageKey: `attachments/${ownerId}/${attachmentId}`,
        status: "processing",
        createdAt: new Date("2026-01-02T10:00:00.000Z"),
        expiresAt: new Date("2026-01-02T10:15:00.000Z"),
        uploadedAt: new Date("2026-01-02T10:01:00.000Z"),
        processedAt: null,
        safeStorageKey: null,
        safeContentType: null,
        safeSizeBytes: null,
        previewStorageKey: null,
        rejectionReason: null,
        guestClaimTokenHash: null,
        claimedSubmissionId: null,
      }),
    },
    requestGuestAttachmentUpload: {
      execute: async (command) => ({
        attachment: {
          id: "guest-attachment-1",
          ownerId: null,
          purpose: "guest_order",
          originalFileName: command.originalFileName,
          contentType: command.contentType,
          sizeBytes: command.sizeBytes,
          storageKey: "guest-attachments/guest-attachment-1",
          status: "pending_upload",
          createdAt: new Date("2026-01-02T10:00:00.000Z"),
          expiresAt: new Date("2026-01-02T10:15:00.000Z"),
          uploadedAt: null,
          processedAt: null,
          safeStorageKey: null,
          safeContentType: null,
          safeSizeBytes: null,
          previewStorageKey: null,
          rejectionReason: null,
          guestClaimTokenHash: "stored-hash",
          claimedSubmissionId: null,
        },
        claimToken: "secret-claim-token",
        uploadUrl: "http://storage.local/guest-upload",
        uploadHeaders: { "content-type": command.contentType },
      }),
    },
    confirmGuestAttachmentUpload: {
      execute: async (attachmentId) => ({
        id: attachmentId,
        ownerId: null,
        purpose: "guest_order",
        originalFileName: "plan.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
        storageKey: `guest-attachments/${attachmentId}`,
        status: "processing",
        createdAt: new Date("2026-01-02T10:00:00.000Z"),
        expiresAt: new Date("2026-01-02T10:15:00.000Z"),
        uploadedAt: new Date("2026-01-02T10:01:00.000Z"),
        processedAt: null,
        safeStorageKey: null,
        safeContentType: null,
        safeSizeBytes: null,
        previewStorageKey: null,
        rejectionReason: null,
        guestClaimTokenHash: "stored-hash",
        claimedSubmissionId: null,
      }),
    },
    guestUploadAccess: {
      assertAllowed: overrides.guestAccess ?? (async () => undefined),
    },
    getPublicAttachmentUrl: {
      execute: async () => ({
        url: "http://storage.local/download",
        expiresInSeconds: 900,
        contentType: "image/webp",
      }),
    },
    getPublicAttachmentPreviewUrl: {
      execute: async () => ({
        url: "http://storage.local/preview",
        expiresInSeconds: 900,
        contentType: "image/webp",
      }),
    },
    requestEmailAuthentication: {
      execute: async () => undefined,
    },
    confirmEmailAuthentication: {
      execute: async (_token, purpose) => ({
        accountId: "account-1",
        email: "user@example.com",
        capabilities: [],
        sessionToken: "session-secret",
        createdAccount: purpose === "registration",
      }),
    },
    logout: {
      revokeCurrent: async () => undefined,
      revokeAll: async () => undefined,
    },
    getOwnAccount: {
      execute: async (accountId) => ({
        id: accountId,
        email: "user@example.com",
        status: "active",
        capabilities: [],
        createdAt: new Date("2026-01-02T10:00:00.000Z"),
      }),
    },
    readinessCheck: overrides.readiness ?? (async () => undefined),
    ...(overrides.readinessTimeoutMs !== undefined ? { readinessTimeoutMs: overrides.readinessTimeoutMs } : {}),
    ...(overrides.logger ? { logger: overrides.logger } : {}),
  });
}

test("request diagnostics log route templates and safe errors, never request secrets", async (context) => {
  let output = "";
  const stream = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
  const logHost = Fastify({ logger: { stream, serializers: httpLogSerializers } });
  const server = createFixture({ logger: logHost.log, confirm: async () => {
    throw new Error("private-email@example.com token=private-token");
  } });
  context.after(async () => { await server.close(); await logHost.close(); });
  const response = await server.inject({ method: "POST", url: "/api/v1/guest-orders/confirm?secret=private-query",
    headers: { authorization: "Bearer private-auth", cookie: "private-cookie", "x-request-id": "private-forged-id" },
    payload: { token: "private-token" } });
  assert.equal(response.statusCode, 500);
  const requestId = response.headers["x-request-id"];
  assert.match(String(requestId), /^[a-f0-9-]{36}$/);
  assert.equal(response.json().error.requestId, requestId);
  const unknown = await server.inject({ method: "GET", url: "/private-unknown?email=private-email@example.com" });
  assert.equal(unknown.statusCode, 404);
  const second = await server.inject({ method: "GET", url: "/health/live" });
  assert.notEqual(second.headers["x-request-id"], requestId);
  logHost.log.error({ err: new Error("private-nested-error") }, "Serializer check");
  assert.doesNotMatch(output, /private-/);
  const entries = output.trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(entries.some((entry) => entry.reqId === requestId && entry.route === "/api/v1/guest-orders/confirm"
    && entry.statusCode === 500 && typeof entry.durationMs === "number"));
});

test("readiness times out safely while liveness stays independent of PostgreSQL", async (context) => {
  const server = createFixture({ readiness: async () => new Promise<void>(() => {}), readinessTimeoutMs: 10 });
  context.after(() => server.close());
  const response = await server.inject({ method: "GET", url: "/health/ready" });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: "unavailable" });
  const live = await server.inject({ method: "GET", url: "/health/live" });
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.json(), { status: "ok" });
});

test("OpenAPI validates, covers every actual route and serves Swagger UI with local assets", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const routes = new Set<string>();
  server.addHook("onRoute", (route) => {
    if (!route.url.startsWith("/api/v1/") && !route.url.startsWith("/health/")) return;
    for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
      if (method !== "HEAD") routes.add(`${method.toLowerCase()} ${route.url.replace(/:([^/]+)/gu, "{$1}")}`);
    }
  });
  const response = await server.inject({ method: "GET", url: "/openapi.json" });
  assert.equal(response.statusCode, 200, response.body);
  const specification = response.json<OpenAPIV3.Document>();
  const exported = JSON.parse(await readFile(new URL("../../docs/openapi.json", import.meta.url), "utf8"));
  assert.deepEqual(exported, specification, "Run npm run openapi:export after changing the API contract");
  await SwaggerParser.validate(structuredClone(specification), { resolve: { external: false } });
  const operations = new Set<string>();
  const operationIds = new Set<string>();
  for (const [path, item] of Object.entries(specification.paths)) {
    for (const [method, value] of Object.entries(item ?? {})) {
      if (!["get", "post", "put", "delete"].includes(method)) continue;
      const operation = value as OpenAPIV3.OperationObject;
      operations.add(`${method} ${path}`);
      assert.ok(operation.summary);
      assert.ok(operation.operationId);
      assert.ok(!operationIds.has(operation.operationId));
      operationIds.add(operation.operationId);
      assert.ok(operation.responses["500"]);
    }
  }
  assert.deepEqual([...operations].sort(), [...routes].sort());
  assert.equal(operations.size, Object.keys(documentedOperations).length);
  assert.deepEqual(specification.paths["/api/v1/auth/me"]?.get?.security, [{ bearerAuth: [] }]);
  assert.deepEqual(specification.paths["/api/v1/guest-orders"]?.post?.security, []);
  assert.equal("content" in specification.paths["/api/v1/auth/session"]!.delete!.responses["204"]!, false);
  const swagger = await server.inject({ method: "GET", url: "/docs/" });
  assert.equal(swagger.statusCode, 200);
  assert.match(swagger.body, /swagger-ui/);
  const json = await server.inject({ method: "GET", url: "/docs/json" });
  assert.equal(json.statusCode, 200);
  assert.deepEqual(json.json(), specification);
  const js = await server.inject({ method: "GET", url: "/docs/static/swagger-ui-bundle.js" });
  assert.equal(js.statusCode, 200);
  const yaml = await server.inject({ method: "GET", url: "/docs/yaml" });
  assert.equal(yaml.statusCode, 200);
  assert.match(yaml.body, /openapi: 3\.0\.3/);
});

test("OpenAPI unified review feed accepts converted legacy scores with no invented order", async (context) => {
  const server = createFixture({ legacyReview: true });
  const verify = captureOpenApiResponseValidation(server);
  context.after(async () => { await server.close(); verify(); });
  const response = await server.inject({ method: "GET", url: "/api/v1/contractors/contractor-1/reviews?limit=10&offset=0" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items[0].score, 2);
  assert.equal(response.json().items[0].orderId, null);
  assert.equal(response.json().items[0].orderTitle, null);
  assert.equal(response.json().total, 1);
});

test("OpenAPI response schemas match every successful HTTP operation", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const response = await server.inject({ method: "GET", url: "/openapi.json" });
  assert.equal(response.statusCode, 200, response.body);
  const spec = response.json<OpenAPIV3.Document>();
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats.default(ajv);
  ajv.addSchema({ $id: "https://naitimastera.test/openapi", components: spec.components });
  for (const [key, operation] of Object.entries(documentedOperations)) {
    const [method, route] = key.split(" ") as ["GET" | "POST" | "PUT" | "DELETE", string];
    const url = route.replace(/:notificationId/gu, "00000000-0000-4000-8000-000000000001")
      .replace(/:orderId/gu, "order-1").replace(/:bidId/gu, route.startsWith("/api/v1/bids/") ? "00000000-0000-4000-8000-000000000002" : "bid-1")
      .replace(/:attachmentId/gu, "attachment-1").replace(/:contractorId/gu, "contractor-1");
    const actual = await server.inject({ method, url: url === "/api/v1/locations" ? `${url}?query=Моск` : url,
      ...(operation.secured ? { headers: { authorization: "Bearer session-secret" } } : {}),
      ...(operation.example !== undefined ? { payload: operation.example as Record<string, unknown> } : {}),
    });
    assert.equal(actual.statusCode, operation.status, `${key}: ${actual.body}`);
    if (operation.status === 204) { assert.equal(actual.body, ""); continue; }
    const openapiPath = route.replace(/:([^/]+)/gu, "{$1}");
    const documented = spec.paths[openapiPath]![method.toLowerCase() as "get"]!;
    const success = documented.responses[String(operation.status)] as OpenAPIV3.ResponseObject;
    const schema = success.content?.["application/json"]?.schema;
    assert.ok(schema, key);
    // Resolve local component references against this actual generated document.
    const rewritten = JSON.parse(JSON.stringify(schema).replaceAll('"#/components/', '"https://naitimastera.test/openapi#/components/'));
    const validate = ajv.compile(rewritten);
    assert.ok(validate(actual.json()), `${key}: ${ajv.errorsText(validate.errors)}`);
  }
});

test("OpenAPI error models cover validation, auth, conflicts, expiry, rate limits and readiness", async (context) => {
  const cases: Array<{
    status: number; method: "GET" | "POST"; url: string; payload?: Record<string, unknown>;
    overrides?: Parameters<typeof createFixture>[0];
  }> = [
    { status: 400, method: "POST", url: "/api/v1/guest-orders", payload: {} },
    { status: 401, method: "GET", url: "/api/v1/auth/me" },
    { status: 403, method: "POST", url: "/api/v1/guest-attachments/upload-requests",
      payload: { originalFileName: "plan.pdf", contentType: "application/pdf", sizeBytes: 1024 },
      overrides: { guestAccess: async () => { throw new DomainError("HUMAN_VERIFICATION_FAILED", "Verification failed"); } } },
    { status: 404, method: "POST", url: "/api/v1/guest-orders/confirm", payload: { token: "unknown" },
      overrides: { confirm: async () => { throw new DomainError("INVALID_CONFIRMATION_TOKEN", "Invalid token"); } } },
    { status: 409, method: "POST", url: "/api/v1/guest-orders", payload: validBody,
      overrides: { submit: async () => { throw new DomainError("GUEST_ATTACHMENT_ALREADY_CLAIMED", "Attachment already claimed"); } } },
    { status: 410, method: "POST", url: "/api/v1/guest-orders/confirm", payload: { token: "expired" },
      overrides: { confirm: async () => { throw new DomainError("SUBMISSION_EXPIRED", "Link expired"); } } },
    { status: 422, method: "POST", url: "/api/v1/guest-orders", payload: validBody,
      overrides: { submit: async () => { throw new DomainError("RUSSIAN_LOCATION_NOT_FOUND", "Unknown location", { locationIds: ["missing"] }); } } },
    { status: 429, method: "POST", url: "/api/v1/guest-attachments/upload-requests",
      payload: { originalFileName: "plan.pdf", contentType: "application/pdf", sizeBytes: 1024 },
      overrides: { guestAccess: async () => { throw new DomainError("RATE_LIMIT_EXCEEDED", "Too many requests", { retryAfterSeconds: 37 }); } } },
    { status: 500, method: "POST", url: "/api/v1/guest-orders", payload: validBody,
      overrides: { submit: async () => { throw new Error("Internal database error"); } } },
    { status: 503, method: "GET", url: "/health/ready", overrides: { readiness: async () => { throw new Error("DB unavailable"); } } },
  ];
  for (const item of cases) {
    const server = createFixture(item.overrides);
    context.after(() => server.close());
    const documentation = await server.inject({ method: "GET", url: "/openapi.json" });
    const spec = documentation.json<OpenAPIV3.Document>();
    const result = await server.inject({ method: item.method, url: item.url, ...(item.payload ? { payload: item.payload } : {}) });
    assert.equal(result.statusCode, item.status);
    const response = spec.paths[item.url]?.[item.method.toLowerCase() as "get"]?.responses[String(item.status)] as OpenAPIV3.ResponseObject;
    assert.ok(response, `${item.url}: undocumented ${item.status}`);
    const ajv = new Ajv({ strict: false });
    ajv.addSchema({ $id: "https://errors.test/openapi", components: spec.components });
    const schema = JSON.parse(JSON.stringify(response.content!["application/json"]!.schema)
      .replaceAll('"#/components/', '"https://errors.test/openapi#/components/'));
    const validate = ajv.compile(schema);
    assert.ok(validate(result.json()), ajv.errorsText(validate.errors));
    if (item.status === 429) assert.equal(result.headers["retry-after"], "37");
    if (item.status === 401) assert.equal(result.headers["www-authenticate"], "Bearer");
  }
});

test("POST /api/v1/guest-orders accepts a valid submission", async (context) => {
  let received: typeof validBody | undefined;
  const server = createFixture({
    submit: async (command) => {
      received = command;
      return { submissionId: "submission-1", expiresAt: new Date("2026-01-02T10:00:00.000Z") };
    },
  });
  context.after(() => server.close());

  const response = await server.inject({
    method: "POST",
    url: "/api/v1/guest-orders",
    payload: validBody,
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(received, validBody);
  assert.deepEqual(response.json(), {
    submissionId: "submission-1",
    status: "pending_email",
    expiresAt: "2026-01-02T10:00:00.000Z",
  });
});

test("GET /api/v1/work-categories exposes the public category tree", async (context) => {
  const server = createFixture();
  context.after(() => server.close());

  const response = await server.inject({ method: "GET", url: "/api/v1/work-categories" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items[0].id, "construction");
  assert.equal(response.json().items[0].selectable, false);
  assert.equal(response.json().items[0].children[0].id, "house-building");
  assert.equal(response.json().items[0].children[0].selectable, true);
});

test("Russian geography endpoints expose regions and searchable localities", async (context) => {
  const server = createFixture();
  context.after(() => server.close());

  const regions = await server.inject({ method: "GET", url: "/api/v1/regions" });
  const localities = await server.inject({ method: "GET", url: "/api/v1/locations?query=%D0%9C%D0%BE%D1%81" });

  assert.equal(regions.statusCode, 200);
  assert.equal(regions.json().countryCode, "RU");
  assert.equal(regions.json().items[0].id, "ru-region-43");
  assert.equal(localities.statusCode, 200);
  assert.equal(localities.json().countryCode, "RU");
  assert.equal(localities.json().items[0].id, "ru-locality-1");
  assert.equal(localities.json().items[0].regionName, "Москва");
});

test("Passwordless registration, current account, and logout use the session contract", async (context) => {
  const server = createFixture();
  context.after(() => server.close());

  const requested = await server.inject({
    method: "POST",
    url: "/api/v1/auth/registrations",
    payload: { email: "User@Example.com" },
  });
  assert.equal(requested.statusCode, 202);
  assert.deepEqual(requested.json(), { status: "pending_email" });

  const confirmed = await server.inject({
    method: "POST",
    url: "/api/v1/auth/registrations/confirm",
    payload: { token: "email-token" },
  });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.json().account.email, "user@example.com");
  assert.equal(confirmed.json().createdAccount, true);
  assert.deepEqual(confirmed.json().session, { type: "Bearer", token: "session-secret" });

  const me = await server.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    headers: { authorization: "Bearer session-secret" },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().email, "user@example.com");

  const loggedOut = await server.inject({
    method: "DELETE",
    url: "/api/v1/auth/session",
    headers: { authorization: "Bearer session-secret" },
  });
  assert.equal(loggedOut.statusCode, 204);
});

test("Guest attachment endpoints issue and require a claim token without authentication", async (context) => {
  const server = createFixture();
  context.after(() => server.close());

  const requested = await server.inject({
    method: "POST",
    url: "/api/v1/guest-attachments/upload-requests",
    payload: {
      originalFileName: "plan.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
    },
  });
  assert.equal(requested.statusCode, 201);
  assert.equal(requested.json().claimToken, "secret-claim-token");
  assert.equal(requested.json().attachment.ownerId, null);
  assert.equal(requested.json().attachment.guestClaimTokenHash, undefined);

  const confirmed = await server.inject({
    method: "POST",
    url: "/api/v1/guest-attachments/guest-attachment-1/confirm",
    payload: { claimToken: requested.json().claimToken },
  });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.json().status, "processing");
});

test("Guest upload protection returns 429 with Retry-After", async (context) => {
  const server = createFixture({
    guestAccess: async () => {
      throw new DomainError("RATE_LIMIT_EXCEEDED", "Too many guest upload requests", {
        retryAfterSeconds: 37,
      });
    },
  });
  context.after(() => server.close());

  const response = await server.inject({
    method: "POST",
    url: "/api/v1/guest-attachments/upload-requests",
    payload: {
      originalFileName: "plan.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      captchaToken: "turnstile-proof",
    },
  });

  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["retry-after"], "37");
  assert.equal(response.json().error.code, "RATE_LIMIT_EXCEEDED");
});

test("HTTP validation rejects unknown and malformed fields", async (context) => {
  const server = createFixture();
  context.after(() => server.close());

  const response = await server.inject({
    method: "POST",
    url: "/api/v1/guest-orders",
    payload: { ...validBody, budgetMinMinor: 1.5, unexpected: true },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
  assert.ok(response.json().error.requestId);
});

test("POST confirmation returns an application session", async (context) => {
  const server = createFixture();
  context.after(() => server.close());

  const response = await server.inject({
    method: "POST",
    url: "/api/v1/guest-orders/confirm",
    payload: { token: "confirmation-token" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    accountId: "account-1",
    orderId: "order-1",
    reusedAccount: false,
    alreadyConfirmed: false,
    session: { type: "Bearer", token: "session-secret" },
  });
});

test("expired confirmation is exposed as 410 without an internal stack", async (context) => {
  const server = createFixture({
    confirm: async () => {
      throw new DomainError("SUBMISSION_EXPIRED", "Confirmation link has expired");
    },
  });
  context.after(() => server.close());

  const response = await server.inject({
    method: "POST",
    url: "/api/v1/guest-orders/confirm",
    payload: { token: "expired-token" },
  });

  assert.equal(response.statusCode, 410);
  assert.equal(response.json().error.code, "SUBMISSION_EXPIRED");
  assert.equal(response.body.includes("stack"), false);
});

test("unexpected errors return a generic 500 response", async (context) => {
  const server = createFixture({
    submit: async () => {
      throw new Error("database password must not leak");
    },
  });
  context.after(() => server.close());

  const response = await server.inject({
    method: "POST",
    url: "/api/v1/guest-orders",
    payload: validBody,
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error.code, "INTERNAL_ERROR");
  assert.equal(response.body.includes("database password"), false);
});

test("readiness endpoint reports database failure", async (context) => {
  const server = createFixture({
    readiness: async () => {
      throw new Error("database unavailable");
    },
  });
  context.after(() => server.close());

  const liveness = await server.inject({ method: "GET", url: "/health/live" });
  const readiness = await server.inject({ method: "GET", url: "/health/ready" });

  assert.equal(liveness.statusCode, 200);
  assert.equal(readiness.statusCode, 503);
  assert.deepEqual(readiness.json(), { status: "unavailable" });
});

test("customer routes require a valid Bearer session", async (context) => {
  const server = createFixture();
  context.after(() => server.close());

  const missing = await server.inject({ method: "GET", url: "/api/v1/customer/orders" });
  const invalid = await server.inject({
    method: "GET",
    url: "/api/v1/customer/orders",
    headers: { authorization: "Bearer invalid" },
  });

  assert.equal(missing.statusCode, 401);
  assert.equal(invalid.statusCode, 401);
  assert.equal(missing.headers["www-authenticate"], "Bearer");
  assert.equal(missing.json().error.code, "AUTHENTICATION_REQUIRED");
});

test("notification inbox and read action require authentication", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const inbox = await server.inject({ method: "GET", url: "/api/v1/notifications" });
  const read = await server.inject({ method: "POST", url: "/api/v1/notifications/00000000-0000-4000-8000-000000000001/read" });
  assert.equal(inbox.statusCode, 401);
  assert.equal(read.statusCode, 401);
});

test("notification preferences require a session and accept only the supported email settings", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const url = "/api/v1/notification-preferences";
  const payload = { email: { bidSubmitted: false, bidSelected: true, orderCompleted: false, messageReceived: false } };
  for (const method of ["GET", "PUT"] as const) {
    const response = await server.inject({ method, url, ...(method === "PUT" ? { payload } : {}) });
    assert.equal(response.statusCode, 401);
  }
  const headers = { authorization: "Bearer session-secret" };
  const response = await server.inject({ method: "PUT", url, headers, payload });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), payload);
  const defaults = await server.inject({ method: "GET", url, headers });
  assert.equal(defaults.json().email.bidSubmitted, true);
  for (const invalid of [
    { email: { bidSubmitted: false } },
    { ...payload, accountId: "another-account" },
    { email: { ...payload.email, security: false } },
    { email: { ...payload.email, bidSubmitted: "invalid-boolean" } },
  ]) {
    const rejected = await server.inject({ method: "PUT", url, headers, payload: invalid });
    assert.equal(rejected.statusCode, 400);
  }
});

test("email change request requires a session and confirmation accepts only a token body", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const url = "/api/v1/auth/email-change-requests";
  const unauthenticated = await server.inject({ method: "POST", url, payload: { email: "new@example.com" } });
  assert.equal(unauthenticated.statusCode, 401);
  const headers = { authorization: "Bearer session-secret" };
  const request = await server.inject({ method: "POST", url, headers, payload: { email: "new@example.com" } });
  assert.equal(request.statusCode, 202);
  assert.deepEqual(request.json(), { status: "pending_email" });
  const invalid = await server.inject({ method: "POST", url: `${url}/confirm`, payload: { token: "", accountId: "someone-else" } });
  assert.equal(invalid.statusCode, 400);
  const confirmed = await server.inject({ method: "POST", url: `${url}/confirm`, payload: { token: "confirmation-token" } });
  assert.equal(confirmed.statusCode, 204);
});

test("deletion request requires a session and confirmation accepts an email token", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const url = "/api/v1/auth/account-deletion-requests";
  const rejected = await server.inject({ method: "POST", url });
  assert.equal(rejected.statusCode, 401);
  const requested = await server.inject({ method: "POST", url, headers: { authorization: "Bearer session-secret" } });
  assert.equal(requested.statusCode, 202);
  const empty = await server.inject({ method: "POST", url: `${url}/confirm`, payload: { token: "" } });
  assert.equal(empty.statusCode, 400);
  const confirmed = await server.inject({ method: "POST", url: `${url}/confirm`, payload: { token: "deletion-token" } });
  assert.equal(confirmed.statusCode, 204);
});

test("customer order PUT validates full details, rejects protected fields, and requires authentication", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const payload = {
    categoryId: "foundation", locationId: "ru-region-43", title: "Фундамент дома",
    description: "Нужен монолитный фундамент.", budgetMinMinor: 500_000,
    budgetMaxMinor: 700_000, attachmentIds: [],
  };
  const url = "/api/v1/customer/orders/order-1";
  const unauthorized = await server.inject({ method: "PUT", url, payload });
  assert.equal(unauthorized.statusCode, 401);
  const headers = { authorization: "Bearer session-secret" };
  const invalid = await server.inject({ method: "PUT", url, headers, payload: { ...payload, status: "completed" } });
  assert.equal(invalid.statusCode, 400);
  const edited = await server.inject({ method: "PUT", url, headers, payload });
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.json().title, payload.title);
  assert.equal(edited.json().budget.minMinor, payload.budgetMinMinor);
});

test("customer can list, inspect, and cancel their order", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const headers = { authorization: "Bearer session-secret" };

  const list = await server.inject({
    method: "GET",
    url: "/api/v1/customer/orders?limit=10&offset=0",
    headers,
  });
  const detail = await server.inject({
    method: "GET",
    url: "/api/v1/customer/orders/order-1",
    headers,
  });
  const cancelled = await server.inject({
    method: "POST",
    url: "/api/v1/customer/orders/order-1/cancel",
    headers,
  });

  assert.equal(list.statusCode, 200);
  assert.equal(list.json().items[0].id, "order-1");
  assert.deepEqual(list.json().items[0].budget, {
    minMinor: 500_000_000,
    maxMinor: 700_000_000,
    currency: "RUB",
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().createdAt, "2026-01-01T10:00:00.000Z");
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.json().status, "cancelled");
});

test("public marketplace exposes published orders without authentication", async (context) => {
  const server = createFixture();
  context.after(() => server.close());

  const list = await server.inject({
    method: "GET",
    url: "/api/v1/orders?categoryId=house-building&limit=10",
  });
  const detail = await server.inject({ method: "GET", url: "/api/v1/orders/order-1" });

  assert.equal(list.statusCode, 200);
  assert.equal(list.json().items[0].bidCount, 1);
  assert.equal(list.json().items[0].categoryName, "Строительство домов и коттеджей");
  assert.equal(list.json().items[0].locationName, "Москва");
  assert.equal(list.json().items[0].regionName, "Москва");
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(detail.json().budget, {
    minMinor: 500_000_000,
    maxMinor: 700_000_000,
    currency: "RUB",
  });
  assert.equal("budgetMinMinor" in detail.json(), false);
});

test("public contractor search exposes profile summaries without authentication", async (context) => {
  const server = createFixture();
  context.after(() => server.close());

  const response = await server.inject({
    method: "GET",
    url: "/api/v1/contractors?query=%D0%B4%D0%BE%D0%BC%D0%B0&specializationId=house-building&regionId=ru-region-43&minRating=4&sort=rating",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().total, 1);
  assert.equal(response.json().items[0].displayName, "Бригада Мастер");
  assert.equal(response.json().items[0].memberSince, "2026-01-01T10:00:00.000Z");
  assert.equal("email" in response.json().items[0], false);
});

test("nullable money and duration survive HTTP validation without coercion", async (context) => {
  const server = createFixture({ submit: async command => {
    assert.equal(command.budgetMinMinor, null);
    assert.equal(command.budgetMaxMinor, null);
    return { submissionId: "submission-1", expiresAt: new Date("2026-01-02T10:00:00Z") };
  } });
  context.after(() => server.close());
  const guest = await server.inject({ method: "POST", url: "/api/v1/guest-orders",
    payload: { ...validBody, budgetMinMinor: null, budgetMaxMinor: null } });
  assert.equal(guest.statusCode, 202);
  const headers = { authorization: "Bearer session-secret" };
  for (const amount of [null, 0, 10029]) {
    const edited = await server.inject({ method: "PUT", url: "/api/v1/customer/orders/order-1", headers,
      payload: { categoryId: "foundation", locationId: "ru-region-43", title: "Фундамент дома",
        description: "Нужен монолитный фундамент.", budgetMinMinor: amount, budgetMaxMinor: amount, attachmentIds: [] } });
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json().budget.minMinor, amount);
    assert.equal(edited.json().budget.maxMinor, amount);
    const submitted = await server.inject({ method: "POST", url: "/api/v1/orders/order-1/bids", headers,
      payload: { message: "Готов выполнить работу", priceMinMinor: amount, priceMaxMinor: amount,
        durationDaysMin: null, durationDaysMax: null, visibility: "private" } });
    assert.equal(submitted.statusCode, 201);
    assert.equal(submitted.json().price.minMinor, amount);
    assert.equal(submitted.json().price.maxMinor, amount);
    assert.equal(submitted.json().durationDaysMin, null);
    assert.equal(submitted.json().durationDaysMax, null);
  }
  const invalid = await server.inject({ method: "POST", url: "/api/v1/orders/order-1/bids", headers,
    payload: { message: "Готов выполнить работу", priceMinMinor: null, priceMaxMinor: null,
      durationDaysMin: 0, durationDaysMax: null, visibility: "private" } });
  assert.equal(invalid.statusCode, 400);
});

test("authenticated contractor can submit and withdraw a bid", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const headers = { authorization: "Bearer session-secret" };

  const submitted = await server.inject({
    method: "POST",
    url: "/api/v1/orders/order-1/bids",
    headers,
    payload: {
      message: "Готов выполнить работу качественно и в срок.",
      priceMinMinor: 100_000,
      priceMaxMinor: 150_000,
      durationDaysMin: 5,
      durationDaysMax: 7,
      visibility: "private",
    },
  });
  const withdrawn = await server.inject({
    method: "POST",
    url: "/api/v1/contractor/bids/bid-1/withdraw",
    headers,
  });

  assert.equal(submitted.statusCode, 201);
  assert.equal(submitted.json().status, "submitted");
  assert.equal(submitted.json().visibility, "private");
  assert.equal(withdrawn.statusCode, 200);
  assert.equal(withdrawn.json().status, "withdrawn");
});

test("customer can inspect bids and select a contractor", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const headers = { authorization: "Bearer session-secret" };

  const bids = await server.inject({
    method: "GET",
    url: "/api/v1/customer/orders/order-1/bids",
    headers,
  });
  const selected = await server.inject({
    method: "POST",
    url: "/api/v1/customer/orders/order-1/bids/bid-1/select",
    headers,
  });

  assert.equal(bids.statusCode, 200);
  assert.equal(selected.statusCode, 200);
  assert.deepEqual(selected.json(), {
    orderId: "order-1",
    bidId: "bid-1",
    contractorId: "contractor-1",
    orderStatus: "in_progress",
  });
});

test("an authenticated participant can complete an order and submit a review", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const headers = { authorization: "Bearer session-secret" };

  const completed = await server.inject({
    method: "POST",
    url: "/api/v1/orders/order-1/complete",
    headers,
  });
  const reviewed = await server.inject({
    method: "POST",
    url: "/api/v1/orders/order-1/reviews",
    headers,
    payload: { score: 5, text: "Работа выполнена качественно и в срок." },
  });

  assert.equal(completed.statusCode, 200);
  assert.equal(completed.json().completedAt, "2026-01-04T10:00:00.000Z");
  assert.equal(reviewed.statusCode, 201);
  assert.equal(reviewed.json().subjectId, "contractor-1");
  assert.equal(reviewed.json().createdAt, "2026-01-04T11:00:00.000Z");
});

test("review endpoint validates the score and requires authentication", async (context) => {
  const server = createFixture();
  context.after(() => server.close());

  const unauthenticated = await server.inject({
    method: "POST",
    url: "/api/v1/orders/order-1/reviews",
    payload: { score: 5, text: "Работа выполнена качественно." },
  });
  const invalid = await server.inject({
    method: "POST",
    url: "/api/v1/orders/order-1/reviews",
    headers: { authorization: "Bearer session-secret" },
    payload: { score: 6, text: "Работа выполнена качественно." },
  });

  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(invalid.statusCode, 400);
});

test("public contractor profile and reviews do not expose email", async (context) => {
  const server = createFixture();
  context.after(() => server.close());

  const profile = await server.inject({
    method: "GET",
    url: "/api/v1/contractors/contractor-1",
  });
  const reviews = await server.inject({
    method: "GET",
    url: "/api/v1/contractors/contractor-1/reviews?limit=10&offset=0",
  });

  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().displayName, "Бригада Мастер");
  assert.equal(profile.json().ratingAverage, 4.75);
  assert.equal(profile.json().memberSince, "2026-01-01T10:00:00.000Z");
  assert.equal("email" in profile.json(), false);
  assert.equal(reviews.statusCode, 200);
  assert.equal(reviews.json().items[0].score, 5);
});

test("contractor can create and read their own rich profile", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const headers = { authorization: "Bearer session-secret" };

  const saved = await server.inject({
    method: "PUT",
    url: "/api/v1/contractor/profile",
    headers,
    payload: contractorProfileBody,
  });
  const own = await server.inject({
    method: "GET",
    url: "/api/v1/contractor/profile",
    headers,
  });

  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().accountId, "account-1");
  assert.equal(saved.json().portfolio[0].attachmentIds.length, 2);
  assert.equal(saved.json().createdAt, "2026-01-02T10:00:00.000Z");
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().displayName, "Бригада Мастер");
});

test("contractor profile validates portfolio attachments", async (context) => {
  const server = createFixture();
  context.after(() => server.close());

  const response = await server.inject({
    method: "PUT",
    url: "/api/v1/contractor/profile",
    headers: { authorization: "Bearer session-secret" },
    payload: {
      ...contractorProfileBody,
      portfolio: [{ title: "Объект", description: "", attachmentIds: [] }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
});

test("attachment API creates, confirms, and resolves a public file URL", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const headers = { authorization: "Bearer session-secret" };

  const requested = await server.inject({
    method: "POST",
    url: "/api/v1/attachments/upload-requests",
    headers,
    payload: {
      purpose: "portfolio",
      originalFileName: "house.webp",
      contentType: "image/webp",
      sizeBytes: 1_024,
    },
  });
  const confirmed = await server.inject({
    method: "POST",
    url: "/api/v1/attachments/attachment-1/confirm",
    headers,
  });
  const publicUrl = await server.inject({
    method: "GET",
    url: "/api/v1/attachments/attachment-1/download-url",
  });

  assert.equal(requested.statusCode, 201);
  assert.equal(requested.json().attachment.status, "pending_upload");
  assert.equal("storageKey" in requested.json().attachment, false);
  assert.equal(requested.json().uploadHeaders["content-type"], "image/webp");
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.json().status, "processing");
  assert.equal(publicUrl.statusCode, 200);
  assert.equal(publicUrl.json().expiresInSeconds, 900);
});

test("attachment upload request requires authentication and validates size", async (context) => {
  const server = createFixture();
  context.after(() => server.close());
  const body = {
    purpose: "portfolio",
    originalFileName: "house.webp",
    contentType: "image/webp",
    sizeBytes: 0,
  };

  const unauthenticated = await server.inject({
    method: "POST",
    url: "/api/v1/attachments/upload-requests",
    payload: { ...body, sizeBytes: 1_024 },
  });
  const invalid = await server.inject({
    method: "POST",
    url: "/api/v1/attachments/upload-requests",
    headers: { authorization: "Bearer session-secret" },
    payload: body,
  });

  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(invalid.statusCode, 400);
});
