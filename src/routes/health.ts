import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', { config: { rateLimit: false }, logLevel: 'warn' }, async () => ({ status: 'ok' }));
};
