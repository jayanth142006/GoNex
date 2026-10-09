import { describe, expect, it } from 'vitest';
import { AiUnavailableError } from '../src/errors.js';
import { GroqLlmClient } from '../src/llm/groq.js';

const cfg = {
  apiKey: 'gsk_test',
  model: 'test-model',
  reasoningEffort: 'low' as const,
  maxTokens: 100,
  temperature: 0.2,
  timeoutMs: 5000,
};

function clientReturning(status: number, body: unknown) {
  const requests: { url: string; body: any; auth: string | null }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get('authorization'),
    });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { client: new GroqLlmClient(cfg, { fetch: fetch as typeof globalThis.fetch, maxRetries: 0 }), requests };
}

describe('GroqLlmClient', () => {
  it('sends system prompt + history and returns the reply text', async () => {
    const { client, requests } = clientReturning(200, {
      id: 'x',
      object: 'chat.completion',
      created: 0,
      model: 'test-model',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '  Hello!  ' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
    const res = await client.complete({ system: 'SYS', messages: [{ role: 'user', content: 'hi' }] });
    expect(res).toEqual({ text: 'Hello!', usage: { promptTokens: 10, completionTokens: 2 } });
    expect(requests[0]!.url).toContain('/openai/v1/chat/completions');
    expect(requests[0]!.auth).toBe('Bearer gsk_test');
    expect(requests[0]!.body).toMatchObject({
      model: 'test-model',
      max_completion_tokens: 100,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'hi' },
      ],
    });
  });

  it.each([401, 429, 500, 503])('maps provider HTTP %i to AiUnavailableError', async (status) => {
    const { client } = clientReturning(status, { error: { message: 'boom' } });
    await expect(client.complete({ system: 'S', messages: [{ role: 'user', content: 'q' }] })).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });

  it('treats an empty completion as unavailable', async () => {
    const { client } = clientReturning(200, {
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '' } }],
    });
    await expect(client.complete({ system: 'S', messages: [{ role: 'user', content: 'q' }] })).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });

  it('maps network failures to AiUnavailableError', async () => {
    const client = new GroqLlmClient(cfg, {
      maxRetries: 0,
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof globalThis.fetch,
    });
    await expect(client.complete({ system: 'S', messages: [{ role: 'user', content: 'q' }] })).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });
});
