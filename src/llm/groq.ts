import Groq, { APIConnectionError, APIError, type ClientOptions } from 'groq-sdk';
import type { Config } from '../config.js';
import { AiUnavailableError } from '../errors.js';
import type { CompletionResult, LlmClient } from './types.js';

export class GroqLlmClient implements LlmClient {
  private readonly client: Groq;

  constructor(
    private readonly cfg: Config['llm'],
    clientOptions: Partial<ClientOptions> = {},
  ) {
    this.client = new Groq({
      apiKey: cfg.apiKey,
      timeout: cfg.timeoutMs,
      maxRetries: 1,
      ...clientOptions,
    });
  }

  async complete({ system, messages }: Parameters<LlmClient['complete']>[0]): Promise<CompletionResult> {
    let completion;
    try {
      completion = await this.client.chat.completions.create({
        model: this.cfg.model,
        temperature: this.cfg.temperature,
        max_completion_tokens: this.cfg.maxTokens,
        ...(this.cfg.reasoningEffort ? { reasoning_effort: this.cfg.reasoningEffort } : {}),
        messages: [{ role: 'system', content: system }, ...messages],
      });
    } catch (err) {
      throw toAiError(err);
    }

    const choice = completion.choices[0];
    // Reasoning models return their reasoning separately; strip any inline <think> block defensively.
    const text = choice?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (!text) {
      throw new AiUnavailableError(`empty completion (finish_reason: ${choice?.finish_reason ?? 'unknown'})`);
    }
    return {
      text,
      usage: {
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
      },
    };
  }
}

/**
 * Every provider failure (timeouts, connectivity, upstream 5xx, provider-side
 * rate limits, bad key/model config) is surfaced to clients as a 503. The
 * detailed reason is kept on the error for server-side logging only.
 */
function toAiError(err: unknown): AiUnavailableError {
  if (err instanceof APIConnectionError) {
    return new AiUnavailableError(`provider connection error: ${err.constructor.name}`, { cause: err });
  }
  if (err instanceof APIError) {
    return new AiUnavailableError(`provider responded ${err.status ?? 'unknown'}`, { cause: err });
  }
  return new AiUnavailableError('unexpected provider error', { cause: err });
}
