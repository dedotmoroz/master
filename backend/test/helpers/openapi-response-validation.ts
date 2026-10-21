import assert from "node:assert/strict";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import type { FastifyInstance } from "fastify";
import type { OpenAPIV3 } from "openapi-types";

/** Observe actual PostgreSQL-backed responses without changing their serialization or status. */
export function captureOpenApiResponseValidation(server: FastifyInstance): () => void {
  const observations: Array<{ method: string; route: string; status: number; body: string }> = [];
  server.addHook("onSend", async (request, reply, payload) => {
    const route = request.routeOptions.url;
    if (route && (route.startsWith("/api/v1/") || route.startsWith("/health/"))) {
      observations.push({ method: request.method.toLowerCase(), route, status: reply.statusCode,
        body: typeof payload === "string" ? payload : Buffer.isBuffer(payload) ? payload.toString() : "" });
    }
    return payload;
  });
  return () => {
    const specification = server.swagger() as OpenAPIV3.Document;
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats.default(ajv);
    ajv.addSchema({ $id: "https://contract.test/openapi", components: specification.components });
    assert.ok(observations.length > 0);
    for (const observation of observations) {
      const route = observation.route.replace(/:([^/]+)/gu, "{$1}");
      const operation = specification.paths[route]?.[observation.method as "get"];
      const response = operation?.responses[String(observation.status)] as OpenAPIV3.ResponseObject | undefined;
      const label = `${observation.method} ${route} -> ${observation.status}`;
      assert.ok(response, `Undocumented response: ${label}`);
      if (observation.status === 204) { assert.equal(observation.body, "", label); continue; }
      const schema = response.content?.["application/json"]?.schema;
      assert.ok(schema, label);
      const resolved = JSON.parse(JSON.stringify(schema).replaceAll('"#/components/', '"https://contract.test/openapi#/components/'));
      const validate = ajv.compile(resolved);
      assert.ok(validate(JSON.parse(observation.body)), `${label}: ${ajv.errorsText(validate.errors)}`);
    }
  };
}
