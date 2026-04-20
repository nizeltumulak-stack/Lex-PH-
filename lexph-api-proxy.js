/**
 * LexPH — Cloudflare Worker API Proxy
 * ─────────────────────────────────────────────────────────────
 * Proxies requests to Anthropic API so the API key is NEVER
 * exposed in the browser. Deploy this to Cloudflare Workers.
 *
 * SETUP STEPS:
 *  1. Go to https://workers.cloudflare.com → Create Worker
 *  2. Paste this entire file into the editor
 *  3. Go to Settings → Variables → Add:
 *       ANTHROPIC_API_KEY = sk-ant-xxxxxxxxxxxx   (Secret)
 *       ALLOWED_ORIGIN   = https://yourdomain.com  (Plain text)
 *  4. Click Deploy → copy your worker URL (e.g. lexph-proxy.yourname.workers.dev)
 *  5. In index.html, replace the fetch URL with your worker URL
 * ─────────────────────────────────────────────────────────────
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Rate limiting store (in-memory, resets per Worker instance)
const rateLimitMap = new Map();
const RATE_LIMIT_REQUESTS = 10;   // max requests
const RATE_LIMIT_WINDOW_MS = 60_000; // per 60 seconds per IP

export default {
  async fetch(request, env) {

    // ── CORS preflight ──
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env);
    }

    // ── Only allow POST ──
    if (request.method !== 'POST') {
      return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405, env);
    }

    // ── Rate limiting by IP ──
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(ip)) {
      return corsResponse(
        JSON.stringify({ error: 'Too many requests. Please wait a moment.' }),
        429, env
      );
    }

    // ── Validate origin ──
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || '';
    const isLocalhost = origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
    if (allowedOrigin && !isLocalhost && origin !== allowedOrigin) {
      return corsResponse(JSON.stringify({ error: 'Forbidden origin' }), 403, env);
    }

    // ── Parse and validate request body ──
    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse(JSON.stringify({ error: 'Invalid JSON body' }), 400, env);
    }

    // Enforce safe defaults — never let the client control the model or override system prompts unsafely
    const safeBody = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: Math.min(body.max_tokens || 1000, 2000), // cap at 2000
      system: body.system || '',
      messages: body.messages || [],
    };

    // ── Forward to Anthropic ──
    let anthropicRes;
    try {
      anthropicRes = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(safeBody),
      });
    } catch (err) {
      return corsResponse(
        JSON.stringify({ error: 'Failed to reach Anthropic API', detail: err.message }),
        502, env
      );
    }

    const responseText = await anthropicRes.text();

    return new Response(responseText, {
      status: anthropicRes.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(request, env),
      },
    });
  },
};

// ── Helpers ──────────────────────────────────────────────────

function corsHeaders(request, env) {
  const origin = request?.headers?.get('Origin') || '*';
  const allowed = env?.ALLOWED_ORIGIN || '*';
  const isLocalhost = origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
  return {
    'Access-Control-Allow-Origin': (isLocalhost || origin === allowed) ? origin : allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function corsResponse(body, status, env, request = null) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request, env),
    },
  });
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // Reset window
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_REQUESTS) return false;

  entry.count++;
  rateLimitMap.set(ip, entry);
  return true;
}
