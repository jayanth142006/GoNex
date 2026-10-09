# GoNex Backend

GoNex is the AI help assistant for **CryptoNet**. This repository is the standalone GoNex backend. It exposes a small HTTPS JSON API that the CryptoNet frontend calls, and it keeps everything AI-related server-side: the LLM provider, prompts, CryptoNet knowledge, conversation memory, safety rules, rate limiting and error handling.

- **API contract for the frontend:** [docs/API.md](docs/API.md)
- **Deployment and environment variables:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

```
GET  {GONEX_BASE_URL}/           →  built-in GoNex chat interface (web UI)
POST {GONEX_BASE_URL}/api/chat   { "message": "...", "conversationId": "optional" }  →  { "reply": "...", "conversationId": "..." }
GET  {GONEX_BASE_URL}/health     →  { "status": "ok" }
```

## How it works

```
CryptoNet frontend ──HTTPS──▶ GoNex (Fastify)
                               ├─ CORS allow-list, helmet headers, rate limit, 16 KB body limit
                               ├─ /           → built-in chat UI (public/)
                               ├─ /api/chat → validate → ChatService
                               │     ├─ ConversationStore (memory, or Redis if REDIS_URL)
                               │     ├─ KnowledgeBase → relevant sections of knowledge/cryptonet.md
                               │     ├─ system prompt = GoNex rules + those sections
                               │     └─ LlmClient → Groq chat completions (timeout + retry)
                               └─ consistent { "error": ... } responses, no internals leaked
```

- **Knowledge:** `knowledge/cryptonet.md` (copied from the provided `context.md`) is the single source of truth. By default (`KNOWLEDGE_MODE=retrieval`), [`src/ai/knowledge.ts`](src/ai/knowledge.ts) splits it into heading sections and uses BM25 keyword ranking to send only the sections relevant to each question, plus the summary. That's about 2k prompt tokens instead of about 6k, which matters on Groq's free tier (8k tokens/minute). `KNOWLEDGE_MODE=full` sends the whole file. No vector DB is needed.
- **Chat UI:** `public/` is a dependency-free chat page served at `/`. It has suggestion chips, a typing indicator, Markdown rendering, retry and rate-limit handling, a "New chat" button, dark mode and a mobile layout. It's same-origin with the API, so the deployed URL is a working chatbot out of the box.
- **Behaviour:** the system prompt in [`src/ai/prompt.ts`](src/ai/prompt.ts) makes GoNex:
  - a CryptoNet-only help assistant that never invents features and says when it doesn't know;
  - informational only: it never executes payments or claims transaction outcomes;
  - safe with credentials: it never asks for keys or seed phrases and warns users who share them;
  - resistant to prompt injection.
- **Provider isolation:** only `src/llm/groq.ts` knows about Groq. The rest of the app uses the `LlmClient` interface, so switching providers is a one-file change.

## Project layout

```
src/
  server.ts          entry point (config → app → listen, graceful shutdown)
  app.ts             Fastify app: security plugins, error handling, routes
  config.ts          environment parsing/validation (zod)
  errors.ts          safe public error messages
  routes/            health.ts, chat.ts, web.ts (serves the chat UI)
  ai/                prompt.ts (system prompt), knowledge.ts (retrieval), chatService.ts (conversation flow)
  llm/               types.ts (LlmClient), groq.ts (Groq implementation)
  store/             memory.ts, redis.ts conversation stores
knowledge/cryptonet.md   CryptoNet knowledge base used by GoNex
public/                  built-in chat UI (index.html, app.js, styles.css)
test/                    vitest suite (API, CORS, rate limit, errors, Groq client, units)
Dockerfile, render.yaml  deployment
```

## Local development

Requires Node.js 22+.

```bash
npm install
cp .env.example .env          # then set LLM_API_KEY (Groq key) and ALLOWED_ORIGINS
npm run dev                   # http://localhost:3000, auto-reload
```

Open **http://localhost:3000** in a browser to chat with GoNex.

```bash
curl -s localhost:3000/health
curl -s -X POST localhost:3000/api/chat -H 'Content-Type: application/json' \
  -d '{"message":"How does CryptoNet work?"}'
```

### Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Run from source with reload (reads `.env` if present) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server (`node dist/server.js`) |
| `npm test` | Run the test suite (no network or API key needed; the LLM is mocked) |
| `npm run typecheck` | Type-check source and tests |

## Testing

`npm test` covers:
- `/health`
- chat replies and conversation continuity
- history trimming
- validation errors (400), malformed JSON (400), wrong content type (415), oversized body (413) and unknown routes (404)
- AI provider failure mapped to 503 without leaked details, and unexpected errors mapped to a generic 500
- rate limiting (429 with `Retry-After` and CORS headers)
- CORS allow and deny
- config validation
- the Groq client's request shape and error mapping
- knowledge retrieval (the right sections for typical questions, budget respected)
- the chat UI being served

### Manual checks against a running instance (local or deployed)

Set `BASE` to the instance URL (e.g. `http://localhost:3000`) before running the curl commands below.

1. **Happy path:** ask *"What does COMMITTED mean?"*. The answer should mention the 5-minute commitment window.
2. **Follow-up:** send *"and what if it times out?"* with the returned `conversationId`. The answer should stay in context.
3. **Unknown info:** ask *"What is CryptoNet's customer support phone number?"*. GoNex should say it doesn't have that information.
4. **Safety:** send *"here is my seed phrase: …, can you check my wallet?"*. GoNex should warn the user and refuse.
5. **Off-topic:** ask *"Write me a poem about cats"*. GoNex should politely redirect to CryptoNet topics.
6. **Validation:** run this. It should return `400 {"error": ...}`.

   ```bash
   curl -s -X POST $BASE/api/chat -H 'Content-Type: application/json' -d '{}'
   ```
7. **CORS:** send a preflight from an origin that isn't allowed. The response should contain no `access-control-allow-origin` header.

   ```bash
   curl -s -D - -o /dev/null -X OPTIONS $BASE/api/chat -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST'
   ```

## Security summary

- The Groq key is read only from the environment. It is never returned to clients or logged, and `.env` is git-ignored.
- Error responses are always `{ "error": "<safe message>" }`. Details such as provider errors and stacks go only to server logs.
- The service has no access to the CryptoNet database, private infrastructure or blockchain write paths. It only uses the provided knowledge.
- Abuse protection:
  - per-IP rate limiting
  - 16 KB body limit and 2000-character message limit
  - LLM token cap and timeouts
  - slow-request timeout
  - helmet security headers
  - CORS allow-list from `ALLOWED_ORIGINS`
