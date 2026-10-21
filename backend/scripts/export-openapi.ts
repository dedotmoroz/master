import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { createApplication } from "../src/app/create-application.ts";
import { loadConfig } from "../src/app/config.ts";

// Construct the real route graph, without migrations, listening sockets or background workers.
// No database, SMTP or S3 credentials are required to export the contract.
const application = await createApplication(loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgres://documentation:documentation@127.0.0.1:1/documentation",
  VERIFICATION_TOKEN_SECRET: "documentation-export-placeholder-not-for-runtime",
}));
try {
  await application.server.ready();
  const specification = application.server.swagger();
  await SwaggerParser.validate(structuredClone(specification), { resolve: { external: false } });
  const destination = resolve(process.argv[2] ?? "docs/openapi.json");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(specification, null, 2)}\n`);
  console.info(`OpenAPI exported: ${destination}`);
} finally {
  await application.server.close();
  await application.close();
}
