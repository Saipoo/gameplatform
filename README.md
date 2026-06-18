# 🎮 PlayZone — Multiplayer Game Platform
## Complete Setup & Hosting Guide

---

## 📁 Project Structure
```
gameplatform/
├── server.js        ← Backend (deploy to Render)
├── package.json     ← Backend dependencies
├── .env.example     ← Environment variable template
├── index.html       ← Frontend (deploy to Netlify)
└── README.md        ← This guide
```

---

## 🗄️ STEP 1 — Set Up Neon Database (FREE)

1. Go to **https://console.neon.tech** and create a free account
2. Click **"New Project"** → Give it a name like `playzone`
3. Choose a region close to your users
4. Once created, click **"Connection Details"**
5. Copy the **Connection string** — it looks like:
   ```
   postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```
6. **Save this** — you'll need it in Step 2

> ✅ Tables are created **automatically** when the server starts for the first time!

---

## 🚀 STEP 2 — Deploy Backend to Render (FREE)

### Option A: GitHub + Render (Recommended)
1. Create a GitHub repo (e.g. `playzone-backend`)
2. Push `server.js` and `package.json` to it
3. Go to **https://render.com** → Sign up free
4. Click **"New +"** → **"Web Service"**
5. Connect your GitHub repo
6. Configure the service:
   - **Name:** `playzone-backend`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
7. Click **"Advanced"** → **"Add Environment Variables"**:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | (paste your Neon connection string) |
| `JWT_SECRET` | (any long random string, e.g. `x7k9m2p8q3r5t1y6`) |
| `ALLOWED_ORIGINS` | `https://your-netlify-app.netlify.app` (update after Step 3) |
| `PORT` | `3001` |

8. Click **"Create Web Service"**
9. Wait ~3-5 minutes for deployment
10. Copy your Render URL: `https://playzone-backend.onrender.com`

### Option B: Render CLI
```bash
npm install -g @render/cli
render login
render up
```

---

## 🌐 STEP 3 — Deploy Frontend to Netlify (FREE)

### Before deploying, update `index.html`:
Open `index.html` and find this line near the top of the `<script>` section:
```javascript
const API = (window.API_URL || 'https://your-backend.onrender.com');
```
Replace `https://your-backend.onrender.com` with your actual Render URL from Step 2.

### Deploy to Netlify:
**Drag & Drop Method (easiest):**
1. Go to **https://netlify.com** → Sign up free
2. Click **"Add new site"** → **"Deploy manually"**
3. Drag your `index.html` file into the upload box
4. Done! Netlify gives you a URL like `https://amazing-game-123.netlify.app`

**Or via GitHub:**
1. Push `index.html` to a GitHub repo
2. Connect repo to Netlify
3. Build command: (leave empty)
4. Publish directory: `.` (or root)

### After Netlify deploy:
Go back to Render → Update `ALLOWED_ORIGINS` to your Netlify URL.

---

## ⚙️ STEP 4 — Final Configuration

1. **Update Render env var:**
   - `ALLOWED_ORIGINS` = `https://your-actual-app.netlify.app`
   - Click "Save Changes" → Render auto-redeploys

2. **Test your setup:**
   - Open your Netlify URL
   - Click "Sign Up" and create an account
   - Create a room and share the 6-letter code with a friend
   - Play!

---

## 🎮 GAMES INCLUDED

| Game | Players | Description |
|------|---------|-------------|
| 🃏 UNO | 2-8 | Classic color/number matching card game |
| 💣 Cannon War | 2 | Angle & power-based shooting duel |
| 🧠 Trivia Quiz | 2-8 | Multiple choice general knowledge |
| 🎭 Memory Match | 2-4 | Find matching emoji pairs |
| 🎪 Riddles | 2-6 | Classic brain teasers |
| 📝 Word Jumble | 2-6 | Unscramble jumbled words |
| 🔢 Math Tricks | 2-6 | Mental math challenges |
| 📰 Crossword | 2-4 | Mini 5×5 collaborative crossword |
| 🎯 Truth or Dare | 3-8 | Classic party game |
| 🎨 Draw & Guess | 3-8 | Pictionary-style drawing game |

---

## 👤 HOW TO INVITE FRIENDS

### Method 1 — Room Code
1. Create a room → Share the **6-letter code** (e.g. `ABC123`)
2. Friend goes to **"Rooms"** tab → Enters the code → Joins instantly

### Method 2 — Username Invite  
1. Create a room → In the room lobby, type friend's **username**
2. Click **"Invite"** → Friend gets a notification if they're online
3. Friend clicks **"Accept"** in the notification bell 🔔

### Method 3 — Browse Rooms
- Go to **"Rooms"** tab → See all open rooms → Click **"Join"**

---

## 🛠️ LOCAL DEVELOPMENT

```bash
# 1. Clone/copy files to a folder
# 2. Create .env file from .env.example
cp .env.example .env
# Edit .env with your Neon DATABASE_URL

# 3. Install and run backend
npm install
node server.js
# Server runs on http://localhost:3001

# 4. Open index.html in browser
# Make sure API points to http://localhost:3001
# (Already set as fallback in the code)

# For live reload:
npm install -g nodemon
nodemon server.js
```

---

## 🔧 TROUBLESHOOTING

**"Could not connect to server"**
- Check your Render URL in `index.html`
- Make sure Render service is running (free tier sleeps after 15 min)
- Check `ALLOWED_ORIGINS` includes your Netlify URL

**"CORS Error"**
- Update `ALLOWED_ORIGINS` in Render environment variables
- Include `https://` prefix exactly

**"Database Error"**
- Check Neon database URL is correct in Render env vars
- Make sure SSL is `?sslmode=require` at end of URL

**"Room not found"**
- Codes are case-insensitive but must be exactly 6 chars
- Room expires when all players leave

**Render free tier cold starts (30-60 sec delay on first request)**
- This is normal for free tier
- Upgrade to paid plan ($7/mo) for always-on

---

## 📦 ENV VARIABLES REFERENCE

```env
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
JWT_SECRET=any-long-random-string-here
PORT=3001
ALLOWED_ORIGINS=https://your-app.netlify.app,http://localhost:5500
```

---

## 🆙 UPGRADES / CUSTOMIZATION

**Add more games:** Add to `GAMES` array in `index.html` + add socket handler in `server.js`

**Add more riddles/trivia:** Edit the `RIDDLES`, `TRIVIA`, `MATH_TRICKS` arrays in `server.js`

**Custom domain:** Both Netlify and Render support custom domains on paid plans

**Database:** Neon free tier = 512MB storage, 10 GB transfer/month — plenty for hundreds of users

---

Built with: Node.js · Express · Socket.IO · Neon PostgreSQL · Vanilla JS · CSS