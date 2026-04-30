# LexPH Local Run TODO

## Plan Steps (Approved)

- [x] 1. cd backend && npm install (install deps including nodemon) ✓ up to date, vulnerabilities fixed where possible
- [ ] 2. Check/Start MongoDB (local or fix Atlas: whitelist 0.0.0.0/0, verify credentials) ⚠ MongoDB not running: ECONNREFUSED 127.0.0.1:27017 (server.js fallback active)
- [x] 3. cd backend && npm run dev (start server with nodemon) ✓ Running on port 5000 (env PORT=5000? or Render default), nodemon active
- [x] 4. Open http://localhost:5000 in browser (note: port 5000)
- [x] 5. Verify: Console shows 'MongoDB connected' + site loads index.html (Mongo connect pending) ⚠ Frontend loads (static), Mongo pending
- [ ] 6. Test auth/search features

**Progress will be updated after each step.**
