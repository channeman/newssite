import { createClient } from "@supabase/supabase-js";

function parseCategories(xml) {
  const companies = new Map();
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const lang =
      block.match(/<dc:language>(.*?)<\/dc:language>/)?.[1] || "";
    if (lang === "fr") continue;

    const contributor =
      block.match(/<dc:contributor>(.*?)<\/dc:contributor>/)?.[1] || "";

    const categories = [];
    const catRegex = /<category[^>]*>([\s\S]*?)<\/category>/g;
    let catMatch;
    while ((catMatch = catRegex.exec(block)) !== null) {
      categories.push(catMatch[1].trim());
    }

    const subjectMatches = block.match(/<dc:subject>(.*?)<\/dc:subject>/g) || [];
    const subjects = subjectMatches.map(s => s.replace(/<\/?dc:subject>/g, "").trim().toLowerCase()).join(" ");

    const keywords = (block.match(/<dc:keyword>(.*?)<\/dc:keyword>/g) || [])
      .map(k => k.replace(/<\/?dc:keyword>/g, "").trim().toLowerCase())
      .join(" ");

    const allText = subjects + " " + keywords;

    for (const cat of categories) {
      const m = cat.match(/^(TSX-V|TSXV|TSX|CNSX|CSE|NEO|Neo)\s*:\s*([A-Z0-9.\-]+)/i);
      if (!m) continue;

      const raw = m[2].toUpperCase();
      const symbol = raw.split(/[\.\-]/)[0];
      const prefix = m[1].toUpperCase().replace(/-/g, "");
      const exchange =
        prefix === "TSXV" ? "TSXV" :
        prefix === "TSX" ? "TSX" :
        prefix === "CNSX" || prefix === "CSE" ? "CSE" :
        prefix === "NEO" ? "NEO" : null;

      if (!exchange || symbol.length < 2 || symbol.length > 5) continue;

      const key = `${symbol}:${exchange}`;
      if (!companies.has(key)) {
        const name = contributor.split(";")[0].trim() || symbol;
        const isMining = allText.includes("mining") ||
          allText.includes("mineral") ||
          allText.includes("gold") ||
          allText.includes("silver") ||
          allText.includes("copper") ||
          allText.includes("lithium") ||
          allText.includes("uranium") ||
          allText.includes("zinc") ||
          allText.includes("nickel") ||
          allText.includes("metals") ||
          allText.includes("ore") ||
          allText.includes("drill") ||
          allText.includes("exploration");

        companies.set(key, {
          symbol,
          exchange,
          name,
          sector: isMining ? "Mining" : "Unknown",
        });
      }
    }
  }

  return companies;
}

export async function GET(request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  let imported = 0;
  let skipped = 0;
  const errors = [];

  const { data: existing } = await supabase
    .from("companies")
    .select("symbol, exchange");
  const existingMap = new Map();
  (existing || []).forEach((c) => {
    existingMap.set(`${c.symbol}:${c.exchange || "TSXV"}`, true);
  });

  const feeds = [
    "https://www.globenewswire.com/rss/feed/subject/25",
    "https://www.globenewswire.com/rss/feed/subject/26",
    "https://www.globenewswire.com/rss/feed/subject/27",
    "https://www.globenewswire.com/rssfeed/country/CA",
    "https://www.globenewswire.com/rssfeed/exchange/tsx-venture",
    "https://www.globenewswire.com/rssfeed/exchange/tsx",
  ];

  const discovered = new Map();

  for (const url of feeds) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/rss+xml, application/xml, text/xml",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<item>")) continue;

      const companies = parseCategories(xml);
      for (const [key, company] of companies) {
        if (!discovered.has(key)) {
          discovered.set(key, company);
        }
      }
    } catch (e) {
      errors.push(`Feed ${url}: ${e.message}`);
    }
  }

  for (const [key, company] of discovered) {
    if (existingMap.has(key)) {
      skipped++;
      continue;
    }

    const { error } = await supabase.from("companies").insert({
      symbol: company.symbol,
      name: company.name,
      exchange: company.exchange,
      sector: company.sector,
    });

    if (error) {
      if (!error.message.includes("duplicate") && !error.message.includes("unique")) {
        errors.push(`${company.symbol}: ${error.message}`);
      }
    } else {
      imported++;
      existingMap.set(key, true);
    }
  }

  return Response.json({
    ok: true,
    imported,
    skipped,
    totalFound: discovered.size,
    errors: errors.length ? errors.slice(0, 20) : undefined,
  });
}
