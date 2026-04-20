# Inventory Hub — Vetcove HD

Internal procurement operations dashboard for the Home Delivery team. Built with Next.js 14, hosted on Vercel.

## Tools

### PO Tools (per warehouse)
- **Brooklyn, Ohio, Hayward, Miami, GoGoMeds KY, GoGoMeds AZ**
- Fetches open PO data from Acumatica, flags short-dating and sell-off items
- Shipping tab with vendor totals, shipping rule evaluation, done tracking
- Email tab creates Gmail drafts with XLSX attachments per vendor
- Item dismissal tracker for flagged items

### Hills Tools
- **Hills & Pawtree Tracker** — Tracks open Hills/Pawtree POs from Acumatica with ETA and notes (shared via KV)
- **Truckloader** — Builds weekly replenishment orders from Acumatica GI data, optimizes truck assignments by weight (42,500 lb target), fill suggestions from Netstock DOH data, email draft creation for Hill's and Central Pet

### OOS Tracker
- Upload CSV from Hex (separate tabs for FuzeRx and GoGoMeds)
- Tracks short-dating (auto-checked from Short-Dating Tracker), backorder, and notes per manufacturer number
- Old/New OOS column compares against previous day's data
- Notes persist across daily resets by manufacturer number
- Shared via KV, auto-resets daily at 5am EST (weekdays only)

### Tracking
- **Fuze Tracker** — Reads from Google Sheets, per-warehouse tabs, auto-refreshes daily at 5am EST

### Inventory Tools
- **Short-Dating Tracker** — Fetches from Acumatica GI, shared via KV, auto-refreshes daily
- **Backorder Tracker** — Same architecture as Short-Dating

### Generic PO Tools
- **PO NDC Validator** — Upload vendor PO PDFs, validates NDCs against Acumatica cross-references
- **Cycle Counting** — Inventory cycle count tool

### Settings
- **Shipping Rules** — Configurable free shipping thresholds per vendor
- **How-To Guide** — Interactive walkthrough of all tools

## Architecture

```
Browser (React SPA)
  ├── Acumatica data  →  /api/acumatica  →  Acumatica OData
  ├── PO PDF parsing   →  /api/po-import  →  unpdf (server-side)
  ├── Gmail drafts     →  /api/gmail-drafts  →  Gmail API
  ├── XLSX parsing     →  /api/parse-xlsx  →  SheetJS (server-side)
  ├── Fuze Tracker     →  /api/sheets  →  Google Sheets API
  └── Shared state     →  /api/kv  →  Upstash Redis
```

## Shared State (KV)

Team data is shared via Upstash Redis so everyone sees the same info:

| Key | Purpose |
|-----|---------|
| `wh-data-{wh}` | PO tool data per warehouse |
| `ship-notes-{wh}` | Shipping notes per warehouse |
| `hills-master` | Hills Master spreadsheet |
| `hills-pawtree-meta` | Hills & Pawtree ETA/notes |
| `tracker-shared-short-dating` | Short-dating tracker data |
| `tracker-shared-backorder` | Backorder tracker data |
| `fuze-tracker-{wh}` | Fuze tracker data per warehouse |
| `oos-data-shared` | OOS CSV data (daily reset) |
| `oos-notes-shared` | OOS SD/BO checkboxes (daily reset) |
| `oos-persistent-notes` | OOS text notes (carry forward) |
| `oos-previous-notes` | OOS yesterday's text notes |
| `oos-previous-items` | OOS yesterday's items (for Old/New) |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `KV_REST_API_URL` | Upstash Redis URL |
| `KV_REST_API_TOKEN` | Upstash Redis token |
| `NEXT_PUBLIC_KV_SECRET` | Client-side auth for KV API |
| `GOOGLE_CLIENT_ID` | Google OAuth (Gmail + Sheets) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret |
| `GOOGLE_REFRESH_TOKEN` | Gmail API refresh token |
| `GOOGLE_SHEETS_API_KEY` | Google Sheets API key |

## Auth

- No standalone user auth — protected behind Acumatica login
- Users enter Acumatica credentials in-browser, stored in localStorage
- Credentials are proxied through API routes to Acumatica OData (never persisted server-side)

## File Structure

```
app/
├── page.js              ← Entire UI (~3800 lines)
├── layout.js            ← HTML shell, metadata, fonts
├── favicon.ico          ← Vetcove cube icon
├── api/
│   ├── acumatica/route.js   ← Acumatica OData proxy
│   ├── kv/route.js          ← Upstash Redis proxy
│   ├── po-import/route.js   ← PDF parsing for PO validation
│   ├── parse-xlsx/route.js  ← XLSX parsing
│   ├── sheets/route.js      ← Google Sheets reader
│   ├── gmail-drafts/route.js
│   ├── gmail-auth/route.js
│   └── gmail-callback/route.js
```
