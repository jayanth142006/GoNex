import { readFileSync } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';

// Resolves to <project root>/public from both src/routes (tsx) and dist/routes (built).
const PUBLIC_DIR = new URL('../../public/', import.meta.url);

const FILES: Record<string, { file: string; type: string; cache: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8', cache: 'no-cache' },
  '/assets/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8', cache: 'public, max-age=300' },
  '/assets/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8', cache: 'public, max-age=300' },
};

/** Serves the built-in GoNex chat UI (a small static page that calls /api/chat on the same origin). */
export const webRoutes: FastifyPluginAsync = async (app) => {
  for (const [path, { file, type, cache }] of Object.entries(FILES)) {
    const body = readFileSync(new URL(file, PUBLIC_DIR));
    app.get(path, { config: { rateLimit: false }, logLevel: 'warn' }, async (_request, reply) =>
      reply.type(type).header('cache-control', cache).send(body),
    );
  }
};
