# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # start dev server (localhost:3000)
npm run build    # production build
npm run start    # run production build
```

No test suite exists. There is no linter configured.

## Environment Variables

Copy `.env.example` and fill in:

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (used client-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended | Bypasses RLS for API routes; falls back to anon key |
| `GEMINI_API_KEY` | Yes | AI article analysis and profile generation |
| `FMP_API_KEY` | Optional | Financial Modeling Prep for market data |
| `ALPHA_VANTAGE_API_KEY` | Optional | Fallback for market data |
| `CRON_SECRET` | Required for crons | Any random string; Vercel sends it as `Authorization: Bearer` on scheduled jobs to distinguish them from manual calls |

## Architecture

This is a mining/junior stock news aggregator focused on Canadian exchanges (TSXV, TSX, CSE, NEO) and US exchanges (NASDAQ, NYSE).

**Stack:** Next.js 16 App Router · React 19 · Supabase (PostgreSQL) · Gemini AI · Yahoo Finance

### Database schema

Three tables (see `supabase/migrations/` for full evolution):
- `companies` — symbol, name, exchange, sector, commodity, region, price fields, market_cap, shares_outstanding, cash_position, description, long_name
- `articles` — company_id FK, title, url, source, published_at, summary, ai_summary, importance (1–5), impact (enum), deep_analysis
- `watched_companies` — company_id FK (watchlist)

Migrations are plain SQL files; apply them manually via the Supabase dashboard or CLI.

### Data flow

**News ingestion** (`/api/fetch-news`): Fetches GlobeNewswire Canada RSS + Yahoo Finance RSS per watched company. Deduplicates by URL and title. Extracts ticker symbols from RSS categories → article text → URL patterns → company name matching. Auto-creates companies from unrecognized tickers. Filters out French-language articles and items older than 72h.

**AI analysis** (`/api/analyze-articles`): Batches up to 5 unanalyzed articles at a time, sends headlines to Gemini (`gemini-3.1-flash-lite-preview`), gets back importance score, impact, summary, commodity, and region. Stores results and back-fills company commodity/region if missing.

**Price updates** (`/api/fetch-prices`): Hits Yahoo Finance chart API per company. Falls back through exchanges (tries NASDAQ, NYSE, TSX, CSE) when the stored exchange returns no data and auto-corrects the exchange field. Supplements missing market cap / shares outstanding / cash position via FMP → Alpha Vantage → companiesmarketcap.com → TMX GraphQL.

**Deep analysis** (`/api/deep-analyze`): POST with `articleId`, returns extended analysis stored in `articles.deep_analysis`.

**Profile generation** (`/api/generate-profile`): POST with `companyId`, uses recent article titles + Gemini to write a description and fill commodity/region/cash_position.

**TSXV import** (`/api/import-tsxv`): Bulk-imports TSXV listings (details in route file).

### Pages

All pages are `"use client"` components that query Supabase directly via `lib/supabaseClient.js` (anon key):

- `/` (`app/page.js`) — news feed with article cards, company/watchlist filter, action buttons (Fetch, $, AI, Import TSXV)
- `/watchlist` — manage watched companies; create new or search existing
- `/company/[symbol]` — company profile: price stats, description, peers (by commodity), article list
- `/search` — search articles and companies

### Yahoo Finance symbol mapping

Exchange suffixes: TSXV → `.V`, TSX → `.TO`, CSE → `.CN`, NEO → `.NE`, NASDAQ/NYSE → no suffix.
