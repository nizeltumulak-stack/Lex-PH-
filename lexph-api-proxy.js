/**
 * LexPH — Cloudflare Worker: API Proxy + Web Scraper
 * ─────────────────────────────────────────────────────────────
 * ENVIRONMENT VARIABLES:
 *   GEMINI_API_KEY  → your Google Gemini API key (Secret)
 *   ALLOWED_ORIGIN  → https://lex-ph.netlify.app (Plain text)
 *
 * ENDPOINTS:
 *   POST /          → AI chat (Gemini)
 *   POST /scrape    → Scrape a URL and return text content
 *   POST /search    → Full deep search pipeline
 * ─────────────────────────────────────────────────────────────
 */

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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

      // Only allow known PH legal sources
      const allowedDomains = [
        'elibrary.judiciary.gov.ph',
        'sc.judiciary.gov.ph',
        'lawphil.net',
        'chanrobles.com',
        'officialgazette.gov.ph',
        'senate.gov.ph',
        'congress.gov.ph',
        'projectjurisprudence.com',
        'bir.gov.ph',
        'dole.gov.ph',
        'denr.gov.ph',
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

        // Extract clean text from HTML
        const cleanText = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000); // Limit to 8000 chars

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

    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const geminiBody = {
      system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      contents,
      generationConfig: {
        maxOutputTokens: Math.min(body.max_tokens || 2000, 8192),
        temperature: 0.3,
      },
    };

    let geminiRes;
    try {
      geminiRes = await fetch(`${GEMINI_API}?key=${env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to reach Gemini API', detail: err.message }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const geminiData = await geminiRes.json();

    let responseText = '';
    try {
      responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch {
      responseText = 'Sorry, I could not process your request.';
    }

    // Return in Anthropic-compatible format so frontend works unchanged
    return new Response(JSON.stringify({
      id: 'gemini-' + Date.now(),
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: responseText }],
      model: 'gemini-2.0-flash',
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
