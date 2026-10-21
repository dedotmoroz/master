import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { operationDocumentation, responseSchemas } from "./openapi-contract.ts";

export function registerApiDocumentation(server: FastifyInstance): void {
  server.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Naiti Mastera API", version: "1.0.0",
        description: "Биржа строительных работ, Россия. Денежные суммы — целые копейки RUB. Даты — ISO 8601 UTC. Пагинация — limit/offset. Для защищённых методов используйте Authorize и вставьте session.token без префикса Bearer. Письма в development выводятся в лог; токены и IDs в примерах условные.",
      },
      servers: [{ url: "/", description: "Текущий сервер" }],
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Серверная сессия: session.token из подтверждения email или гостевого заказа." } },
        schemas: responseSchemas,
      },
      tags: ["Health", "Аккаунт", "Справочники", "Гостевой заказ", "Заказы", "Кабинет заказчика", "Отклики", "Переписка", "Исполнители", "Репутация", "Файлы", "Уведомления"].map((name) => ({ name })),
    },
    transform: ({ schema, url, route }) => {
      if (!url.startsWith("/api/v1/") && !url.startsWith("/health/")) return { schema: { hide: true }, url };
      const method = Array.isArray(route.method) ? route.method[0]! : route.method;
      const { example, ...documentation } = operationDocumentation(method, url);
      return {
        schema: {
          ...schema, ...documentation,
          ...(schema?.body && example !== undefined ? { body: { ...schema.body, example } } : {}),
        }, url,
      };
    },
  });
  server.register(swaggerUi, {
    routePrefix: "/docs", staticCSP: true, validatorUrl: false,
    uiConfig: { docExpansion: "list", deepLinking: true, persistAuthorization: false, displayRequestDuration: true },
    theme: { title: "Naiti Mastera API — Swagger UI" },
  });
  server.get("/openapi.json", { schema: { hide: true } }, async () => server.swagger());
}
