import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { ChatService } from './ai/chatService.js';
import { FullKnowledge, RetrievalKnowledge } from './ai/knowledge.js';
import { loadKnowledge } from './ai/prompt.js';
import type { Config } from './config.js';
import { AiUnavailableError, AppError, publicMessageFor } from './errors.js';
import type { LlmClient } from './llm/types.js';
import { chatRoutes } from './routes/chat.js';
import { healthRoutes } from './routes/health.js';
import { webRoutes } from './routes/web.js';
import type { ConversationStore } from './store/types.js';

export const BODY_LIMIT_BYTES = 16 * 1024;

export interface AppDeps {
  config: Config;
  llm: LlmClient;
  store: ConversationStore;
  /** Shared Redis client; when present, rate-limit counters are kept in Redis too. */
  redis?: Redis;
  /** Overrides the knowledge base text (used by tests). */
  knowledge?: string;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;

  const app = Fastify({
    logger:
      config.env === 'test'
        ? false
        : {
            level: config.logLevel,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
    trustProxy:
      typeof config.trustProxy === 'number'
        ? (() => {
            const hops = config.trustProxy;
            // Trust the nearest `hops` proxies, matching Fastify's numeric trustProxy semantics.
            return (_address: string, hop: number) => hop < hops;
          })()
        : config.trustProxy,
    bodyLimit: BODY_LIMIT_BYTES,
    // Time allowed for a client to send the full request (slow-client protection).
    requestTimeout: 15_000,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, {
    // The JSON API is consumed cross-origin by the CryptoNet frontend.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        // Keep plain-HTTP localhost usable during development; production is HTTPS-only anyway.
        upgradeInsecureRequests: config.env === 'production' ? [] : null,
      },
    },
  });

  const allowedOrigins = new Set(config.allowedOrigins);
  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser clients (curl, health checks) send no Origin header.
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins.has(origin.replace(/\/+$/, '')));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  });

  // Registered after CORS so 429 responses still carry CORS headers and are readable by the browser.
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
    ...(deps.redis ? { redis: deps.redis, nameSpace: 'gonex:rl:' } : {}),
    // If Redis is unavailable, serve the request rather than failing it.
    skipOnError: true,
    errorResponseBuilder: (_req, context) => ({
      statusCode: context.statusCode,
      error: publicMessageFor(429),
    }),
  });

  app.setErrorHandler((error: FastifyError | AppError | Error, request, reply) => {
    if (error instanceof AppError) {
      if (error instanceof AiUnavailableError) {
        request.log.error({ reason: error.reason, err: error.cause }, 'AI provider unavailable');
      } else if (error.statusCode >= 500) {
        request.log.error({ err: error }, 'request failed');
      }
      return reply.status(error.statusCode).send({ error: error.publicMessage });
    }

    const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      return reply.status(500).send({ error: publicMessageFor(500) });
    }
    if (status >= 400) {
      const code = 'code' in error ? error.code : undefined;
      const message =
        code === 'FST_ERR_CTP_INVALID_JSON_BODY' || error instanceof SyntaxError
          ? 'Request body must be valid JSON.'
          : code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
            ? 'Request body is required.'
            : publicMessageFor(status);
      return reply.status(status).send({ error: message });
    }
    request.log.error({ err: error }, 'unexpected error status');
    return reply.status(500).send({ error: publicMessageFor(500) });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: publicMessageFor(404) });
  });

  const knowledgeText = deps.knowledge ?? loadKnowledge();
  const partialKnowledge = config.knowledge.mode === 'retrieval';
  const chatService = new ChatService({
    llm: deps.llm,
    store: deps.store,
    knowledge: partialKnowledge
      ? new RetrievalKnowledge(knowledgeText, config.knowledge.tokenBudget)
      : new FullKnowledge(knowledgeText),
    partialKnowledge,
    maxHistoryMessages: config.maxHistoryMessages,
  });

  await app.register(healthRoutes);
  await app.register(chatRoutes, { chatService, maxMessageChars: config.maxMessageChars });
  if (config.serveWebUi) await app.register(webRoutes);

  return app;
}
