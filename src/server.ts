import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { GroqLlmClient } from './llm/groq.js';
import { createStore } from './store/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { store, redis } = createStore(config);
  const app = await buildApp({ config, llm: new GroqLlmClient(config.llm), store, redis });
  // ioredis reconnects on its own; log failures instead of surfacing unhandled 'error' events.
  redis?.on('error', (err: Error) => app.log.warn({ err: { message: err.message } }, 'redis error'));

  app.addHook('onClose', async () => {
    await store.close();
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    {
      model: config.llm.model,
      allowedOrigins: config.allowedOrigins,
      conversationStore: redis ? 'redis' : 'memory',
    },
    'GoNex ready',
  );
}

main().catch((err: unknown) => {
  // Config errors list variable names only; no secret values are printed.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
