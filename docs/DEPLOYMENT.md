# Deploying GoNex

GoNex is a standalone Node.js service packaged as a Docker image. The primary target is **Render**, which provides managed HTTPS. The same image runs on any Docker host.

## Prerequisites
- A **Groq API key**: https://console.groq.com/keys
- A **GitHub** (or GitLab/Bitbucket) repository containing this project
- A **Render** account: https://render.com
- The CryptoNet frontend's production origin, e.g. `https://app.cryptonet.example`

## 1. Push the code

```bash
cd GoNex
git init && git add . && git commit -m "GoNex backend"
git remote add origin git@github.com:<you>/gonex-backend.git
git push -u origin main
```

`.gitignore` excludes `.env`, `node_modules` and `dist`. Never commit real secrets.

## 2. Create the Render service (Blueprint)

1. In Render, go to **New → Blueprint** and select the repository. Render reads `render.yaml`.
2. When prompted, enter the secrets:
   - `LLM_API_KEY`: your Groq key
   - `ALLOWED_ORIGINS`: the frontend origin(s), comma-separated, for example `https://app.cryptonet.example`. The built-in chat UI is same-origin and works without being listed. If the CryptoNet frontend isn't live yet, put your Render URL here (e.g. `https://gonex-api.onrender.com`) and update it later. Add a dev origin such as `http://localhost:5173` only if the deployed API should accept it.
3. Click **Apply**. Render builds the Dockerfile, starts the service, and waits for `GET /health` to return 200 before routing traffic.
4. Your public HTTPS base URL is shown at the top of the service page, e.g. `https://gonex-api.onrender.com`.
   - Opening that URL in a browser shows the **GoNex chat interface**, ready to use.
   - The same URL is the **API base URL to give the frontend developer**, for `POST /api/chat`.

*Manual alternative:* **New → Web Service → your repo → Runtime: Docker**. Set the health check path to `/health` and add the environment variables from the table below.

### Plan choice
`render.yaml` uses the `free` plan, so no payment details are needed. A free service spins down after about 15 minutes idle, and the first request after that takes about a minute. For production, change it to `plan: starter` (paid).

## 3. Custom domain (optional)

Go to Render **Settings → Custom Domains → Add**, e.g. `gonex.example.com`, then create the CNAME record Render shows you. Render issues and renews the TLS certificate automatically. HTTP requests are redirected to HTTPS.

## 4. Verify the deployment

```bash
BASE=https://gonex-api.onrender.com
curl -s $BASE/health                                   # {"status":"ok"}
curl -s -X POST $BASE/api/chat -H 'Content-Type: application/json' \
  -d '{"message":"What does EXPIRED mean?"}'

# CORS preflight from the frontend origin. Expect access-control-allow-origin in the response.
curl -s -o /dev/null -D - -X OPTIONS $BASE/api/chat \
  -H 'Origin: https://app.cryptonet.example' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type' | grep -i access-control
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_API_KEY` | **yes** | – | Groq API key. Server-side only and never sent to clients or written to logs. |
| `ALLOWED_ORIGINS` | **yes (production)** | – | Comma-separated CORS allow-list of exact origins. Trailing slashes are ignored. |
| `NODE_ENV` | no | `development` | Set to `production` on Render. |
| `KNOWLEDGE_MODE` | no | `retrieval` | `retrieval` sends only the most relevant knowledge sections (about 2k prompt tokens per request). `full` sends the whole knowledge file (about 6k), which is best on a paid Groq tier. |
| `KNOWLEDGE_TOKEN_BUDGET` | no | `1600` | Maximum knowledge tokens per request in retrieval mode. |
| `SERVE_WEB_UI` | no | `true` | Serve the built-in chat page at `/`. |
| `PORT` | no | `3000` (Render injects `10000`) | Listen port. |
| `HOST` | no | `0.0.0.0` | Listen address. |
| `LOG_LEVEL` | no | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |
| `TRUST_PROXY` | no | `false` (`true` in `render.yaml`) | Whether to trust `X-Forwarded-For` for the client IP used in rate limiting. Accepts `true`, `false`, a hop count, or proxy IPs/CIDRs. |
| `LLM_MODEL` | no | `openai/gpt-oss-120b` | Any Groq chat model ID. Groq retires models over time; list the current ones with `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $LLM_API_KEY"`. |
| `LLM_REASONING_EFFORT` | no | `low` | Reasoning effort for reasoning models (`none`, `default`, `low`, `medium` or `high`). Leave empty for models that don't support it. `low` keeps replies fast. |
| `LLM_MAX_TOKENS` | no | `1024` | Maximum completion tokens, including the model's hidden reasoning tokens. |
| `LLM_TEMPERATURE` | no | `0.2` | Kept low for factual, consistent answers. |
| `LLM_TIMEOUT_MS` | no | `30000` | Per-attempt timeout for the Groq call (one retry). |
| `REDIS_URL` | no | – | When set, conversations and rate-limit counters are stored in Redis. Otherwise in-process memory is used. |
| `CONVERSATION_TTL_SECONDS` | no | `3600` | How long an idle conversation is remembered. |
| `MAX_HISTORY_MESSAGES` | no | `8` | How many recent messages are sent to the model as context. |
| `MAX_MESSAGE_CHARS` | no | `2000` | Maximum user message length. |
| `RATE_LIMIT_MAX` | no | `20` | Requests allowed per client IP per window. |
| `RATE_LIMIT_WINDOW` | no | `1 minute` | Rate-limit window, e.g. `1 minute` or `30 seconds`. |

The service refuses to start if required variables are missing or invalid. The error names the variable and never prints its value.

## Scaling and Redis

With the default in-memory store, conversation history and rate-limit counters live inside one instance and are lost on redeploy. That's fine for a single instance. If you run more than one instance, or want history to survive deploys:

1. Uncomment the `keyvalue` service and the `REDIS_URL` entry in `render.yaml` (or create a Render Key Value instance manually and copy its internal connection string into `REDIS_URL`).
2. Redeploy. The startup log line `GoNex ready` shows `"conversationStore":"redis"`.

If Redis becomes unreachable, GoNex keeps answering. It continues without history and skips rate limiting until Redis is back.

## Groq capacity

On Groq's free tier, each model is limited to about **8,000 tokens per minute** for the whole API key. In the default `KNOWLEDGE_MODE=retrieval`, a GoNex request uses about 2–3k tokens, so the service handles about **3 chats per minute in total**. With `full` mode it's about 1 per minute.

- Short bursts above the limit are absorbed: the Groq SDK waits and retries, and the chat UI shows "Still working on it…".
- If Groq still refuses, the frontend gets a `503` and can retry.
- **For real production traffic, upgrade the Groq key to a paid (Developer) tier.** It raises these limits substantially. Consider switching to `KNOWLEDGE_MODE=full` at the same time.

## Monitoring and logging
- **Health:** Render polls `GET /health`. Point any uptime monitor (e.g. UptimeRobot or Better Stack) at the same URL.
- **Logs:** structured JSON (pino) on stdout, visible under **Render → Logs**. Each request is logged with a request ID, status and response time. Each chat logs `historyMessages`, message and reply lengths, LLM latency (`llmMs`) and token usage. Message content is **not** logged.
- **Alerts to watch for:** `"AI provider unavailable"` entries (with a `reason`, e.g. `provider responded 401`, which means a bad key, or `429`, which means Groq quota) and `"unhandled error"` entries.

### Client IP and rate limiting on Render
Render's proxy puts the real client IP first in `X-Forwarded-For`, and `TRUST_PROXY=true` makes GoNex use that entry. After deploying, check the `remoteAddress` values in the logs. They should be real client IPs, not Render-internal addresses. If they're internal addresses, set `TRUST_PROXY` to the correct hop count.

## Updating the CryptoNet knowledge

GoNex's knowledge comes from **`knowledge/cryptonet.md`**, which is loaded at startup and placed in the system prompt. To update what GoNex knows:

1. Edit `knowledge/cryptonet.md`. Keep it factual, since GoNex treats it as the only source of truth. Keep the `##` / `###` heading structure, because retrieval mode ranks and selects content by section.
2. Run `npm test`, then commit and push. Render redeploys automatically.

No vector database or embedding step is needed. Retrieval is an in-process keyword ranker (BM25) in `src/ai/knowledge.ts` over the heading sections. It is rebuilt at startup from the file.

## Running elsewhere (any Docker host)

```bash
docker build -t gonex .
docker run -d --name gonex -p 10000:10000 \
  -e NODE_ENV=production \
  -e LLM_API_KEY=gsk_... \
  -e ALLOWED_ORIGINS=https://app.cryptonet.example \
  gonex
```

Put an HTTPS-terminating reverse proxy in front of it (e.g. Caddy: `gonex.example.com { reverse_proxy localhost:10000 }`) and set `TRUST_PROXY=1`.
