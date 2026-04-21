/**
 * LexPH — Backend Client (lexph-client.js)
 * Drop this into every HTML page: <script src="lexph-client.js"></script>
 */

const LEXPH_CONFIG = {
  WORKER_PROXY_URL: 'https://lexph-api-proxy.nizeltumulak.workers.dev',
  AUTH_API_URL: 'https://lexph-auth.nizeltumulak.workers.dev',
  WEBHOOK_URL: 'https://lexph-webhook.nizeltumulak.workers.dev',
  BACKEND_URL: 'https://lex-ph-backend.onrender.com',
  USE_BACKEND: true,
};

const LexPHAuth = {
  getToken() { return localStorage.getItem('lexph_token'); },
  setToken(t) { localStorage.setItem('lexph_token', t); },
  clearToken() { localStorage.removeItem('lexph_token'); },

  getUser() {
    try { return JSON.parse(localStorage.getItem('lexph_user') || 'null'); }
    catch { return null; }
  },
  setUser(u) {
    const safe = {
      _id: u._id, username: u.username, email: u.email,
      role: u.role, full_name: u.full_name,
      subscription_status: u.subscription_status || 'free',
      subscription_plan: u.subscription_plan || null,
      subscription_expires: u.subscription_expires || null,
      isPro: u.isPro || false,
      subscription: u.subscription || null,
    };
    localStorage.setItem('lexph_user', JSON.stringify(safe));
  },
  clearUser() {
    localStorage.removeItem('lexph_user');
    localStorage.removeItem('lexph_token');
  },
  isLoggedIn() { return !!this.getToken() && !!this.getUser(); },

  async checkProStatus() {
    const token = this.getToken();
    if (!token) return false;
    try {
      const res = await fetch(`${LEXPH_CONFIG.AUTH_API_URL}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success && data.user) {
        this.setUser(data.user);
        return data.user.isPro === true;
      }
    } catch (e) { console.warn('Could not verify pro status:', e); }
    const user = this.getUser();
    return user?.isPro === true || user?.subscription_status === 'pro';
  },

  isPro() {
    const user = this.getUser();
    if (!user) return false;
    if (user.isPro === true) return true;
    if (user.subscription_status === 'pro') return true;
    if (user.subscription?.status === 'active') return true;
    return false;
  },

  isAdmin() {
    const user = this.getUser();
    return user?.role === 'admin';
  },
};

async function lexphPost(endpoint, body, auth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = LexPHAuth.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${LEXPH_CONFIG.AUTH_API_URL}/${endpoint}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  return res.json();
}

async function lexphRegister(username, email, password) {
  if (!LEXPH_CONFIG.USE_BACKEND) {
    const accounts = JSON.parse(localStorage.getItem('lexph_accounts') || '[]');
    if (accounts.find(a => a.username === username)) return { error: 'Username already taken.' };
    if (accounts.find(a => a.email === email)) return { error: 'Email already registered.' };
    const user = { username, email, password, role: 'user', full_name: username, isPro: false };
    accounts.push(user);
    localStorage.setItem('lexph_accounts', JSON.stringify(accounts));
    LexPHAuth.setUser(user);
    return { success: true, user };
  }
  const data = await lexphPost('register', { username, email, password });
  if (data.success) { LexPHAuth.setToken(data.token); LexPHAuth.setUser(data.user); }
  return data;
}

async function lexphLogin(username, password) {
  if (!LEXPH_CONFIG.USE_BACKEND) {
    const accounts = JSON.parse(localStorage.getItem('lexph_accounts') || '[]');
    let user = accounts.find(u =>
      (u.username === username || u.email === username) && u.password === password
    );
    if (!user) {
      const demo = [
        { username: 'admin', password: 'admin123', role: 'admin', full_name: 'Admin', email: 'admin@lexph.com', isPro: true },
        { username: 'nizel', password: 'password', role: 'user', full_name: 'Nizel Tumulak', email: 'nizel@lexph.com', isPro: false },
      ];
      user = demo.find(u => (u.username === username || u.email === username) && u.password === password);
    }
    if (!user) return { error: 'Invalid username or password.' };
    LexPHAuth.setUser(user);
    return { success: true, user };
  }
  const data = await lexphPost('login', { username, password });
  if (data.success) { LexPHAuth.setToken(data.token); LexPHAuth.setUser(data.user); }
  return data;
}

function lexphLogout() {
  LexPHAuth.clearUser();
  window.location.href = 'index.html';
}

async function lexphSubscribe(subscriptionData) {
  if (!LEXPH_CONFIG.USE_BACKEND) {
    localStorage.setItem('lexph_subscription', JSON.stringify({
      ...subscriptionData, status: 'pending', submittedAt: new Date().toISOString(),
    }));
    const user = LexPHAuth.getUser();
    if (user) { user.subscription = { status: 'pending', plan: subscriptionData.plan }; LexPHAuth.setUser(user); }
    return { success: true, reference_number: subscriptionData.reference_number };
  }
  const data = await lexphPost('subscribe', subscriptionData, true);
  if (data.success) {
    const user = LexPHAuth.getUser();
    if (user) { user.subscription = { status: 'pending', plan: subscriptionData.plan }; LexPHAuth.setUser(user); }
  }
  return data;
}

async function lexphAISearch(messages, system) {
  const res = await fetch(LEXPH_CONFIG.WORKER_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-2.0-flash', max_tokens: 4000, system, messages }),
  });
  return res.json();
}

// Auto-check pro status on page load
window.addEventListener('load', async () => {
  if (LexPHAuth.isLoggedIn()) {
    await LexPHAuth.checkProStatus();
    window.dispatchEvent(new CustomEvent('lexph:statusUpdated', {
      detail: { isPro: LexPHAuth.isPro() }
    }));
  }
});

window.LexPHAuth = LexPHAuth;
window.lexphRegister = lexphRegister;
window.lexphLogin = lexphLogin;
window.lexphLogout = lexphLogout;
window.lexphSubscribe = lexphSubscribe;
window.lexphAISearch = lexphAISearch;
window.LEXPH_CONFIG = LEXPH_CONFIG;
