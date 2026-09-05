# Live Forex site (via Supabase Realtime)

Static site (plain HTML/CSS/JS) showing live forex prices, using Supabase
as the real-time relay between your MT4 terminal and the website. This
avoids needing SSL certificates, domains, or open inbound ports on AWS.

## Files
- `index.html`, `style.css`, `script.js` — the website
- `supabase_setup.sql` — run once in Supabase's SQL Editor to create the table
- `bridge_supabase.py` — runs on your AWS box, pushes MT4 prices into Supabase

## Setup

### 1. Create the Supabase table
In your Supabase project → **SQL Editor** → paste and run `supabase_setup.sql`.

### 2. Get your credentials
Project Settings → API:
- **Project URL**
- **anon public key** (goes in `script.js` — safe for the browser)
- **service_role key** (goes in `bridge_supabase.py` — keep this secret, never in frontend code)

### 3. Configure and run the bridge on your AWS box
```
pip install supabase
```
Edit `bridge_supabase.py`, fill in `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`, then:
```
python bridge_supabase.py
```
Leave this running (same as before) alongside MT4.

### 4. Configure the website
Edit `script.js`, fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

## Deploy to GitHub + Vercel

1. Push `index.html`, `style.css`, `script.js` to a GitHub repo (do **not**
   push `bridge_supabase.py` or your service_role key anywhere public).
   ```
   git init
   git add index.html style.css script.js
   git commit -m "Live forex site"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
2. Go to [vercel.com](https://vercel.com) → **Add New → Project** → select your repo.
3. Framework preset: **Other** (static site, no build step). Deploy.

Every push to `main` auto-redeploys. No SSL setup, no domain, no open
firewall ports required — Supabase handles all of that.

## Keeping the feed alive
`bridge_supabase.py` needs to keep running and MT4 needs to stay logged
in. Consider setting it up as a Windows scheduled task that restarts
automatically if it crashes or the box reboots.

