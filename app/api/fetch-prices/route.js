import { createClient } from "@supabase/supabase-js";

const EXCHANGE_SUFFIX = {
  TSXV: ".V",
  TSX: ".TO",
  CSE: ".CN",
  NASDAQ: "",
  NYSE: "",
  NEO: ".NE",
};

function getYahooSymbol(symbol, exchange) {
  const suffix = EXCHANGE_SUFFIX[exchange] || ".V";
  return `${symbol}${suffix}`;
}

async function fetchChart(yahooSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return null;
  return meta;
}

function parseMcapStr(str) {
  if (!str) return null;
  const m = str.match(/\$?([0-9.]+)\s*([TBMK])/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const mult = { T: 1e12, B: 1e9, M: 1e6, K: 1e3 }[m[2].toUpperCase()];
  return Math.round(num * mult);
}

function mcapSlug(name) {
  return name
    .toLowerCase()
    .replace(/\b(inc|corp|ltd|ltd|resources|mining|minerals|metals|energy|exploration|holdings|group|ventures|corporation|company|limited)\b\.?/gi, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function fetchMcapFromCMC(longName, symbol) {
  const slug = mcapSlug(longName || symbol);
  if (!slug) return null;
  const url = `https://companiesmarketcap.com/${slug}/marketcap/`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/\$([0-9.]+\s*[TBMK])/i);
    return parseMcapStr(match?.[0]);
  } catch {
    return null;
  }
}

async function fetchFromTMX(symbol, exchange) {
  const tmxSymbol = exchange === "NASDAQ" || exchange === "NYSE" ? `${symbol}:US` : symbol;
  try {
    const query = `query Query($symbol: String!) {
      getQuoteBySymbol(symbol: $symbol) {
        MarketCap shareOutStanding totalSharesOutStanding
        price totalDebtToEquity returnOnAssets priceToBook
      }
    }`;
    const params = new URLSearchParams({
      operationName: "Query",
      variables: JSON.stringify({ symbol: tmxSymbol }),
      query,
    });
    const url = `https://app-money.tmx.com/graphql?${params}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const q = data.data?.getQuoteBySymbol;
    if (!q) return null;
    return {
      marketCap: q.MarketCap || null,
      sharesOutstanding: q.shareOutStanding || q.totalSharesOutStanding || null,
    };
  } catch {
    return null;
  }
}

async function fetchCashFromSA(symbol, companyName) {
  try {
    const url = `https://stockanalysis.com/stocks/${symbol.toLowerCase()}/financials/balance-sheet/`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const titleMatch = html.match(/<title>([^<]+)/);
    if (!titleMatch || titleMatch[1].toLowerCase().includes("404")) return null;
    if (companyName) {
      const saName = titleMatch[1].split("(")[0].trim().toLowerCase();
      const dbName = companyName.toLowerCase().split(/[\s(]/)[0];
      if (!saName.includes(dbName) && dbName.length > 2) return null;
    }
    const cashMatch = html.match(/cash:\[([^\]]+)\]/);
    if (!cashMatch) return null;
    const values = cashMatch[1].split(",").map(Number);
    return values[0] || null;
  } catch {
    return null;
  }
}

async function fetchFromFMP(symbol, exchange) {
  const fmpKey = process.env.FMP_API_KEY;
  if (!fmpKey) return null;

  // FMP uses different symbol formats
  const fmpSymbol = exchange === "TSXV" ? `${symbol}.V` :
                   exchange === "TSX" ? `${symbol}.TO` :
                   symbol; // NASDAQ/NYSE use plain symbol

  let profileData = null;
  let balanceData = null;

  try {
    // Get profile data (market cap, shares outstanding)
    const profileUrl = `https://financialmodelingprep.com/stable/profile?symbol=${fmpSymbol}&apikey=${fmpKey}`;
    const profileRes = await fetch(profileUrl, { signal: AbortSignal.timeout(8000) });
    if (!profileRes.ok) return null;

    const profileJson = await profileRes.json();
    if (!Array.isArray(profileJson) || profileJson.length === 0) return null;

    profileData = profileJson[0];

    // Balance sheet requires premium, so we'll skip cash position for now
    return {
      marketCap: profileData.marketCap ? Math.round(profileData.marketCap) : null,
      cashPosition: null, // Premium feature
      sharesOutstanding: profileData.sharesOutstanding ? Math.round(profileData.sharesOutstanding) : null,
    };
  } catch {
    return null;
  }
}

async function fetchFromAlphaVantage(symbol, exchange) {
  const avKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!avKey) return null;

  const avSymbol = exchange === "TSXV" ? `${symbol}.TRV` :
                   exchange === "TSX" ? `${symbol}.TRT` :
                   symbol;

  try {
    const overviewUrl = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${avSymbol}&apikey=${avKey}`;
    const overviewRes = await fetch(overviewUrl, { signal: AbortSignal.timeout(8000) });
    if (!overviewRes.ok) return null;
    const overview = await overviewRes.json();
    if (!overview || overview.Note || overview["Error Message"]) return null;

    let cashPosition = overview.TotalCash ? parseInt(overview.TotalCash) : null;

    if (!cashPosition) {
      const bsUrl = `https://www.alphavantage.co/query?function=BALANCE_SHEET&symbol=${avSymbol}&apikey=${avKey}`;
      const bsRes = await fetch(bsUrl, { signal: AbortSignal.timeout(8000) });
      if (bsRes.ok) {
        const bsData = await bsRes.json();
        const latest = bsData.quarterlyReports?.[0] || bsData.annualReports?.[0];
        if (latest) cashPosition = parseInt(latest.cashAndShortTermInvestments || latest.cash) || null;
      }
    }

    return {
      marketCap: overview.MarketCapitalization ? parseInt(overview.MarketCapitalization) : null,
      cashPosition,
      sharesOutstanding: overview.SharesOutstanding ? parseInt(overview.SharesOutstanding) : null,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ error: "Missing config" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: companies } = await supabase
    .from("companies")
    .select("id, symbol, exchange, long_name, name, market_cap, cash_position, shares_outstanding");

  if (!companies || companies.length === 0) {
    return Response.json({ ok: true, updated: 0 });
  }

  const chunks = [];
  for (let i = 0; i < companies.length; i += 5) {
    chunks.push(companies.slice(i, i + 5));
  }

  let updated = 0;
  const exchangeFixed = [];

  for (const chunk of chunks) {
    const results = [];

    for (const company of chunk) {
      const exchange = company.exchange || "TSXV";
      const yahooSymbol = getYahooSymbol(company.symbol, exchange);

      let meta = null;
      let foundExchange = exchange;

      try {
        meta = await fetchChart(yahooSymbol);
      } catch {}

      if (!meta && exchange !== "NASDAQ") {
        for (const tryExchange of ["NASDAQ", "NYSE", "TSX", "CSE"]) {
          if (tryExchange === exchange) continue;
          try {
            const trySym = getYahooSymbol(company.symbol, tryExchange);
            meta = await fetchChart(trySym);
            if (meta) {
              foundExchange = tryExchange;
              break;
            }
          } catch {}
        }
      }

      if (meta) {
        results.push({
          company,
          price: meta.regularMarketPrice,
          prevClose: meta.chartPreviousClose || meta.previousClose,
          sharesOutstanding: meta.sharesOutstanding || null,
          marketCap: meta.marketCap || null,
          meta52High: meta.fiftyTwoWeekHigh || null,
          meta52Low: meta.fiftyTwoWeekLow || null,
          dayHigh: meta.regularMarketDayHigh || null,
          dayLow: meta.regularMarketDayLow || null,
          volume: meta.regularMarketVolume || null,
          longName: meta.longName || null,
          foundExchange,
          originalExchange: exchange,
        });
      }
    }

    for (const r of results) {
      if (!r.price) continue;
      const change = r.prevClose ? ((r.price - r.prevClose) / r.prevClose) * 100 : null;

      const updates = {
        price: r.price,
        price_change_pct: change ? Math.round(change * 100) / 100 : null,
        shares_outstanding: r.sharesOutstanding,
        market_cap: r.marketCap || (r.sharesOutstanding ? Math.round(r.sharesOutstanding * r.price) : null),
        week_52_high: r.meta52High || null,
        week_52_low: r.meta52Low || null,
        day_high: r.dayHigh || null,
        day_low: r.dayLow || null,
        volume: r.volume || null,
        long_name: r.longName || null,
        price_updated_at: new Date().toISOString(),
      };

      if (r.foundExchange !== r.originalExchange) {
        updates.exchange = r.foundExchange;
        exchangeFixed.push(`${r.company.symbol}: ${r.originalExchange} → ${r.foundExchange}`);
      }

      await supabase
        .from("companies")
        .update(updates)
        .eq("id", r.company.id);
      updated++;
    }

    if (chunks.indexOf(chunk) < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const missingData = companies.filter((c) => c.market_cap == null || c.cash_position == null || c.shares_outstanding == null);
  let dataUpdated = 0;
  for (const company of missingData) {
    let updates = {};

    // Try FMP first
    const fmpData = await fetchFromFMP(company.symbol, company.exchange);
    if (fmpData) {
      if (fmpData.marketCap && !company.market_cap) updates.market_cap = fmpData.marketCap;
      if (fmpData.cashPosition && !company.cash_position) updates.cash_position = fmpData.cashPosition;
      if (fmpData.sharesOutstanding && !company.shares_outstanding) updates.shares_outstanding = fmpData.sharesOutstanding;
    }

    // Try Alpha Vantage if FMP didn't get everything
    if (!updates.market_cap || !updates.cash_position || !updates.shares_outstanding) {
      const avData = await fetchFromAlphaVantage(company.symbol, company.exchange);
      if (avData) {
        if (avData.marketCap && !updates.market_cap && !company.market_cap) updates.market_cap = avData.marketCap;
        if (avData.cashPosition && !updates.cash_position && !company.cash_position) updates.cash_position = avData.cashPosition;
        if (avData.sharesOutstanding && !updates.shares_outstanding && !company.shares_outstanding) updates.shares_outstanding = avData.sharesOutstanding;
      }
    }

    // Fallback to CMC for market cap
    if (!updates.market_cap && company.long_name) {
      const mcap = await fetchMcapFromCMC(company.long_name, company.symbol);
      if (mcap) updates.market_cap = mcap;
    }

    // Try TMX GraphQL for market cap/shares (works for all Canadian + US stocks)
    if (!updates.market_cap && !company.market_cap) {
      const tmxData = await fetchFromTMX(company.symbol, company.exchange);
      if (tmxData) {
        if (tmxData.marketCap) updates.market_cap = tmxData.marketCap;
        if (tmxData.sharesOutstanding && !company.shares_outstanding) updates.shares_outstanding = tmxData.sharesOutstanding;
      }
    }

    // Try StockAnalysis for cash position (US-listed stocks only)
    if (!updates.cash_position && !company.cash_position && (company.exchange === "NASDAQ" || company.exchange === "NYSE")) {
      const cash = await fetchCashFromSA(company.symbol, company.long_name || company.name);
      if (cash) updates.cash_position = cash;
    }

    if (Object.keys(updates).length > 0) {
      await supabase
        .from("companies")
        .update(updates)
        .eq("id", company.id);
      dataUpdated++;
    }

    // Rate limiting - AV is 25/day, FMP is 250/day, so we can be more aggressive
    await new Promise((r) => setTimeout(r, 200));
  }

  return Response.json({
    ok: true,
    updated,
    dataUpdated,
    exchangeFixed: exchangeFixed.length ? exchangeFixed : undefined,
  });
}
