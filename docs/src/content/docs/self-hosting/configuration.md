---
title: Configuration
description: Environment variables and configuration options for self-hosted instances.
---

## Environment Variables

All configuration is done through environment variables in the `.env` file. At least one provider must be configured (Gemini, Claude, Groq, or Ollama); the route returns `503` otherwise.

| Variable          | Required     | Description                                                                                                            |
| ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`  | One of these | Google AI API key (Gemini 3.5 Flash Lite)                                                                              |
| `CLAUDE_API_KEY`  | One of these | Anthropic API key (Claude Haiku 4.5). No free tier - every call is billed, see the note below.                         |
| `GROQ_API_KEY`    | One of these | Groq API key (GPT-OSS 120B). Free tier.                                                                                |
| `OLLAMA_BASE_URL` | One of these | Base URL of a local Ollama daemon (e.g. `http://127.0.0.1:11434`)                                                      |
| `OLLAMA_MODEL`    | Optional     | Ollama model tag, defaults to `llama3.2`. Use any tag from `ollama list`.                                              |
| `OLLAMA_API_KEY`  | Optional     | Bearer token sent as `Authorization: Bearer {key}` on every Ollama request. Only needed if your Ollama is behind auth. |

:::caution
Never commit your `.env` file to version control. It's already in `.gitignore`, but double-check before pushing.
:::

## Provider Priority

The LLM chain composes from whatever's configured in env. Ordering is fixed - cloud
providers run first, Ollama last:

1. **Gemini 3.5 Flash Lite** via Google (`GEMINI_API_KEY`)
2. **Claude Haiku 4.5** via Anthropic (`CLAUDE_API_KEY`) - cross-vendor fallback ahead
   of Groq, opt-in only (no free tier, see the note below)
3. **GPT-OSS 120B** via Groq (`GROQ_API_KEY`) - free-tier cross-vendor fallback
4. **Ollama** (`OLLAMA_BASE_URL`), local, only if explicitly configured

Exactly one model per vendor. A second model on the same API key shares that key's
quota, so it adds latency without adding redundancy; crossing vendors is what makes
the fallback meaningful.

:::caution[Claude has no free tier]
Every other provider here (Gemini, Groq) has a free tier that simply blocks at its
limit - you cannot accidentally incur costs. Anthropic is different: every call that
falls through to the Claude leg is billed against your API key, whether that's a
single resume scan or, on the job-board ingestion side, hundreds of classification
calls in one run.

Leave `CLAUDE_API_KEY` unset to run on Gemini + Groq only, at no cost. Set it if you
want a paid fallback that isn't subject to Groq's free-tier rate limits - Haiku 4.5
is the fast/cheap tier, not Sonnet or Opus, to keep that cost reasonable. Get a key at
[console.anthropic.com](https://console.anthropic.com/settings/keys).
:::

If a provider fails (timeout, rate limit, malformed response), the system automatically tries the next one. Because each provider uses a separate credential, their quotas are completely independent. Self-hosters who want a fully offline scanner should set only `OLLAMA_BASE_URL` and leave the cloud keys unset.

## Running Locally with Ollama

For privacy-first deployments where every byte of the resume stays on your machine:

```bash
# install ollama from https://ollama.com and pull a model
ollama pull llama3.2

# in your .env (or as shell vars before pnpm dev):
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2

# leave GEMINI_API_KEY / CLAUDE_API_KEY / GROQ_API_KEY unset for offline-only mode
```

The Ollama path uses Ollama's `format: 'json'` so the model returns strict JSON without prompt-engineering tricks. First scan is slow on commodity hardware (60-120s for `llama3.2:3b` on a typical laptop); subsequent scans of the same resume hit the in-memory result cache and return in <100ms. Bigger models produce noticeably better suggestions but take longer.

The `/api/analyze` response includes `_provider: "ollama-{model}"` so you can confirm requests are landing locally and not falling back to a cloud key you forgot to remove.

### Behind a reverse proxy or auth gate

Vanilla `ollama serve` on `127.0.0.1` has no authentication, which is fine for a local-only setup. If your Ollama lives behind a reverse proxy that requires a bearer token, or you're pointing at a hosted Ollama-compatible endpoint (OpenWebUI, LiteLLM, OpenRouter's Ollama-compatible routes, a Cloudflare-tunneled daemon with a service token, etc.), set `OLLAMA_API_KEY` and the request will include `Authorization: Bearer {key}` on every call:

```bash
# in your .env
OLLAMA_BASE_URL=https://ollama.your-domain.tld
OLLAMA_MODEL=llama3.2
OLLAMA_API_KEY=sk-your-proxy-token
```

The header is only attached when the env var is non-empty, so leaving it unset keeps the request shape identical to the local-only setup. Empty or whitespace-only values are treated as not set so a stray `OLLAMA_API_KEY=` line in `.env` does not produce a malformed `Authorization: Bearer ` header that the proxy would reject.

## Authentication

How users sign in (or whether they sign in at all) is a separate choice from the LLM provider, and it's also driven by environment variables. ATS Screener supports three modes, picked automatically:

- **Anonymous**: leave Firebase and LDAP unset. The scanner is open and history is local. This is the default.
- **Firebase**: set the `PUBLIC_FIREBASE_*` variables for Google / email sign-in and synced history.
- **Active Directory**: set `LDAP_URL` for on-premise AD sign-in.

See [Authentication](/docs/self-hosting/authentication) for the full comparison and the [Active Directory guide](/docs/self-hosting/active-directory) for AD setup. The Firebase variables are listed below.

```bash
# self-host without firebase: leave every PUBLIC_FIREBASE_* var unset (the default).
# self-host with firebase: set all six.
PUBLIC_FIREBASE_API_KEY=...
PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
PUBLIC_FIREBASE_PROJECT_ID=your-project
PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abc
```

## Free Tier Limits

| Provider  | Model                 | RPM | RPD | TPM  | Cost               |
| --------- | --------------------- | --- | --- | ---- | ------------------ |
| Google    | Gemini 3.5 Flash Lite | 15  | 500 | 250K | Free               |
| Anthropic | Claude Haiku 4.5      | -   | -   | -    | Paid, no free tier |
| Groq      | GPT-OSS 120B          | -   | -   | 8K   | Free               |

Groq's free-tier ceiling for GPT-OSS 120B is lower than the old Llama 3.3 70B leg it
replaced (8K TPM vs. the previous 12K), so it throttles faster under sustained load -
this is what makes Claude a meaningfully more reliable (if paid) fallback ahead of it.

Google and Groq block at their limits and never auto-charge - you cannot accidentally
incur costs on either. Claude is the one leg where usage translates directly to a bill;
see the caution above before setting `CLAUDE_API_KEY`.

For the latest limits, see the official documentation:

- [Google AI rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Anthropic rate limits](https://docs.anthropic.com/en/api/rate-limits)
- [Groq rate limits](https://console.groq.com/docs/rate-limits)

## Rate Limiting

Rate limiting is configured in `src/routes/api/analyze/+server.ts`:

```typescript
const RATE_LIMIT = {
	maxPerMinute: 10,
	maxPerDay: 200
};
```

Adjust these values based on your expected traffic and API key limits.

## Timeouts

Each provider has its own timeout. [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute) is enabled by default and allows up to 300 seconds on the Hobby plan:

```typescript
// Google: 30s, Claude: 12s, Groq: 15s → worst case total: 57s
timeoutMs: 30_000; // buildGoogleProvider
timeoutMs: 12_000; // buildClaudeProvider
timeoutMs: 15_000; // buildGroqProvider
```

Two constraints govern these numbers.

**They must sum to less than the route's `maxDuration` (60s)**, or the platform kills the
function before the last leg can run, silently turning a three-provider chain into a
shorter one. 30 + 12 + 15 leaves 3s of margin.

**Each provider's token budget must be reachable inside its own timeout.** Measured
throughput is 311 tok/s on Flash Lite, so a 6,144-token Google budget needs 19.8s. The
Claude and Groq budgets (3,072 tokens each) are conservative, unverified starting
points rather than measured figures - Claude has no free-tier ceiling to tune against
the way Groq's TPM limit does, and Groq's own budget was carried over from a
now-deprecated model. If a budget were raised above what its timeout allows, any
response that ran to full length would be aborted mid-flight, wasting the call and the
fallback behind it. A unit test enforces this.

Typical Flash Lite requests answer in 9-11s, well below its 30s ceiling. Output size
tracks the fixed 6-platform schema rather than resume length, so a short resume and a
maxed-out one produce within 5% of the same number of output tokens.

If every provider fails the route returns `503` and logs `llm.all_providers_failed` at
error level, and the client falls back to rule-based scoring.
