/**
 * ┌─────────────────────────────────────────────────┐
 * │         ✏️  EDIT THIS FILE                       │
 * │  This is the ONLY file you need to change.      │
 * │  Everything else works out of the box.           │
 * └─────────────────────────────────────────────────┘
 *
 * Steps:
 *  1. Change SERVICE_NAME, PRICE_USDC, and DESCRIPTION
 *  2. Update the outputSchema to match your API contract
 *  3. Replace the logic inside the /run handler
 *  4. That's it. Deploy.
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';

export const serviceRouter = new Hono();

// ─── YOUR CONFIGURATION ─────────────────────────────
// Change these three values to match your service.

const SERVICE_NAME = 'web-scraper';
const PRICE_USDC = 0.005;  // $0.005 per request (half a cent)
const DESCRIPTION = 'Fetch any webpage through a real 4G/5G mobile IP. Returns clean text content.';

// Describes what your API accepts and returns.
// AI agents use this to understand your service contract.
const OUTPUT_SCHEMA = {
  input: {
    url: 'string — URL to fetch (required)',
  },
  output: {
    url: 'string — the URL that was fetched',
    status: 'number — HTTP status code from the target',
    text: 'string — page text content (max 50KB)',
    contentLength: 'number — original content length in bytes',
    proxy: '{ country: string, type: "mobile" }',
  },
};

// ─── YOUR ENDPOINT ──────────────────────────────────
// This is where your service logic lives.

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // ── Step 1: Check for payment ──
  const payment = extractPayment(c);

  if (!payment) {
    // No payment header → return 402 with full payment instructions.
    // AI agents parse this JSON to know what to pay and where.
    return c.json(
      build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  // ── Step 2: Verify payment on-chain ──
  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);

  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
    }, 402);
  }

  // ── Step 3: Validate input ──
  const url = c.req.query('url');
  if (!url) {
    return c.json({ error: 'Missing required parameter: ?url=<target_url>' }, 400);
  }

  // Basic URL validation — block private/internal networks
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return c.json({ error: 'Only http:// and https:// URLs are allowed' }, 400);
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('172.') ||
      host === '169.254.169.254' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return c.json({ error: 'Private/internal URLs are not allowed' }, 400);
    }
  } catch {
    return c.json({ error: 'Invalid URL format' }, 400);
  }

  // ── Step 4: Your logic — fetch URL through mobile proxy ──
  try {
    const proxy = getProxy();
    const response = await proxyFetch(url);
    const text = await response.text();
    const maxLen = 50_000; // 50KB cap

    // Set payment confirmation headers
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      url,
      status: response.status,
      text: text.length > maxLen ? text.substring(0, maxLen) : text,
      contentLength: text.length,
      proxy: { country: proxy.country, type: 'mobile' },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    return c.json({
      error: 'Service execution failed',
      message: err.message,
      hint: 'The target URL may be unreachable or the proxy may be temporarily unavailable.',
    }, 502);
  }
});
