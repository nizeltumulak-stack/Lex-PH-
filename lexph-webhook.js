/**
 * LexPH — Cloudflare Worker: Payment Webhook Handler
 * ─────────────────────────────────────────────────────────────
 * ENVIRONMENT VARIABLES:
 *   MONGODB_URI           → your MongoDB Atlas connection string
 *   GCASH_WEBHOOK_SECRET  → from GCash Business dashboard
 *   MAYA_WEBHOOK_SECRET   → from Maya Business dashboard
 *   ADMIN_WEBHOOK_KEY     → strong secret for manual verification
 *   AUTH_WORKER_URL       → https://lexph-auth.nizeltumulak.workers.dev
 *   ADMIN_KEY             → same value as ADMIN_KEY in lexph-auth worker
 *
 * ENDPOINTS:
 *   POST /gcash    → GCash payment webhook
 *   POST /maya     → Maya payment webhook
 *   POST /manual   → Admin manual approval
 *   GET  /pending  → List pending subscriptions (admin)
 * ─────────────────────────────────────────────────────────────
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-webhook-signature',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const provider = url.pathname.split('/').pop();
    const MONGO = env.MONGODB_URI;
    const AUTH_URL = env.AUTH_WORKER_URL || 'https://lexph-auth.nizeltumulak.workers.dev';
    const ADMIN_KEY = env.ADMIN_KEY || '';

    const rawBody = await request.text();
    let payload = {};
    try { payload = JSON.parse(rawBody); } catch {}

    // Log all webhook events
    try {
      await mongoInsert(MONGO, 'webhook_events', {
        _id: crypto.randomUUID(),
        provider: provider || 'unknown',
        event_type: payload.event || payload.type || 'unknown',
        reference_number: payload.referenceNumber || payload.reference || payload.ref || null,
        raw_payload: payload,
        processed: false,
        created_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Failed to log webhook:', e); }

    // ── GCASH ──────────────────────────────────────────────
    if (provider === 'gcash') {
      const secret = env.GCASH_WEBHOOK_SECRET || '';
      const signature = request.headers.get('x-gcash-signature') || '';
      if (secret && !await verifyHmacSignature(rawBody, secret, signature))
        return json({ error: 'Invalid GCash signature' }, 401);

      const { event, data } = payload;
      if (event === 'payment.success' || data?.status === 'SUCCESS') {
        const ref = data?.referenceNumber || data?.externalId;
        if (ref) {
          const result = await activateByReference(MONGO, ref, 'gcash', AUTH_URL, ADMIN_KEY);
          return json({ received: true, activated: result.success });
        }
      }
      return json({ received: true, note: 'Event not actionable' });
    }

    // ── MAYA ───────────────────────────────────────────────
    if (provider === 'maya') {
      const secret = env.MAYA_WEBHOOK_SECRET || '';
      const signature = request.headers.get('x-maya-signature') || '';
      if (secret && !await verifyHmacSignature(rawBody, secret, signature))
        return json({ error: 'Invalid Maya signature' }, 401);

      const { status, metadata, id } = payload;
      if (status === 'PAYMENT_SUCCESS' || status === 'COMPLETED') {
        const ref = metadata?.externalReferenceId || id;
        if (ref) {
          const result = await activateByReference(MONGO, ref, 'maya', AUTH_URL, ADMIN_KEY);
          return json({ received: true, activated: result.success });
        }
      }
      return json({ received: true, note: 'Event not actionable' });
    }

    // ── MANUAL ADMIN ───────────────────────────────────────
    if (provider === 'manual') {
      const adminKey = env.ADMIN_WEBHOOK_KEY || '';
      const authHeader = request.headers.get('Authorization') || '';
      const providedKey = authHeader.replace('Bearer ', '').trim();

      if (!adminKey || providedKey !== adminKey)
        return json({ error: 'Unauthorized' }, 401);

      const { reference_number, action, admin_note } = payload;
      if (!reference_number || !action)
        return json({ error: 'reference_number and action are required' }, 400);

      if (action === 'approve') {
        const result = await activateByReference(MONGO, reference_number, 'manual', AUTH_URL, ADMIN_KEY);
        if (!result.success) return json({ error: result.error }, 404);

        await mongoUpdateOne(MONGO, 'webhook_events',
          { reference_number },
          { processed: true, processed_at: new Date().toISOString(), admin_note: admin_note || '' }
        );

        return json({ success: true, message: `Subscription ${reference_number} activated.` });
      }

      if (action === 'reject') {
        const sub = await mongoFind(MONGO, 'subscriptions', { reference_number });
        if (!sub) return json({ error: 'Subscription not found' }, 404);

        await mongoUpdateOne(MONGO, 'subscriptions', { reference_number }, {
          status: 'rejected',
          rejected_at: new Date().toISOString(),
          admin_note: admin_note || '',
        });

        return json({ success: true, message: `Subscription ${reference_number} rejected.` });
      }

      return json({ error: 'action must be approve or reject' }, 400);
    }

    // ── PENDING LIST (admin) ───────────────────────────────
    if (provider === 'pending' && request.method === 'GET') {
      const adminKey = env.ADMIN_WEBHOOK_KEY || '';
      const authHeader = request.headers.get('Authorization') || '';
      if (authHeader.replace('Bearer ', '').trim() !== adminKey)
        return json({ error: 'Unauthorized' }, 401);

      const pending = await mongoFindMany(MONGO, 'subscriptions', { status: 'pending' });
      return json({ success: true, count: pending.length, data: pending });
    }

    return json({ error: 'Unknown webhook endpoint' }, 404);
  }
};

// ── Activation ────────────────────────────────────────────────

async function activateByReference(uri, reference, provider, authUrl, adminKey) {
  const sub = await mongoFind(uri, 'subscriptions', { reference_number: reference });
  if (!sub) return { success: false, error: 'Subscription not found' };
  if (sub.status === 'active') return { success: true }; // idempotent

  const now = new Date();
  const expiry = new Date(now);
  if (sub.plan === 'monthly') expiry.setMonth(expiry.getMonth() + 1);
  else if (sub.plan === 'annual') expiry.setFullYear(expiry.getFullYear() + 1);
  else if (sub.plan === 'otbt') expiry.setHours(expiry.getHours() + 72);

  // Update subscription in MongoDB
  await mongoUpdateOne(uri, 'subscriptions', { reference_number: reference }, {
    status: 'active',
    starts_at: now.toISOString(),
    expires_at: expiry.toISOString(),
    verified_at: now.toISOString(),
    verified_by: provider,
  });

  // Call auth worker /activate to update user role
  try {
    await fetch(`${authUrl}/activate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminKey}`,
      },
      body: JSON.stringify({
        user_id: sub.user_id,
        plan: sub.plan,
        reference_number: reference,
      }),
    });
  } catch (e) {
    console.error('Failed to call auth /activate:', e);
  }

  // Log webhook event as processed
  await mongoUpdateOne(uri, 'webhook_events',
    { reference_number: reference, processed: false },
    { processed: true, processed_at: now.toISOString() }
  );

  console.log(`✓ Activated ${reference} via ${provider} — expires ${expiry.toISOString()}`);
  return { success: true };
}

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

async function verifyHmacSignature(body, secret, signature) {
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return computed === signature;
  } catch { return false; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
