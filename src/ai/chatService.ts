import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { ChatMessage, LlmClient } from '../llm/types.js';
import type { ConversationStore } from '../store/types.js';
import type { KnowledgeBase } from './knowledge.js';
import { buildSystemPrompt } from './prompt.js';

export interface ChatServiceOptions {
  llm: LlmClient;
  store: ConversationStore;
  knowledge: KnowledgeBase;
  /** True when `knowledge` returns only the sections relevant to each question. */
  partialKnowledge: boolean;
  maxHistoryMessages: number;
}

export interface ChatResult {
  reply: string;
  conversationId: string;
}

export class ChatService {
  constructor(private readonly opts: ChatServiceOptions) {}

  async chat(
    input: { message: string; conversationId?: string },
    log: FastifyBaseLogger,
  ): Promise<ChatResult> {
    let history: ChatMessage[] | undefined;
    if (input.conversationId) {
      history = await this.opts.store.get(input.conversationId).catch((err: unknown) => {
        // History is a nice-to-have: keep serving if the store is unavailable.
        log.warn({ err }, 'conversation store read failed; continuing without history');
        return undefined;
      });
    }

    // Unknown/expired ids get a fresh server-generated id rather than adopting
    // the client-supplied one, so conversation ids are never client-chosen.
    const conversationId = history ? input.conversationId! : randomUUID();
    const prior = trimHistory(history ?? [], this.opts.maxHistoryMessages);
    const userMessage: ChatMessage = { role: 'user', content: input.message };

    // Include the previous user turn so follow-ups ("how long do they have?") retrieve the right sections.
    const previousQuestion = [...prior].reverse().find((m) => m.role === 'user')?.content ?? '';
    const context = this.opts.knowledge.contextFor(`${input.message}\n${previousQuestion}`);

    const started = performance.now();
    const result = await this.opts.llm.complete({
      system: buildSystemPrompt(context.text, this.opts.partialKnowledge),
      messages: [...prior, userMessage],
    });
    log.info(
      {
        conversationId,
        historyMessages: prior.length,
        knowledgeSections: context.sections.length,
        messageChars: input.message.length,
        replyChars: result.text.length,
        llmMs: Math.round(performance.now() - started),
        usage: result.usage,
      },
      'chat completed',
    );

    const updated = trimHistory(
      [...prior, userMessage, { role: 'assistant', content: result.text }],
      this.opts.maxHistoryMessages,
    );
    await this.opts.store.save(conversationId, updated).catch((err: unknown) => {
      log.warn({ err, conversationId }, 'conversation store write failed');
    });

    return { reply: result.text, conversationId };
  }
}

/** Keeps the most recent messages, always starting on a user turn. */
export function trimHistory(messages: ChatMessage[], max: number): ChatMessage[] {
  if (max <= 0) return [];
  let trimmed = messages.slice(-max);
  while (trimmed.length > 0 && trimmed[0]!.role !== 'user') {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}
