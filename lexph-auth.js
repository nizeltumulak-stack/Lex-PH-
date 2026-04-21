/**
 * LexPH — Cloudflare Worker: Auth + Subscription API
 * ─────────────────────────────────────────────────────────────
 * ENVIRONMENT VARIABLES:
 *   MONGODB_URI   → your MongoDB Atlas connection string
 *   JWT_SECRET    → any long random string
 *   ADMIN_KEY     → same as ADMIN_WEBHOOK_KEY in lexph-webhook
 *
 * ENDPOINTS:
 *   POST /register   → { username, email, password }
 *   POST /login      → { username, password }
 *   POST /me         → Header: Authorization: Bearer <token>
 *   POST /subscribe  → Header: Authorization: Bearer <token>
 *   POST /activate   → Header: Authorization: Bearer <ADMIN_KEY>
 *   POST /status     → Header: Authorization: Bearer <token>
 * ─────────────────────────────────────────────────────────────
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.split('/').pop();
    const MONGO = env.MONGODB_URI;
    const JWT_SECRET = env.JWT_SECRET || 'lexph-change-this-secret';
    const ADMIN_KEY = env.ADMIN_KEY || '';

    try {
      let body = {};
      try { body = await request.json(); } catch {}

      // ── REGISTER ──────────────────────────────────────────
      if (path === 'register') {
        const { username, email, password } = body;
        if (!username || !email || !password)
          return json({ error: 'Username, email, and password are required.' }, 400);
        if (password.length < 6)
          return json({ error: 'Password must be at least 6 characters.' }, 400);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return json({ error: 'Invalid email address.' }, 400);

        const existing = await mongoFind(MONGO, 'users', { $or: [{ username }, { email }] });
        if (existing) {
          return json({
            error: existing.username === username ? 'Username already taken.' : 'Email already registered.',
          }, 409);
        }

        const password_hash = await hashPassword(password);
        const userId = crypto.randomUUID();
        const now = new Date().toISOString();
        const user = {
          _id: userId, username, email, password_hash,
          full_name: username, role: 'user',
          subscription_status: 'free', created_at: now,
        };
        await mongoInsert(MONGO, 'users', user);
        const token = await makeJWT({ id: userId, username, role: 'user', isPro: false }, JWT_SECRET);
        return json({ success: true, token, user: safeUser(user) });
      }

      // ── LOGIN ────────────────────────────────────────────
      if (path === 'login') {
        const { username, password } = body;
        if (!username || !password)
          return json({ error: 'Username and password are required.' }, 400);

        const user = await mongoFind(MONGO, 'users', { $or: [{ username }, { email: username }] });
        if (!user) return json({ error: 'Invalid username or password.' }, 401);

        const match = await verifyPassword(password, user.password_hash);
        if (!match) return json({ error: 'Invalid username or password.' }, 401);

        const now = new Date().toISOString();
        const activeSub = await mongoFind(MONGO, 'subscriptions', {
          user_id: user._id, status: 'active', expires_at: { $gte: now },
        });
        const pendingSub = !activeSub ? await mongoFind(MONGO, 'subscriptions', {
          user_id: user._id, status: 'pending',
        }) : null;

        const isPro = !!activeSub || user.subscription_status === 'pro';
        const token = await makeJWT({ id: user._id, username: user.username, role: user.role, isPro }, JWT_SECRET);

        return json({
          success: true, token,
          user: { ...safeUser(user), isPro, subscription: activeSub || pendingSub || null },
        });
      }

      // ── ME / STATUS ───────────────────────────────────────
      if (path === 'me' || path === 'status') {
        const token = extractToken(request);
        if (!token) return json({ error: 'No token provided.' }, 401);
        const payload = await verifyJWT(token, JWT_SECRET);
        if (!payload) return json({ error: 'Invalid or expired token.' }, 401);

        const user = await mongoFind(MONGO, 'users', { _id: payload.id });
        if (!user) return json({ error: 'User not found.' }, 404);

        const now = new Date().toISOString();
        const activeSub = await mongoFind(MONGO, 'subscriptions', {
          user_id: user._id, status: 'active', expires_at: { $gte: now },
        });
        const pendingSub = !activeSub ? await mongoFind(MONGO, 'subscriptions', {
          user_id: user._id, status: 'pending',
        }) : null;

        const isPro = !!activeSub || user.subscription_status === 'pro';

        return json({
          success: true,
          user: { ...safeUser(user), isPro, subscription: activeSub || pendingSub || null },
        });
      }

      // ── SUBSCRIBE ────────────────────────────────────────
      if (path === 'subscribe') {
        const token = extractToken(request);
        if (!token) return json({ error: 'Login required to subscribe.' }, 401);
        const payload = await verifyJWT(token, JWT_SECRET);
        if (!payload) return json({ error: 'Invalid or expired token.' }, 401);

        const {
          plan, payment_method, reference_number, amount_paid,
          payer_first_name, payer_last_name, payer_email, payer_mobile,
          payer_address, profession, organization, notes,
          account_number, transaction_ref, transaction_date,
          bank_name, sender_name, remittance_center, branch_location, control_number,
        } = body;

        if (!plan || !payment_method || !reference_number)
          return json({ error: 'Plan, payment method, and reference number are required.' }, 400);

        const dupRef = await mongoFind(MONGO, 'subscriptions', { reference_number });
        if (dupRef) return json({ error: 'Reference number already used.' }, 409);

        const amounts = { monthly: 199, annual: 1590, otbt: 699 };
        const expectedAmount = amounts[plan] || 199;
        const subId = crypto.randomUUID();
        const now = new Date().toISOString();

        await mongoInsert(MONGO, 'subscriptions', {
          _id: subId, user_id: payload.id, plan, payment_method,
          reference_number, amount_paid: amount_paid || expectedAmount,
          expected_amount: expectedAmount, status: 'pending',
          payer_first_name, payer_last_name, payer_email, payer_mobile,
          payer_address, profession, organization, notes, created_at: now,
        });

        await mongoInsert(MONGO, 'payment_details', {
          _id: crypto.randomUUID(), subscription_id: subId, method: payment_method,
          account_number, transaction_ref, transaction_date: transaction_date || null,
          amount: amount_paid || expectedAmount, bank_name, sender_name,
          remittance_center, branch_location, control_number, created_at: now,
        });

        return json({ success: true, reference_number, status: 'pending' });
      }

      // ── ACTIVATE (called by webhook after payment approved) ─
      if (path === 'activate') {
        const authHeader = request.headers.get('Authorization') || '';
        if (!ADMIN_KEY || authHeader.replace('Bearer ', '').trim() !== ADMIN_KEY)
          return json({ error: 'Unauthorized' }, 401);

        const { user_id, plan, reference_number } = body;
        if (!user_id || !plan)
          return json({ error: 'user_id and plan are required.' }, 400);

        const now = new Date();
        const expiry = new Date(now);
        if (plan === 'monthly') expiry.setMonth(expiry.getMonth() + 1);
        else if (plan === 'annual') expiry.setFullYear(expiry.getFullYear() + 1);
        else if (plan === 'otbt') expiry.setHours(expiry.getHours() + 72);

        if (reference_number) {
          await mongoUpdateOne(MONGO, 'subscriptions', { reference_number }, {
            status: 'active',
            starts_at: now.toISOString(),
            expires_at: expiry.toISOString(),
            verified_at: now.toISOString(),
          });
        }

        await mongoUpdateOne(MONGO, 'users', { _id: user_id }, {
          subscription_status: 'pro',
          subscription_plan: plan,
          subscription_expires: expiry.toISOString(),
        });

        return json({ success: true, expires_at: expiry.toISOString() });
      }

      return json({ error: 'Not found.' }, 404);

    } catch (err) {
      console.error('LexPH Auth Error:', err);
      return json({ error: 'Internal server error.' }, 500);
    }
  }
};

// ── MongoDB Helpers ───────────────────────────────────────────

function parseMongoURI(uri) {
  const match = uri.match(/mongodb\+srv:\/\/([^:]+):([^@]+)@([^/?]+)[^/]*\/([^?]*)/);
  if (!match) throw new Error('Invalid MongoDB URI');
  const [, , , host, db] = match;
  return { dataSource: host.split('.')[0], database: db || 'lexph' };
}

async function mongoFind(uri, collection, filter) {
  const { dataSource, database } = parseMongoURI(uri);
  const res = await fetch('https://data.mongodb-api.com/app/data-akfpb/endpoint/data/v1/action/findOne', {
    method: 'POST',
    headers: { 'Content-Type': 'application/ejson', 'Accept': 'application/ejson' },
    body: JSON.stringify({ dataSource, database, collection, filter }),
  });
  const data = await res.json();
  return data.document || null;
}

async function mongoFindMany(uri, collection, filter) {
  const { dataSource, database } = parseMongoURI(uri);
  const res = await fetch('https://data.mongodb-api.com/app/data-akfpb/endpoint/data/v1/action/find', {
    method: 'POST',
    headers: { 'Content-Type': 'application/ejson', 'Accept': 'application/ejson' },
    body: JSON.stringify({ dataSource, database, collection, filter }),
  });
  const data = await res.json();
  return data.documents || [];
}

async function mongoInsert(uri, collection, document) {
  const { dataSource, database } = parseMongoURI(uri);
  const res = await fetch('https://data.mongodb-api.com/app/data-akfpb/endpoint/data/v1/action/insertOne', {
    method: 'POST',
    headers: { 'Content-Type': 'application/ejson', 'Accept': 'application/ejson' },
    body: JSON.stringify({ dataSource, database, collection, document }),
  });
  return res.json();
}

async function mongoUpdateOne(uri, collection, filter, update) {
  const { dataSource, database } = parseMongoURI(uri);
  const res = await fetch('https://data.mongodb-api.com/app/data-akfpb/endpoint/data/v1/action/updateOne', {
    method: 'POST',
    headers: { 'Content-Type': 'application/ejson', 'Accept': 'application/ejson' },
    body: JSON.stringify({ dataSource, database, collection, filter, update: { $set: update } }),
  });
  return res.json();
}

// ── Auth Helpers ──────────────────────────────────────────────

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  );
  const newHash = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return newHash === hashHex;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function safeUser(u) {
  const { password_hash, ...safe } = u;
  return safe;
}

function extractToken(req) {
  const auth = req.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

async function makeJWT(user, secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    id: user.id, username: user.username, role: user.role,
    isPro: user.isPro || false,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  }));
  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${data}.${signature}`;
}

async function verifyJWT(token, secret) {
  try {
    const [header, payload, signature] = token.split('.');
    const data = `${header}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;
    const parsed = JSON.parse(atob(payload));
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch { return null; }
}
