# LexPH — Philippine Law Research Platform

A production-grade legal research web application for Philippine law.

---

## 📁 Project Structure

```
lex-ph/
├── index.html              ← Main frontend (standalone HTML/JS)
├── admin/
│   └── index.php           ← Admin panel (PHP + MySQL)
├── api/
│   ├── search.php          ← Search API endpoint
│   └── cases.php           ← Cases CRUD API endpoint
├── includes/
│   ├── config.php          ← App configuration
│   └── Database.php        ← PDO database singleton
├── modules/
│   └── search/
│       └── SearchEngine.php ← Core search & NLP logic
└── database/
    └── schema.sql          ← Full MySQL schema + seed data
```

---

## ⚙️ Setup Instructions

### Prerequisites
- PHP 8.1+
- MySQL 8.0+
- Web server (Apache/Nginx) or `php -S localhost:8080`

### Step 1: Database Setup
```sql
-- Import the schema
mysql -u root -p < database/schema.sql
```

### Step 2: Configure Database
Edit `includes/config.php`:
```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'lex_ph');
define('DB_USER', 'your_username');
define('DB_PASS', 'your_password');
```

### Step 3: Set Admin Password
```php
// In MySQL:
UPDATE users SET password_hash = ? WHERE username = 'admin';
// Use: password_hash('YourPassword', PASSWORD_BCRYPT, ['cost' => 12])
```

### Step 4: Deploy
```bash
# Development server
cd lex-ph
php -S localhost:8080

# Then open http://localhost:8080/index.html
# Admin: http://localhost:8080/admin/index.php
```

### Step 5: Apache .htaccess (optional)
```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^api/(.*)$ api/$1.php [L]
```

---

## 🔍 Search API

### POST /api/search.php
```json
// Request
{"query": "illegal dismissal due process"}

// Response
{
  "success": true,
  "data": {
    "query": "illegal dismissal due process",
    "keywords": ["illegal", "dismissal", "due", "process"],
    "category": "Labor",
    "issue": "Whether...",
    "laws": [...],
    "cases": [...],
    "doctrines": [...],
    "analysis": "...",
    "total": 5
  }
}
```

### GET /api/cases.php?id=1
### GET /api/cases.php?gr=G.R.+No.+158693
### GET /api/cases.php?category=Labor&page=1
### POST /api/cases.php (admin auth required)
### PUT /api/cases.php?id=1 (admin auth required)
### DELETE /api/cases.php?id=1 (admin auth required)

---

## 🧠 Search Intelligence

The `SearchEngine` class simulates AI behavior through:

1. **Query normalization** — Lowercases, strips noise words
2. **Keyword extraction** — Removes stop words, filters by length
3. **Category detection** — Maps keywords to legal domains (Civil, Criminal, Labor, etc.)
4. **Weighted FULLTEXT search** — MySQL FULLTEXT with BOOLEAN MODE
5. **Fallback LIKE search** — Catches cases not indexed by FULLTEXT
6. **Legal issue reformulation** — Converts natural language query to legal issue format
7. **Structured analysis** — Assembles legal response with provisions, cases, doctrines

---

## 📊 Database Schema Summary

| Table         | Purpose                          | Key Columns                          |
|---------------|----------------------------------|--------------------------------------|
| `laws`        | Codal provisions                 | article_number, content, category    |
| `cases`       | SC jurisprudence                 | gr_number, doctrine, facts, ruling   |
| `doctrines`   | Legal doctrines                  | doctrine_name, description           |
| `search_logs` | Query analytics                  | user_query, keywords, timestamp      |
| `users`       | Authentication                   | username, password_hash, role        |
| `categories`  | Legal field metadata             | name, slug, description              |

All text-heavy columns have FULLTEXT indexes for fast search.

---

## 🔐 Security Features

- ✅ PDO prepared statements (SQL injection prevention)
- ✅ `htmlspecialchars()` / `strip_tags()` (XSS prevention)
- ✅ Session-based rate limiting
- ✅ Role-based access control (admin/editor/user)
- ✅ Soft deletes (no hard database deletions)
- ✅ Input length validation
- ✅ HTTP method enforcement

---

## 🎨 Frontend Features

- ✅ Standalone HTML (works without PHP for demo)
- ✅ Professional law-firm design aesthetic
- ✅ Dark mode toggle (persisted in localStorage)
- ✅ Responsive (mobile + desktop)
- ✅ Structured 6-part legal response format
- ✅ Expandable case cards
- ✅ Case detail modal
- ✅ Browse: Cases, Laws, Doctrines
- ✅ Admin panel (frontend + PHP backend)
- ✅ Loading states and toast notifications
- ✅ Fallback demo mode (no PHP required)

---

## 📌 Important Notes

1. **This platform is for legal research only** — not legal advice
2. **Seed data is for demonstration** — populate with actual Philippine jurisprudence
3. **Production deployment** requires HTTPS, proper auth, and environment variables
4. Never expose `config.php` credentials in version control

---

## 📚 Data Sources for Population

To populate with real data, scrape or input from:
- [Supreme Court E-Library](https://elibrary.judiciary.gov.ph/)
- [Chan Robles Virtual Law Library](https://www.chanrobles.com/)
- [LawPhil Project](https://lawphil.net/)
- Official Gazette of the Philippines

---

*LexPH v1.0 — Built for the Philippine legal research community*
