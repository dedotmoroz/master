import { createApplication } from "./app/create-application.ts";
import { ConfigurationError, loadConfig } from "./app/config.ts";
import { safeError } from "./shared/safe-error.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const application = await createApplication(config);
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    application.server.log.info({ signal }, "Shutting down");
    try {
      await application.close();
    } catch (error) {
      application.server.log.error({ failure: safeError(error) }, "Graceful shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await application.start();
  } catch (error) {
    await application.close();
    throw error;
  }
}

main().catch((error: unknown) => {
  const failure = safeError(error);
  console.error(JSON.stringify({ message: "Application startup failed", failure,
    ...(failure.code === "EADDRINUSE" ? {
      hint: "HTTP port is already in use. Stop the existing API process or start with a different PORT (for example PORT=3001 npm start).",
    } : {}),
    // ConfigurationError messages contain setting names and rules, never their values.
    ...(error instanceof ConfigurationError ? { configuration: error.message } : {}),
  }));
  process.exitCode = 1;
});
