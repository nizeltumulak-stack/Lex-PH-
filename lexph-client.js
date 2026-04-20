/**
 * LexPH — Backend Client (lexph-client.js)
 * ─────────────────────────────────────────────────────────────
 * Drop this into every HTML page before other scripts:
 *   <script src="lexph-client.js"></script>
 *
 * Set your live URLs in the CONFIG block below once deployed.
 * Until then, it falls back to localStorage automatically.
 * ─────────────────────────────────────────────────────────────
 */

const LEXPH_CONFIG = {
  // ── Fill these in after deploying ──────────────────────────
  // Cloudflare Worker URL for Anthropic API proxy
  WORKER_PROXY_URL: '',   // e.g. 'https://lexph-proxy.yourname.workers.dev'

  // Supabase Edge Function base URL
  AUTH_API_URL: '',       // e.g. 'https://xxxx.supabase.co/functions/v1/lexph-auth'

  // Webhook / subscription verification URL
  WEBHOOK_URL: '',        // e.g. 'https://xxxx.supabase.co/functions/v1/lexph-webhook'
  // ───────────────────────────────────────────────────────────

  USE_BACKEND: false,     // Auto-set to true when URLs above are filled
};

// Auto-detect if backend is configured
LEXPH_CONFIG.USE_BACKEND = !!(
  LEXPH_CONFIG.WORKER_PROXY_URL &&
  LEXPH_CONFIG.AUTH_API_URL
);

// ── Token management ────────────────────────────────────────
const LexPHAuth = {
  getToken() { return localStorage.getItem('lexph_token'); },
  setToken(t) { localStorage.setItem('lexph_token', t); },
  clearToken() { localStorage.removeItem('lexph_token'); },

  getUser() {
    try { return JSON.parse(localStorage.getItem('lexph_user') || 'null'); }
    catch { return null; }
  },
  setUser(u) {
    const safe = { username: u.username, email: u.email, role: u.role, full_name: u.full_name, subscription: u.subscription || null };
    localStorage.setItem('lexph_user', JSON.stringify(safe));
  },
  clearUser() {
    localStorage.removeItem('lexph_user');
    localStorage.removeItem('lexph_token');
  },
  isLoggedIn() { return !!this.getUser(); },
  isPro() {
    const u = this.getUser();
    if (!u) return false;
    if (u.subscription?.status === 'active') return true;
    return false;
  },
};

// ── API helpers ─────────────────────────────────────────────
async function lexphPost(endpoint, body, auth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = LexPHAuth.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${LEXPH_CONFIG.AUTH_API_URL}/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── REGISTER ────────────────────────────────────────────────
async function lexphRegister(username, email, password) {
  if (!LEXPH_CONFIG.USE_BACKEND) {
    // localStorage fallback
    const accounts = JSON.parse(localStorage.getItem('lexph_accounts') || '[]');
    if (accounts.find(a => a.username === username)) return { error: 'Username already taken.' };
    if (accounts.find(a => a.email === email)) return { error: 'Email already registered.' };
    const user = { username, email, password, role: 'user', full_name: username };
    accounts.push(user);
    localStorage.setItem('lexph_accounts', JSON.stringify(accounts));
    LexPHAuth.setUser(user);
    return { success: true, user };
  }

  const data = await lexphPost('register', { username, email, password });
  if (data.success) {
    LexPHAuth.setToken(data.token);
    LexPHAuth.setUser(data.user);
  }
  return data;
}

// ── LOGIN ────────────────────────────────────────────────────
async function lexphLogin(username, password) {
  if (!LEXPH_CONFIG.USE_BACKEND) {
    // localStorage fallback
    const accounts = JSON.parse(localStorage.getItem('lexph_accounts') || '[]');
    let user = accounts.find(u =>
      (u.username === username || u.email === username) && u.password === password
    );
    // Demo accounts
    if (!user) {
      const demo = [
        { username: 'admin', password: 'admin123', role: 'admin', full_name: 'Admin', email: 'admin@lexph.com' },
        { username: 'nizel', password: 'password', role: 'user', full_name: 'Nizel Tumulak', email: 'nizel@lexph.com' },
      ];
      user = demo.find(u => (u.username === username || u.email === username) && u.password === password);
    }
    if (!user) return { error: 'Invalid username or password.' };
    LexPHAuth.setUser(user);
    return { success: true, user };
  }

  const data = await lexphPost('login', { username, password });
  if (data.success) {
    LexPHAuth.setToken(data.token);
    LexPHAuth.setUser(data.user);
  }
  return data;
}

// ── LOGOUT ───────────────────────────────────────────────────
function lexphLogout() {
  LexPHAuth.clearUser();
  window.location.href = 'index.html';
}

// ── SUBMIT SUBSCRIPTION ──────────────────────────────────────
async function lexphSubscribe(subscriptionData) {
  if (!LEXPH_CONFIG.USE_BACKEND) {
    // localStorage fallback
    localStorage.setItem('lexph_subscription', JSON.stringify({
      ...subscriptionData,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    }));
    const user = LexPHAuth.getUser();
    if (user) {
      user.subscription = { status: 'pending', plan: subscriptionData.plan };
      LexPHAuth.setUser(user);
    }
    return { success: true, reference_number: subscriptionData.reference_number };
  }

  const data = await lexphPost('subscribe', subscriptionData, true);
  if (data.success) {
    // Refresh user to pick up pending subscription
    const user = LexPHAuth.getUser();
    if (user) {
      user.subscription = { status: 'pending', plan: subscriptionData.plan };
      LexPHAuth.setUser(user);
    }
  }
  return data;
}

// ── ANTHROPIC PROXY ──────────────────────────────────────────
async function lexphAISearch(messages, system) {
  const url = LEXPH_CONFIG.USE_BACKEND && LEXPH_CONFIG.WORKER_PROXY_URL
    ? LEXPH_CONFIG.WORKER_PROXY_URL
    : 'https://api.anthropic.com/v1/messages';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system,
      messages,
    }),
  });
  return res.json();
}

// Make available globally
window.LexPHAuth = LexPHAuth;
window.lexphRegister = lexphRegister;
window.lexphLogin = lexphLogin;
window.lexphLogout = lexphLogout;
window.lexphSubscribe = lexphSubscribe;
window.lexphAISearch = lexphAISearch;
window.LEXPH_CONFIG = LEXPH_CONFIG;
