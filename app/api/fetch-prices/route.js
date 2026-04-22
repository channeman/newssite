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

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ error: "Missing config" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: companies } = await supabase
    .from("companies")
    .select("id, symbol, exchange");

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
        market_cap: r.marketCap,
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

  return Response.json({
    ok: true,
    updated,
    exchangeFixed: exchangeFixed.length ? exchangeFixed : undefined,
  });
}
