import { APIConnectionTimeoutError } from 'groq-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AiUnavailableError } from '../src/errors.js';
import { ALLOWED_ORIGIN, FakeLlm, makeApp } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const chat = (instance: FastifyInstance, payload: unknown, headers: Record<string, string> = {}) =>
  instance.inject({ method: 'POST', url: '/api/chat', payload: payload as object, headers });

describe('GET /health', () => {
  it('returns ok', async () => {
    ({ app } = await makeApp());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /api/chat', () => {
  it('returns a reply and a new conversationId', async () => {
    const llm = new FakeLlm();
    ({ app } = await makeApp({ llm }));
    const res = await chat(app, { message: '  How long is the commitment window?  ' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reply).toBe('echo: How long is the commitment window?');
    expect(body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(body).sort()).toEqual(['conversationId', 'reply']);

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.system).toContain('You are GoNex');
    expect(llm.calls[0]!.system).toContain('<cryptonet_knowledge>');
    expect(llm.calls[0]!.system).toContain('Commitment timeout: 5 minutes');
  });

  it('keeps conversation context across turns', async () => {
    const fake = new FakeLlm();
    ({ app } = await makeApp({ llm: fake }));
    const first = (await chat(app, { message: 'What is PENDING?' })).json();
    const second = await chat(app, { message: 'And COMMITTED?', conversationId: first.conversationId });
    expect(second.statusCode).toBe(200);
    expect(second.json().conversationId).toBe(first.conversationId);
    expect(fake.calls[1]!.messages).toEqual([
      { role: 'user', content: 'What is PENDING?' },
      { role: 'assistant', content: 'echo: What is PENDING?' },
      { role: 'user', content: 'And COMMITTED?' },
    ]);
  });

  it('issues a new id for an unknown conversationId instead of adopting it', async () => {
    ({ app } = await makeApp());
    const unknownId = '0b6b1c3e-9a43-4a8e-9a4e-2f6f7e9d1c11';
    const res = await chat(app, { message: 'hi', conversationId: unknownId });
    expect(res.statusCode).toBe(200);
    expect(res.json().conversationId).not.toBe(unknownId);
  });

  it('treats null or empty conversationId as absent', async () => {
    ({ app } = await makeApp());
    for (const conversationId of [null, '']) {
      const res = await chat(app, { message: 'hi', conversationId });
      expect(res.statusCode).toBe(200);
    }
  });

  it('caps stored history at MAX_HISTORY_MESSAGES', async () => {
    const fake = new FakeLlm();
    ({ app } = await makeApp({ llm: fake, env: { MAX_HISTORY_MESSAGES: '4' } }));
    let id: string | undefined;
    for (let i = 0; i < 5; i++) {
      id = (await chat(app, { message: `q${i}`, conversationId: id })).json().conversationId;
    }
    const last = fake.calls.at(-1)!.messages;
    expect(last.map((m) => m.content)).toEqual(['q2', 'echo: q2', 'q3', 'echo: q3', 'q4']);
  });
});

describe('validation and error shape', () => {
  const cases: [string, unknown, number][] = [
    ['missing message', {}, 400],
    ['empty message', { message: '   ' }, 400],
    ['non-string message', { message: 42 }, 400],
    ['too long message', { message: 'x'.repeat(2001) }, 400],
    ['bad conversationId', { message: 'hi', conversationId: 'not-a-uuid' }, 400],
  ];
  it.each(cases)('%s → %i', async (_name, payload, status) => {
    ({ app } = await makeApp());
    const res = await chat(app, payload);
    expect(res.statusCode).toBe(status);
    expect(Object.keys(res.json())).toEqual(['error']);
  });

  it('rejects malformed JSON with 400', async () => {
    ({ app } = await makeApp());
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: '{"message": ',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Request body must be valid JSON.' });
  });

  it('rejects non-JSON content types with 415', async () => {
    ({ app } = await makeApp());
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: 'message=hi',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(415);
    expect(Object.keys(res.json())).toEqual(['error']);
  });

  it('rejects oversized bodies with 413', async () => {
    ({ app } = await makeApp());
    const res = await chat(app, { message: 'x'.repeat(20_000) });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: 'Request body is too large.' });
  });

  it('returns JSON 404 for unknown routes', async () => {
    ({ app } = await makeApp());
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found.' });
  });

  it('maps AI provider failures to 503 without leaking details', async () => {
    const llm = new FakeLlm(() => {
      throw new AiUnavailableError('provider responded 401: invalid api key gsk_secret', {
        cause: new APIConnectionTimeoutError(),
      });
    });
    ({ app } = await makeApp({ llm }));
    const res = await chat(app, { message: 'hi' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'GoNex is temporarily unavailable. Please try again shortly.' });
    expect(res.body).not.toMatch(/gsk_|groq|401|stack/i);
  });

  it('maps unexpected errors to a generic 500', async () => {
    const llm = new FakeLlm(() => {
      throw new Error('ECONNRESET at internal-host:6379 with SYSTEM PROMPT');
    });
    ({ app } = await makeApp({ llm }));
    const res = await chat(app, { message: 'hi' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Unable to process the request.' });
  });
});

describe('knowledge modes', () => {
  it('retrieval mode sends only relevant sections', async () => {
    const llm = new FakeLlm();
    ({ app } = await makeApp({ llm }));
    await chat(app, { message: 'MetaMask rejected my transaction' });
    const system = llm.calls[0]!.system;
    expect(system).toContain('Transaction rejected');
    expect(system).not.toContain('Platform fee recipient / contract owner');
    expect(system.length).toBeLessThan(12_000);
  });

  it('full mode sends the whole knowledge base', async () => {
    const llm = new FakeLlm();
    ({ app } = await makeApp({ llm, env: { KNOWLEDGE_MODE: 'full' } }));
    await chat(app, { message: 'MetaMask rejected my transaction' });
    expect(llm.calls[0]!.system).toContain('Platform fee recipient / contract owner');
  });
});

describe('web UI', () => {
  it('serves the chat page and its assets', async () => {
    ({ app } = await makeApp());
    const page = await app.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('GoNex');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    for (const [url, type] of [
      ['/assets/app.js', 'text/javascript'],
      ['/assets/styles.css', 'text/css'],
    ]) {
      const res = await app.inject({ method: 'GET', url: url! });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain(type!);
    }
  });

  it('can be disabled', async () => {
    ({ app } = await makeApp({ env: { SERVE_WEB_UI: 'false' } }));
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
  });
});

describe('rate limiting', () => {
  it('returns 429 with consistent body after the limit, but never limits /health', async () => {
    ({ app } = await makeApp({ env: { RATE_LIMIT_MAX: '2' } }));
    expect((await chat(app, { message: 'a' })).statusCode).toBe(200);
    expect((await chat(app, { message: 'b' })).statusCode).toBe(200);
    const limited = await chat(app, { message: 'c' }, { origin: ALLOWED_ORIGIN });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'Too many requests. Please slow down and try again later.' });
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);

    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    }
  });
});

describe('CORS', () => {
  it('allows configured origins (preflight and actual request)', async () => {
    ({ app } = await makeApp());
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/chat',
      headers: {
        origin: ALLOWED_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(String(preflight.headers['access-control-allow-methods'])).toContain('POST');

    const res = await chat(app, { message: 'hi' }, { origin: ALLOWED_ORIGIN });
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('does not grant CORS to other origins', async () => {
    ({ app } = await makeApp());
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/chat',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('supports multiple comma-separated origins', async () => {
    ({ app } = await makeApp({ env: { ALLOWED_ORIGINS: `${ALLOWED_ORIGIN}, http://localhost:5173/` } }));
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:5173' } });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
