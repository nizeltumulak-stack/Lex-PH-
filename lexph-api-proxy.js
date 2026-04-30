/**
 * LexPH — Cloudflare Worker: API Proxy (Groq)
 * ─────────────────────────────────────────────────────────────
 * ENVIRONMENT VARIABLES:
 *   GEMINI_API_KEY  → your Groq API key (Secret)
 *   ALLOWED_ORIGIN  → https://lex-ph.netlify.app (Plain text)
 */

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const rateLimitMap = new Map();
const RATE_LIMIT_REQUESTS = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const corsHeaders = (origin, allowedOrigin) => ({
  'Access-Control-Allow-Origin': origin === allowedOrigin || origin?.includes('localhost') ? origin : allowedOrigin || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const headers = corsHeaders(origin, allowedOrigin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    // Check API key is configured
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured in Worker environment' }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(ip)) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please wait.' }), {
        status: 429, headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── SCRAPE ENDPOINT ──────────────────────────────────────
    if (path === '/scrape') {
      let body = {};
      try { body = await request.json(); } catch {}

      const targetUrl = body.url;
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'url is required' }), {
          status: 400, headers: { 'Content-Type': 'application/json', ...headers },
        });
      }

      const allowedDomains = [
        'elibrary.judiciary.gov.ph', 'sc.judiciary.gov.ph', 'lawphil.net',
        'chanrobles.com', 'officialgazette.gov.ph', 'senate.gov.ph',
        'congress.gov.ph', 'projectjurisprudence.com', 'bir.gov.ph',
        'dole.gov.ph', 'denr.gov.ph',
      ];

      const isAllowed = allowedDomains.some(d => targetUrl.includes(d));
      if (!isAllowed) {
        return new Response(JSON.stringify({ error: 'Domain not in allowed list' }), {
          status: 403, headers: { 'Content-Type': 'application/json', ...headers },
        });
      }

      try {
        const scrapeRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; LexPHBot/1.0; +https://lex-ph.netlify.app)',
            'Accept': 'text/html,application/xhtml+xml',
          },
          cf: { cacheTtl: 3600, cacheEverything: true },
        });

        const html = await scrapeRes.text();
        const cleanText = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000);

        return new Response(JSON.stringify({ success: true, url: targetUrl, content: cleanText }), {
          headers: { 'Content-Type': 'application/json', ...headers },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Failed to scrape: ' + err.message }), {
          status: 502, headers: { 'Content-Type': 'application/json', ...headers },
        });
      }
    }

    // ── AI CHAT ENDPOINT (default /) ─────────────────────────
    let body = {};
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const messages = body.messages || [];
    const systemPrompt = body.system || '';

    const groqMessages = [];
    if (systemPrompt) {
      groqMessages.push({ role: 'system', content: systemPrompt });
    }
    for (const msg of messages) {
      groqMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
    }

    const groqBody = {
      model: GROQ_MODEL,
      messages: groqMessages,
      max_tokens: Math.min(body.max_tokens || 2000, 8000),
      temperature: 0.3,
    };

    let groqRes;
    try {
      groqRes = await fetch(GROQ_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(groqBody),
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to reach Groq API', detail: err.message }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    if (!groqRes.ok) {
      let errDetail = {};
      try { errDetail = await groqRes.json(); } catch {}
      const msg = errDetail?.error?.message || errDetail?.message || JSON.stringify(errDetail);
      return new Response(JSON.stringify({ error: `Groq API error ${groqRes.status}: ${msg}` }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const groqData = await groqRes.json();
    const responseText = groqData.choices?.[0]?.message?.content || '';

    if (!responseText) {
      return new Response(JSON.stringify({ error: 'Groq returned empty response' }), {
        status: 422, headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    return new Response(JSON.stringify({
      id: 'groq-' + Date.now(),
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: responseText }],
      model: GROQ_MODEL,
      stop_reason: 'end_turn',
    }), {
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  },
};

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