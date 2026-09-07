# HostelHub — Hostel & Room Rental Marketplace

> "Find and Post Hostels — Get Paid."

## Tech Stack
- **Frontend:** HTML5, CSS3, Vanilla JS (mobile-first, PWA-ready, dark mode)
- **Backend:** Node.js + Express
- **Database:** MySQL

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Copy `.env` and fill in your values:
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=hostels_db
SESSION_SECRET=your_secret
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your@email.com
EMAIL_PASS=your_app_password
BASE_URL=http://localhost:3000
```

### 3. Set up the database
```bash
mysql -u root -p < schema.sql
```

### 4. Run the server
```bash
# Development
npm run dev

# Production
npm start
```

Open http://localhost:3000

## Default Admin Login
- Email: `admin@hostels.com`
- Password: `password` *(change immediately in production)*

## Key Features
- 🔍 Advanced search & filters (location, price, occupancy, amenities)
- 🏠 Multi-step ad posting wizard with contact-info firewall
- 💬 Middleman contact model — owner/seeker never exchange direct contacts
- 🗺️ Map with ±150–300m privacy jitter + distance calculator
- 💰 Automatic 10% commission split (5% owner, 5% platform)
- 🪪 KYC verification before first listing
- 📊 Admin dashboard: moderation, requests, users, payouts, audit logs
- 🌙 Dark/light mode toggle
- 📱 PWA installable

## Project Structure
```
├── server.js              # Express entry point
├── schema.sql             # MySQL database schema
├── src/
│   ├── routes/            # API routes (auth, listings, requests, admin, user, payments)
│   ├── middleware/        # Auth middleware
│   └── utils/             # DB, mailer, contact detector, location jitter
├── public/
│   ├── index.html         # Homepage
│   ├── listings.html      # Search/browse page
│   ├── listing.html       # Listing detail page
│   ├── post-ad.html       # Post ad wizard
│   ├── login.html
│   ├── signup.html
│   ├── dashboard.html     # User/owner dashboard
│   ├── admin.html         # Admin panel
│   ├── about.html         # About/safety/terms
│   ├── css/style.css      # Full design system
│   └── js/                # app.js, home.js, listings.js, listing-detail.js, post-ad.js, dashboard.js, admin.js
└── uploads/               # User-uploaded images (gitignored)
```
