/**
 * LexPH — Cloudflare Worker: Auth + Subscription API
 * ─────────────────────────────────────────────────────────────
 * ENVIRONMENT VARIABLES (set in Cloudflare Worker Settings → Variables):
 *   MONGODB_URI     → your MongoDB Atlas connection string
 *   JWT_SECRET      → any long random string for signing tokens
 *
 * ENDPOINTS (all POST, JSON body):
 *   /register   → { username, email, password }
 *   /login      → { username, password }
 *   /me         → Header: Authorization: Bearer <token>
 *   /subscribe  → Header: Authorization: Bearer <token>, + subscription fields
 * ─────────────────────────────────────────────────────────────
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

        // Check for existing user
        const existing = await mongoFind(MONGO, 'users', {
          $or: [{ username }, { email }]
        });
        if (existing) {
          return json({
            error: existing.username === username
              ? 'Username already taken.'
              : 'Email already registered.',
          }, 409);
        }

        const password_hash = await hashPassword(password);
        const userId = crypto.randomUUID();
        const now = new Date().toISOString();

        const user = {
          _id: userId,
          username,
          email,
          password_hash,
          full_name: username,
          role: 'user',
          created_at: now,
        };

        await mongoInsert(MONGO, 'users', user);

        const token = await makeJWT({ id: userId, username, role: 'user' }, JWT_SECRET);
        return json({ success: true, token, user: safeUser(user) });
      }

      // ── LOGIN ────────────────────────────────────────────
      if (path === 'login') {
        const { username, password } = body;
        if (!username || !password)
          return json({ error: 'Username and password are required.' }, 400);

        const user = await mongoFind(MONGO, 'users', {
          $or: [{ username }, { email: username }]
        });

        if (!user) return json({ error: 'Invalid username or password.' }, 401);

        const match = await verifyPassword(password, user.password_hash);
        if (!match) return json({ error: 'Invalid username or password.' }, 401);

        // Fetch active subscription
        const now = new Date().toISOString();
        const sub = await mongoFind(MONGO, 'subscriptions', {
          user_id: user._id,
          status: 'active',
          expires_at: { $gte: now },
        });

        const token = await makeJWT({ id: user._id, username: user.username, role: user.role }, JWT_SECRET);
        return json({
          success: true,
          token,
          user: { ...safeUser(user), subscription: sub || null },
        });
      }

      // ── ME ───────────────────────────────────────────────
      if (path === 'me') {
        const token = extractToken(request);
        if (!token) return json({ error: 'No token provided.' }, 401);

        const payload = await verifyJWT(token, JWT_SECRET);
        if (!payload) return json({ error: 'Invalid or expired token.' }, 401);

        const user = await mongoFind(MONGO, 'users', { _id: payload.id });
        if (!user) return json({ error: 'User not found.' }, 404);

        const sub = await mongoFind(MONGO, 'subscriptions', {
          user_id: user._id,
          status: { $in: ['active', 'pending'] },
        });

        return json({ success: true, user: { ...safeUser(user), subscription: sub || null } });
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

        // Check duplicate reference number
        const dupRef = await mongoFind(MONGO, 'subscriptions', { reference_number });
        if (dupRef) return json({ error: 'Reference number already used.' }, 409);

        const amounts = { monthly: 199, annual: 1590, otbt: 699 };
        const expectedAmount = amounts[plan] || 199;
        const subId = crypto.randomUUID();
        const now = new Date().toISOString();

        const sub = {
          _id: subId,
          user_id: payload.id,
          plan,
          payment_method,
          reference_number,
          amount_paid: amount_paid || expectedAmount,
          status: 'pending',
          payer_first_name,
          payer_last_name,
          payer_email,
          payer_mobile,
          payer_address,
          profession,
          organization,
          notes,
          created_at: now,
        };

        await mongoInsert(MONGO, 'subscriptions', sub);

        await mongoInsert(MONGO, 'payment_details', {
          _id: crypto.randomUUID(),
          subscription_id: subId,
          method: payment_method,
          account_number,
          transaction_ref,
          transaction_date: transaction_date || null,
          amount: amount_paid || expectedAmount,
          bank_name,
          sender_name,
          remittance_center,
          branch_location,
          control_number,
          created_at: now,
        });

        return json({ success: true, reference_number, status: 'pending' });
      }

      return json({ error: 'Not found.' }, 404);

    } catch (err) {
      console.error('LexPH Auth Error:', err);
      return json({ error: 'Internal server error.' }, 500);
    }
  }
};

// ── MongoDB Data API Helpers ─────────────────────────────────

async function mongoRequest(uri, action, collection, body) {
  // Parse connection string to get cluster info
  const match = uri.match(/mongodb\+srv:\/\/([^:]+):([^@]+)@([^/]+)\/([^?]+)/);
  if (!match) throw new Error('Invalid MongoDB URI');

  const [, username, password, cluster, database] = match;
  const clusterName = cluster.split('.')[0];

  const endpoint = `https://data.mongodb-api.com/app/data-akfpb/endpoint/data/v1/action/${action}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': '', // Will use connection string auth below
    },
    body: JSON.stringify({
      dataSource: clusterName,
      database,
      collection,
      ...body,
    }),
  });

  return res.json();
}

async function mongoFind(uri, collection, filter) {
  // Use MongoDB Atlas Data API
  const match = uri.match(/mongodb\+srv:\/\/([^:]+):([^@]+)@([^/?]+)[^/]*\/([^?]*)/);
  if (!match) throw new Error('Invalid MongoDB URI');
  const [, user, pass, host, db] = match;
  const database = db || 'lexph';
  const dataSource = host.split('.')[0];

  const res = await fetch(`https://data.mongodb-api.com/app/data-akfpb/endpoint/data/v1/action/findOne`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ejson', 'Accept': 'application/ejson' },
    body: JSON.stringify({ dataSource, database, collection, filter }),
  });

  const data = await res.json();
  return data.document || null;
}

async function mongoInsert(uri, collection, document) {
  const match = uri.match(/mongodb\+srv:\/\/([^:]+):([^@]+)@([^/?]+)[^/]*\/([^?]*)/);
  if (!match) throw new Error('Invalid MongoDB URI');
  const [, user, pass, host, db] = match;
  const database = db || 'lexph';
  const dataSource = host.split('.')[0];

  const res = await fetch(`https://data.mongodb-api.com/app/data-akfpb/endpoint/data/v1/action/insertOne`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ejson', 'Accept': 'application/ejson' },
    body: JSON.stringify({ dataSource, database, collection, document }),
  });

  return res.json();
}

// ── Auth Helpers ─────────────────────────────────────────────

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, 256
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
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  const newHash = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return newHash === hashHex;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
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
    id: user.id,
    username: user.username,
    role: user.role,
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
