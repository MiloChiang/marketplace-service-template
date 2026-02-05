# Marketplace Service Template

Build a paid API on [Proxies.sx](https://agents.proxies.sx) mobile proxy infrastructure. Gate with x402 USDC micropayments. Keep the margin.

## Economics

| | Your Cost | You Charge | Your Margin |
|-|-----------|------------|-------------|
| Per request (0.01 GB proxy) | $0.04 / 100 req | $0.005 / req | **$0.46 / 100 req** |
| At 1,000 req/day | ~$0.40/day | ~$5/day | **~$4.60/day** |
| At 10,000 req/day | ~$4/day | ~$50/day | **~$46/day** |

Proxy cost: $4/GB shared, $8/GB private ([live pricing](https://api.proxies.sx/v1/x402/pricing)).

## Quick Start

```bash
# Fork this repo, then:
git clone https://github.com/YOUR_USERNAME/marketplace-service-template
cd marketplace-service-template

cp .env.example .env
# Edit .env: set WALLET_ADDRESS + PROXY_* credentials

bun install
bun run dev
```

Test it:
```bash
curl http://localhost:3000/health
# → {"status":"healthy","service":"my-service",...}

curl http://localhost:3000/
# → Service discovery JSON (AI agents read this)

curl http://localhost:3000/api/run?url=https://example.com
# → 402 with payment instructions (this is correct!)
```

## Edit One File

**`src/service.ts`** — change three values and the handler:

```typescript
const SERVICE_NAME = 'my-scraper';       // Your service name
const PRICE_USDC = 0.005;               // Price per request ($)
const DESCRIPTION = 'What it does';      // For AI agents

serviceRouter.get('/run', async (c) => {
  // ... payment check + verification (already wired) ...

  // YOUR LOGIC HERE:
  const result = await proxyFetch('https://target.com');
  return c.json({ data: await result.text() });
});
```

Everything else (server, CORS, rate limiting, payment verification, proxy helper) works out of the box.

## How x402 Payment Works

```
AI Agent                         Your Service                    Blockchain
   │                                  │                              │
   │─── GET /api/run ────────────────►│                              │
   │◄── 402 {price, wallet, nets} ────│                              │
   │                                  │                              │
   │─── Send USDC ──────────────────────────────────────────────────►│
   │◄── tx confirmed ◄──────────────────────────────────────────────│
   │                                  │                              │
   │─── GET /api/run ────────────────►│                              │
   │    Payment-Signature: <tx_hash>  │─── verify tx on-chain ──────►│
   │                                  │◄── confirmed ◄──────────────│
   │◄── 200 {result} ────────────────│                              │
```

Supports **Solana** (~400ms, ~$0.0001 gas) and **Base** (~2s, ~$0.01 gas).

## What's Included

| File | Purpose | Edit? |
|------|---------|-------|
| `src/service.ts` | Your service logic, pricing, description | **✏️ YES** |
| `src/index.ts` | Server, CORS, rate limiting, discovery | No |
| `src/payment.ts` | On-chain USDC verification (Solana + Base) | No |
| `src/proxy.ts` | Proxy credentials + fetch with retry | No |
| `CLAUDE.md` | Instructions for AI agents editing this repo | No |
| `SECURITY.md` | Security features and production checklist | Read it |
| `Dockerfile` | Multi-stage build, non-root, health check | No |

## Security

Built in by default:

- ✅ **On-chain payment verification** — Solana + Base RPCs, not trust-the-header
- ✅ **Replay prevention** — Each tx hash accepted only once
- ✅ **SSRF protection** — Private/internal URLs blocked
- ✅ **Rate limiting** — Per-IP, configurable (default 60/min)
- ✅ **Security headers** — nosniff, DENY framing, no-referrer

See [SECURITY.md](SECURITY.md) for production hardening.

## Get Proxy Credentials

**Option A:** Dashboard → [client.proxies.sx](https://client.proxies.sx)

**Option B:** x402 API (no account):
```bash
curl https://api.proxies.sx/v1/x402/proxy?country=US&traffic=1
# Returns 402 → pay USDC → get credentials
```

**Option C:** MCP Server (59 tools):
```bash
npx -y @proxies-sx/mcp-server
```

## Deploy

```bash
# Docker
docker build -t my-service .
docker run -p 3000:3000 --env-file .env my-service

# Any VPS with Bun
bun install --production && bun run start

# Railway / Fly.io / Render
# Just connect the repo — Dockerfile detected automatically
```

## List on Marketplace

Once live, submit to [agents.proxies.sx/marketplace](https://agents.proxies.sx/marketplace/):

1. Fill in [submit.md](https://agents.proxies.sx/marketplace/submit.md)
2. Send to [@proxyforai](https://t.me/proxyforai) or [@sxproxies](https://x.com/sxproxies)
3. Maya verifies and lists your service

## Links

| Resource | URL |
|----------|-----|
| Marketplace | [agents.proxies.sx/marketplace](https://agents.proxies.sx/marketplace/) |
| Skill File | [agents.proxies.sx/skill.md](https://agents.proxies.sx/skill.md) |
| x402 SDK | [@proxies-sx/x402-core](https://www.npmjs.com/package/@proxies-sx/x402-core) |
| MCP Server | [@proxies-sx/mcp-server](https://www.npmjs.com/package/@proxies-sx/mcp-server) |
| Proxy Pricing | [api.proxies.sx/v1/x402/pricing](https://api.proxies.sx/v1/x402/pricing) |
| API Docs | [api.proxies.sx/docs/api](https://api.proxies.sx/docs/api) |
| Telegram | [@proxyforai](https://t.me/proxyforai) |
| Twitter | [@sxproxies](https://x.com/sxproxies) |

## License

MIT — fork it, ship it, profit.
