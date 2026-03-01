# Inventory Hub — Vetcove Tools

A Next.js web application that combines three inventory management tools into one dashboard:

- **PO Tools** — 3 warehouse split (Brooklyn/Ohio/Hayward) with shipping rules engine
- **Short-Dating Tracker** — Expiring inventory management with vendor email automation
- **Backorder Tracker** — Backordered items with recovery ETA tracking and vendor emails

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser (React)                                │
│  ┌───────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ PO Tools  │ │ Short-   │ │ Backorder     │  │
│  │ (3 WH)   │ │ Dating   │ │ Tracker       │  │
│  └─────┬─────┘ └────┬─────┘ └──────┬────────┘  │
│        │             │              │            │
│        └─────────────┼──────────────┘            │
│                      │ fetch()                   │
└──────────────────────┼───────────────────────────┘
                       │
┌──────────────────────┼───────────────────────────┐
│  Vercel Serverless   │                           │
│  ┌───────────────────▼────────────────────────┐  │
│  │ /api/acumatica                             │  │
│  │ Proxies OData calls to Acumatica           │  │
│  │ (handles CORS + auth)                      │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │ /api/gmail-drafts                          │  │
│  │ Creates Gmail drafts via Google API        │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼                         ▼
   Acumatica OData            Gmail API
```

---

## Setup Guide (Step by Step)

### Step 1: Get the code on your machine

```bash
# If you have git:
# Push this folder to a GitHub repo, or just upload it manually

# Install dependencies
cd inventory-hub
npm install
```

### Step 2: Set up environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` with your Acumatica URL. The defaults should work if your instance is `vetcove.acumatica.com`.

### Step 3: Set up Gmail (one-time, ~5 minutes)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Navigate to **APIs & Services → Library**
4. Search for **Gmail API** and click **Enable**
5. Go to **APIs & Services → Credentials**
6. Click **Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Name: `Inventory Hub`
   - Authorized redirect URIs: add `http://localhost:3000/api/gmail-callback`
7. Copy the **Client ID** and **Client Secret** into your `.env.local`

Now run the one-time auth:

```bash
npm run dev
```

Visit `http://localhost:3000/api/gmail-auth` in your browser. Sign in with the Google account that should create the Gmail drafts. After consenting, you'll see a page with your refresh token. Copy it into your `.env.local` as `GOOGLE_REFRESH_TOKEN`.

### Step 4: Test locally

```bash
npm run dev
```

Visit `http://localhost:3000`. Everything should work:
- Login with your Acumatica credentials
- Sync data from any tool
- Generate email drafts

### Step 5: Deploy to Vercel

1. Push your code to GitHub (make sure `.env.local` is in `.gitignore`!)
2. Go to [vercel.com](https://vercel.com) and sign in with GitHub
3. Click **New Project** → import your repo
4. In **Environment Variables**, add all the values from your `.env.local`:
   - `ACUMATICA_BASE_URL`
   - `ACUMATICA_ODATA_PREFIX`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
   - `APP_SECRET`
5. Click **Deploy**

After deploying, update your Google OAuth redirect URI:
- Go back to Google Cloud Console → Credentials
- Edit your OAuth client
- Add `https://your-app.vercel.app/api/gmail-callback` as an authorized redirect URI

### Step 6: Share it

Your app is now live at `https://your-app.vercel.app`. Anyone with Acumatica credentials can log in and use it. Only people with the URL can access it — there's no public listing.

---

## What each file does

```
inventory-hub/
├── package.json              # Dependencies (Next.js, React, googleapis)
├── next.config.js            # Next.js configuration
├── .env.example              # Template for environment variables
│
├── app/
│   ├── layout.js             # HTML shell (font, metadata)
│   ├── page.js               # ← The entire React UI (your hub component)
│   │
│   ├── lib/
│   │   └── api.js            # Frontend helpers (fetch wrappers, localStorage)
│   │
│   └── api/
│       ├── acumatica/
│       │   └── route.js      # Proxies OData calls to Acumatica
│       ├── gmail-drafts/
│       │   └── route.js      # Creates Gmail drafts via Google API
│       ├── gmail-auth/
│       │   └── route.js      # One-time: starts OAuth consent flow
│       └── gmail-callback/
│           └── route.js      # One-time: receives OAuth code, shows refresh token
```

---

## Migrating the React component

The current artifact (`hub-v7-fixed.jsx`) needs these changes to work as `app/page.js`:

### 1. Add `"use client"` at the top
```js
"use client";
import { useState, useMemo, useCallback, useEffect } from "react";
import { fetchAcumatica, createGmailDrafts, saveCredentials, loadCredentials, clearCredentials } from "./lib/api";
```

### 2. Replace storage helpers
```js
// OLD (artifact storage)
async function sGet(k, sh) { ... window.storage ... }
async function sSet(k, v, sh) { ... window.storage ... }

// NEW (localStorage for creds, React state for data)
// Credentials: use loadCredentials() / saveCredentials() from lib/api.js
// Data: just keep in React state — users fetch fresh each session
```

### 3. Replace demo data fetch with real API call

In `TrackerTool.syncData`:
```js
// OLD
setTimeout(async function() {
  var active = demoData.filter(...);
  setData(active);
}, 800);

// NEW
try {
  setLoading(true);
  const rows = await fetchAcumatica({
    type: toolKey,  // "short-dating" or "backorder"
    username: cred.username,
    password: cred.password,
  });
  setData(rows);
  toast(toolLabel + ": Synced " + rows.length + " items");
} catch (err) {
  toast("Error: " + err.message, "error");
} finally {
  setLoading(false);
}
```

In `WHT.fetchData`:
```js
// OLD
setTimeout(async function() {
  var rows = PO_DEMO[whKey].filter(...).map(...);
  setData(rows);
}, 800);

// NEW
try {
  setLoading(true);
  const raw = await fetchAcumatica({
    type: "po",
    warehouse: whKey,
    username: cred.username,
    password: cred.password,
  });
  // Add TotalPrice calculation
  const rows = raw
    .filter(r => r.SKUNDC && !EXCLUDED.some(ex => (r.VendorName || "").toLowerCase().includes(ex)))
    .map(r => ({ ...r, Price: Number(r.Price) || 0, OrderQty: Number(r.OrderQty) || 0, TotalPrice: +((Number(r.Price) || 0) * (Number(r.OrderQty) || 0)).toFixed(2) }));
  setData(rows);
  toast(cfg.label + ": Fetched " + rows.length + " lines");
} catch (err) {
  toast("Error: " + err.message, "error");
} finally {
  setLoading(false);
}
```

### 4. Replace Gmail draft simulation with real API call

In `TrackerTool.genDrafts`:
```js
// OLD
setDrafts(count);

// NEW
const draftPayloads = emailVendors.map(([vendor, items]) => ({
  to: CONTACTS[vendor] || "",
  cc: "hd-purchaseorders@vetcove.com",
  subject: emailConfig.subjectPrefix + new Date().toLocaleDateString("en-US"),
  htmlBody: emailConfig.buildHtml(items),
})).filter(d => d.to);

const result = await createGmailDrafts(draftPayloads);
setDrafts(result.created);
toast(toolLabel + ": " + result.created + " drafts created in Gmail");
```

### 5. Pass credentials through to child components

Since `localStorage` replaces `window.storage`, update the Hub's `useEffect`:
```js
useEffect(function() {
  const saved = loadCredentials();
  if (saved) { setCred(saved); setOk(true); }
  setCredLoading(false);
}, []);
```

And the login function:
```js
var login = useCallback(function() {
  if (cred.username && cred.password) {
    saveCredentials(cred.username, cred.password);
    setOk(true); setShowLogin(false); showToast("Credentials saved");
  }
}, [cred, showToast]);
```

---

## OData endpoint names

If your Acumatica views are named differently, update `ENDPOINTS` in `/api/acumatica/route.js`:

```js
const ENDPOINTS = {
  "po":           "INV%20-%20Suggested%20PO%20Review",     // ← your PO view
  "short-dating": "INV%20-%20Short-Dating%20Tracker",      // ← your short-dating view
  "backorder":    "INV%20-%20Backorder%20Item%20Review",    // ← your backorder view
};
```

---

## Security notes

- **Acumatica credentials** are stored in the user's browser (localStorage) and sent to your Vercel serverless function over HTTPS. They're never stored on the server.
- **Gmail refresh token** is stored in Vercel's environment variables (encrypted at rest). Only your serverless functions can access it.
- **No database needed** — this is a stateless app. Each user fetches fresh data from Acumatica when they click Sync.
- For extra security, you can add [Vercel Password Protection](https://vercel.com/docs/security/deployment-protection) (Vercel Pro plan) to restrict access.

---

## Costs

- **Vercel free tier**: Covers most use cases (100GB bandwidth, serverless function invocations)
- **Google Cloud**: Gmail API is free for personal use
- **Acumatica**: Uses your existing OData license
