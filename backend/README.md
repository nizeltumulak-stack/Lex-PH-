# LexPH Backend - Render Deployment

## Quick Deploy to Render

1. Fork this repo or create new from template
2. Connect GitHub to Render Dashboard
3. New Web Service → Build = `npm install`, Start = `npm start`
4. Add Environment Variables (from .env.example)

## Environment Variables Required

```
MONGODB_URI=your-mongodb-atlas-connection-string
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=app-password
FRONTEND_URL=https://your-frontend-domain.com
```

## Features
- MongoDB with subscription fields
- Stripe checkout + webhooks
- Nodemailer emails (trial notifications)
- JWT ready (add jsonwebtoken)
- Rate limiting ready
- Production CORS/helmet

## Local Dev
```bash
npm install
npm run dev
```

## Render Auto-Deploy
Push to main → automatic deployment with env vars.

**MongoDB Atlas Free Tier**: Create cluster, whitelist 0.0.0.0/0 for Render.
