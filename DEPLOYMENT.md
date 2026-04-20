# LexPH — Full Deployment Guide
## From localhost to live production

---

## What you're deploying

| Component | Service | Cost |
|---|---|---|
| Frontend (HTML/CSS/JS) | Netlify | Free |
| Anthropic API Proxy | Cloudflare Workers | Free (100k req/day) |
| Database + Auth API | Supabase | Free (500MB) |
| Payment Webhooks | Supabase Edge Functions | Free |
| File Storage (receipts) | Supabase Storage | Free (1GB) |

**Total monthly cost: ₱0** until you scale past free tier limits.

---

## STEP 1 — Deploy the Database (Supabase)

1. Go to **https://supabase.com** → Sign up → New Project
   - Name: `lexph`
   - Password: (save this — it's your DB password)
   - Region: Southeast Asia (Singapore)

2. Once created, go to **SQL Editor** → paste the entire contents
   of `backend/db/schema.sql` → click **Run**

3. Go to **Project Settings → API** and copy:
   - `Project URL` → looks like `https://xxxxxxxxxxxx.supabase.co`
   - `anon public` key
   - `service_role` key (keep this SECRET — server-side only)

4. Go to **Project Settings → Edge Functions → Secrets** and add:
   ```
   SUPABASE_URL           = https://xxxxxxxxxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY = eyJhbGci...  (service_role key)
   JWT_SECRET             = (generate a random 32-char string)
   ADMIN_WEBHOOK_KEY      = (generate another random 32-char string)
   GCASH_WEBHOOK_SECRET   = (get from GCash Business dashboard)
   MAYA_WEBHOOK_SECRET    = (get from Maya Business dashboard)
   ```

5. Install Supabase CLI and deploy the Edge Functions:
   ```bash
   npm install -g supabase
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy lexph-auth   --no-verify-jwt
   supabase functions deploy lexph-webhook --no-verify-jwt
   ```

   Your function URLs will be:
   ```
   https://xxxxxxxxxxxx.supabase.co/functions/v1/lexph-auth
   https://xxxxxxxxxxxx.supabase.co/functions/v1/lexph-webhook
   ```

---

## STEP 2 — Deploy the API Proxy (Cloudflare Workers)

1. Go to **https://workers.cloudflare.com** → Sign up (free)

2. Click **Create Worker** → paste the entire contents
   of `backend/workers/lexph-api-proxy.js`

3. Click **Settings → Variables** and add:
   ```
   ANTHROPIC_API_KEY = sk-ant-xxxxxxxxxxxx   (type: Secret)
   ALLOWED_ORIGIN    = https://yourdomain.com (type: Plain text)
   ```
   *(Leave ALLOWED_ORIGIN blank for now if you don't have a domain yet)*

4. Click **Deploy** → copy your Worker URL:
   ```
   https://lexph-proxy.yourname.workers.dev
   ```

---

## STEP 3 — Configure lexph-client.js

Open `lexph-client.js` and fill in the URLs you got from Steps 1 & 2:

```javascript
const LEXPH_CONFIG = {
  WORKER_PROXY_URL: 'https://lexph-proxy.yourname.workers.dev',
  AUTH_API_URL:     'https://xxxxxxxxxxxx.supabase.co/functions/v1/lexph-auth',
  WEBHOOK_URL:      'https://xxxxxxxxxxxx.supabase.co/functions/v1/lexph-webhook',
};
```

`USE_BACKEND` will automatically switch to `true` and all pages
will use the real backend instead of localStorage.

---

## STEP 4 — Add lexph-client.js to every HTML page

Add this line to the `<head>` of every HTML file, **before** any other scripts:

```html
<script src="lexph-client.js"></script>
```

Files to update:
- `index.html`
- `login-modal.html`
- `register-modal.html`
- `subscribe.html`

---

## STEP 5 — Update login-modal.html to use lexphLogin()

Replace the `handleLogin` function body with:

```javascript
async function handleLogin(event) {
  event.preventDefault();
  const btn = document.getElementById('loginBtn');
  btn.textContent = 'Signing in...'; btn.disabled = true;

  const result = await lexphLogin(
    document.getElementById('username').value.trim(),
    document.getElementById('password').value
  );

  if (result.success) {
    document.getElementById('loginForm')
      .insertAdjacentHTML('beforebegin',
        '<div class="success">Login successful!</div>');
    setTimeout(() => window.location.href = 'index.html', 1000);
  } else {
    const existing = document.querySelector('.error');
    if (existing) existing.remove();
    document.getElementById('loginForm')
      .insertAdjacentHTML('beforebegin',
        `<div class="error">${result.error || 'Login failed.'}</div>`);
    btn.textContent = 'Sign In'; btn.disabled = false;
  }
}
```

---

## STEP 6 — Update register-modal.html to use lexphRegister()

Replace the `handleRegister` try block with:

```javascript
const result = await lexphRegister(username, email, password);

if (result.success) {
  document.getElementById('registerForm')
    .insertAdjacentHTML('beforebegin',
      '<div class="success">Account created! 14-day trial activated.</div>');
  setTimeout(() => window.location.href = 'index.html', 1500);
} else {
  showError(result.error || 'Registration failed.');
}
```

---

## STEP 7 — Update subscribe.html to use lexphSubscribe()

In the `submitSubscription()` function, replace the localStorage block with:

```javascript
const result = await lexphSubscribe({
  plan: selectedPlan,
  payment_method: selectedPayment,
  reference_number: ref,
  amount_paid: selectedPlan === 'monthly' ? 199 : selectedPlan === 'annual' ? 1590 : 699,
  payer_first_name: getVal('firstName'),
  payer_last_name: getVal('lastName'),
  payer_email: getVal('emailAddr'),
  payer_mobile: getVal('mobileNum'),
  payer_address: getVal('address'),
  profession: getVal('profession'),
  organization: getVal('organization'),
  notes: getVal('notes'),
  // payment method fields...
});

if (result.success) {
  document.getElementById('refNumber').textContent = result.reference_number;
  document.getElementById('successOverlay').classList.add('show');
} else {
  showError(result.error || 'Submission failed. Please try again.');
}
```

---

## STEP 8 — Deploy the Frontend (Netlify)

1. Go to **https://netlify.com** → Sign up

2. Drag your entire `LexPH` folder onto the Netlify dashboard

3. Your site is live at something like `https://lexph-abc123.netlify.app`

4. To use a custom domain:
   - Buy `lexph.com.ph` at Namecheap (~₱600/year)
   - Netlify → Site Settings → Domain Management → Add custom domain
   - Follow DNS instructions

5. Go back to Cloudflare Worker → Settings → Variables → Update:
   ```
   ALLOWED_ORIGIN = https://lexph.com.ph
   ```

---

## STEP 9 — Register GCash/Maya Webhook URLs

### GCash Business
1. Go to https://business.gcash.com → API Settings
2. Register webhook URL: `https://xxxx.supabase.co/functions/v1/lexph-webhook/gcash`
3. Copy the webhook secret → add to Supabase secrets as `GCASH_WEBHOOK_SECRET`

### Maya Business
1. Go to https://developers.maya.ph → Webhooks
2. Register: `https://xxxx.supabase.co/functions/v1/lexph-webhook/maya`
   - Event: `PAYMENT_SUCCESS`
3. Copy webhook secret → add as `MAYA_WEBHOOK_SECRET`

### Manual Verification (for Bank & Cash Padala)
When you receive a bank deposit or cash padala, manually approve it:

```bash
curl -X POST https://xxxx.supabase.co/functions/v1/lexph-webhook/manual \
  -H "Authorization: Bearer YOUR_ADMIN_WEBHOOK_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reference_number":"LXPH-ABC123-XY12","action":"approve"}'
```

Or view all pending payments:
```bash
curl https://xxxx.supabase.co/functions/v1/lexph-webhook/pending \
  -H "Authorization: Bearer YOUR_ADMIN_WEBHOOK_KEY"
```

---

## STEP 10 — Enable Receipt Upload (Supabase Storage)

1. In Supabase → Storage → New Bucket → name: `payment-proofs` → Private
2. In the subscribe.html file upload handler, add:

```javascript
async function uploadProof(file, referenceNumber) {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.storage
    .from('payment-proofs')
    .upload(`${referenceNumber}/${file.name}`, file);
  return data?.path;
}
```

---

## Security Checklist Before Going Live

- [ ] Anthropic API key is in Cloudflare Worker secrets (NOT in any HTML file)
- [ ] Supabase service_role key is ONLY in Edge Function secrets (never in client JS)
- [ ] JWT_SECRET is a random 32+ character string
- [ ] ADMIN_WEBHOOK_KEY is a random 32+ character string
- [ ] ALLOWED_ORIGIN is set to your exact domain in the Cloudflare Worker
- [ ] Row Level Security is enabled on all Supabase tables (done in schema.sql)
- [ ] SSL is active on your domain (automatic with Netlify)

---

## Support

If you get stuck on any step, the trickiest parts are usually:
- Supabase CLI login (make sure you're on Node.js 18+)
- GCash Business webhook approval (requires business registration)
- DNS propagation (can take up to 24 hours after adding custom domain)
