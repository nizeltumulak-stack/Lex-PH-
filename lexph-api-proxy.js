/**
 * LexPH — Cloudflare Worker API Proxy (Google Gemini)
 * ─────────────────────────────────────────────────────────────
 * ENVIRONMENT VARIABLES (set in Cloudflare Worker Settings → Variables):
 *   GEMINI_API_KEY  → your Google Gemini API key (Secret)
 *   ALLOWED_ORIGIN  → https://lex-ph.netlify.app (Plain text)
 * ─────────────────────────────────────────────────────────────
 */

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Rate limiting store (in-memory, resets per Worker instance)
const rateLimitMap = new Map();
const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

export default {
  async fetch(request, env) {

    // ── CORS preflight ──
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, request, env);
    }

    // ── Only allow POST ──
    if (request.method !== 'POST') {
      return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405, request, env);
    }

    // ── Rate limiting by IP ──
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(ip)) {
      return corsResponse(
        JSON.stringify({ error: 'Too many requests. Please wait a moment.' }),
        429, request, env
      );
    }

    // ── Validate origin ──
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || '';
    const isLocalhost = origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
    if (allowedOrigin && !isLocalhost && origin !== allowedOrigin) {
      return corsResponse(JSON.stringify({ error: 'Forbidden origin' }), 403, request, env);
    }

    // ── Parse request body ──
    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse(JSON.stringify({ error: 'Invalid JSON body' }), 400, request, env);
    }

    // ── Convert Anthropic-style messages to Gemini format ──
    const messages = body.messages || [];
    const systemPrompt = body.system || '';

    // Build Gemini contents array
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const geminiBody = {
      system_instruction: systemPrompt ? {
        parts: [{ text: systemPrompt }]
      } : undefined,
      contents,
      generationConfig: {
        maxOutputTokens: Math.min(body.max_tokens || 1000, 2000),
        temperature: 0.7,
      },
    };

    // ── Forward to Gemini ──
    let geminiRes;
    try {
      geminiRes = await fetch(`${GEMINI_API}?key=${env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });
    } catch (err) {
      return corsResponse(
        JSON.stringify({ error: 'Failed to reach Gemini API', detail: err.message }),
        502, request, env
      );
    }

    const geminiData = await geminiRes.json();

    // ── Convert Gemini response to Anthropic-style format ──
    // So your existing frontend code works without changes
    let responseText = '';
    try {
      responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch {
      responseText = 'Sorry, I could not process your request.';
    }

    const anthropicStyleResponse = {
      id: 'gemini-' + Date.now(),
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: responseText }],
      model: 'gemini-2.0-flash',
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    };

    return new Response(JSON.stringify(anthropicStyleResponse), {
      status: 200,
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

function corsResponse(body, status, request, env) {
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
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_REQUESTS) return false;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return true;
}
