import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    // "true" | "false" | number of trusted hops | comma-separated proxy IPs/CIDRs
    TRUST_PROXY: z
      .string()
      .trim()
      .default('false')
      .transform((value): boolean | number | string[] => {
        if (value === 'true') return true;
        if (value === 'false' || value === '') return false;
        if (/^\d+$/.test(value)) return Number(value);
        return value.split(',').map((v) => v.trim()).filter(Boolean);
      }),

    LLM_API_KEY: z.string().trim().default(''),
    LLM_MODEL: z.string().trim().min(1).default('openai/gpt-oss-120b'),
    // Only sent for reasoning models; set to an empty value for models that don't support it.
    LLM_REASONING_EFFORT: z.enum(['', 'none', 'default', 'low', 'medium', 'high']).default('low'),
    LLM_MAX_TOKENS: z.coerce.number().int().min(50).max(8192).default(1024),
    LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),

    ALLOWED_ORIGINS: csv,

    // "retrieval" sends only the most relevant knowledge sections; "full" sends the whole file.
    KNOWLEDGE_MODE: z.enum(['retrieval', 'full']).default('retrieval'),
    KNOWLEDGE_TOKEN_BUDGET: z.coerce.number().int().min(300).max(50_000).default(1600),
    SERVE_WEB_UI: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

    REDIS_URL: z.string().trim().default(''),
    CONVERSATION_TTL_SECONDS: z.coerce.number().int().min(60).max(7 * 24 * 3600).default(3600),
    MAX_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(50).default(8),
    MAX_MESSAGE_CHARS: z.coerce.number().int().min(10).max(10_000).default(2000),

    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
    RATE_LIMIT_WINDOW: z.string().trim().min(1).default('1 minute'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'test') return;
    if (!env.LLM_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['LLM_API_KEY'], message: 'LLM_API_KEY is required' });
    }
    if (env.NODE_ENV === 'production' && env.ALLOWED_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOWED_ORIGINS'],
        message: 'ALLOWED_ORIGINS is required in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export interface Config {
  env: Env['NODE_ENV'];
  host: string;
  port: number;
  logLevel: Env['LOG_LEVEL'];
  trustProxy: Env['TRUST_PROXY'];
  llm: {
    apiKey: string;
    model: string;
    reasoningEffort: Exclude<Env['LLM_REASONING_EFFORT'], ''> | undefined;
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
  };
  allowedOrigins: string[];
  knowledge: { mode: Env['KNOWLEDGE_MODE']; tokenBudget: number };
  serveWebUi: boolean;
  redisUrl: string | undefined;
  conversationTtlSeconds: number;
  maxHistoryMessages: number;
  maxMessageChars: number;
  rateLimit: { max: number; timeWindow: string };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Only variable names and rule messages are printed, never values.
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    trustProxy: env.TRUST_PROXY,
    llm: {
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL,
      reasoningEffort: env.LLM_REASONING_EFFORT || undefined,
      maxTokens: env.LLM_MAX_TOKENS,
      temperature: env.LLM_TEMPERATURE,
      timeoutMs: env.LLM_TIMEOUT_MS,
    },
    allowedOrigins: env.ALLOWED_ORIGINS,
    knowledge: { mode: env.KNOWLEDGE_MODE, tokenBudget: env.KNOWLEDGE_TOKEN_BUDGET },
    serveWebUi: env.SERVE_WEB_UI,
    redisUrl: env.REDIS_URL || undefined,
    conversationTtlSeconds: env.CONVERSATION_TTL_SECONDS,
    maxHistoryMessages: env.MAX_HISTORY_MESSAGES,
    maxMessageChars: env.MAX_MESSAGE_CHARS,
    rateLimit: { max: env.RATE_LIMIT_MAX, timeWindow: env.RATE_LIMIT_WINDOW },
  };
}
