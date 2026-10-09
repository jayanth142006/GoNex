import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { ChatMessage, CompletionResult, LlmClient } from '../src/llm/types.js';
import { MemoryConversationStore } from '../src/store/memory.js';

export const ALLOWED_ORIGIN = 'https://cryptonet.example';

export class FakeLlm implements LlmClient {
  calls: { system: string; messages: ChatMessage[] }[] = [];
  constructor(private readonly respond: (messages: ChatMessage[]) => Promise<CompletionResult> | CompletionResult = (m) => ({
    text: `echo: ${m[m.length - 1]?.content}`,
  })) {}

  async complete(input: { system: string; messages: ChatMessage[] }): Promise<CompletionResult> {
    this.calls.push({ system: input.system, messages: input.messages.map((m) => ({ ...m })) });
    return this.respond(input.messages);
  }
}

export async function makeApp(
  opts: { llm?: LlmClient; env?: Record<string, string> } = {},
): Promise<{ app: FastifyInstance; llm: LlmClient; store: MemoryConversationStore }> {
  const config = loadConfig({
    NODE_ENV: 'test',
    ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    RATE_LIMIT_MAX: '1000',
    ...opts.env,
  });
  const llm = opts.llm ?? new FakeLlm();
  const store = new MemoryConversationStore(config.conversationTtlSeconds);
  const app = await buildApp({ config, llm, store });
  app.addHook('onClose', async () => store.close());
  return { app, llm, store };
}
