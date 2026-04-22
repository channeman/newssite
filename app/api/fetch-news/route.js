import { createClient } from "@supabase/supabase-js";

const JMN_RSS_URL =
  "https://www.juniorminingnetwork.com/index.php?option=com_obrss&task=feed&id=1:press-releases&format=feed&Itemid=688";

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const title =
      block.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] ||
      block.match(/<title>(.*?)<\/title>/)?.[1] ||
      "";

    const link =
      block.match(/<link>(.*?)<\/link>/)?.[1] || "";

    const pubDate =
      block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";

    const descMatch = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/);
    const summary = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").trim().slice(0, 500)
      : "";

    if (title && link) {
      items.push({ title, link, pubDate, summary });
    }
  }

  return items;
}

function extractFromURL(url) {
  const tsxvMatch = url.match(/\/press-releases\/\d+-tsx-venture\/([a-z0-9]+)\//i);
  if (tsxvMatch) {
    return { exchange: "TSXV", symbol: tsxvMatch[1].toUpperCase() };
  }

  const tsxMatch = url.match(/\/press-releases\/\d+-tsx\/([a-z0-9]+)\//i);
  if (tsxMatch) {
    return { exchange: "TSX", symbol: tsxMatch[1].toUpperCase() };
  }

  const cseMatch = url.match(/\/press-releases\/\d+-cse\/([a-z0-9]+)\//i);
  if (cseMatch) {
    return { exchange: "CSE", symbol: cseMatch[1].toUpperCase() };
  }

  const neoMatch = url.match(/\/press-releases\/\d+-neo\/([a-z0-9]+)\//i);
  if (neoMatch) {
    return { exchange: "NEO", symbol: neoMatch[1].toUpperCase() };
  }

  return null;
}

export async function GET(request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let companiesCreated = 0;
  let articlesCreated = 0;
  let skipped = 0;
  const errors = [];

  try {
    const res = await fetch(JMN_RSS_URL, {
      headers: { "User-Agent": "TSXVNewsBot/1.0" },
    });
    const xml = await res.text();
    const items = parseRSS(xml);

    const now = new Date();

  for (const item of items) {
      const info = extractFromURL(item.link);
      if (!info || info.exchange !== "TSXV") {
        skipped++;
        continue;
      }

      let publishedAt = item.pubDate
        ? new Date(item.pubDate)
        : new Date();
      if (publishedAt > now) publishedAt = now;
      const publishedISO = publishedAt.toISOString();

      const { data: existing } = await supabase
        .from("articles")
        .select("id, published_at")
        .eq("url", item.link)
        .single();

      if (existing) {
        if (new Date(existing.published_at) > now) {
          await supabase
            .from("articles")
            .update({ published_at: publishedISO })
            .eq("id", existing.id);
        }
        skipped++;
        continue;
      }

      let companyId;
      const { data: existingCompany } = await supabase
        .from("companies")
        .select("id")
        .eq("symbol", info.symbol)
        .single();

      if (existingCompany) {
        companyId = existingCompany.id;
      } else {
        const { data: newCompany, error: companyErr } = await supabase
          .from("companies")
          .insert({
            symbol: info.symbol,
            name: extractCompanyName(item.title),
            sector: "Mining",
          })
          .select("id")
          .single();

        if (companyErr) {
          errors.push(`Company ${info.symbol}: ${companyErr.message}`);
          continue;
        }
        companyId = newCompany.id;
        companiesCreated++;
      }

      const { error: articleErr } = await supabase.from("articles").insert({
        company_id: companyId,
        title: item.title,
        url: item.link,
        source: "Junior Mining Network",
        published_at: publishedISO,
        summary: item.summary || null,
      });

      if (articleErr) {
        errors.push(`Article: ${articleErr.message}`);
      } else {
        articlesCreated++;
      }
    }
  } catch (e) {
    errors.push(`JMN fetch: ${e.message}`);
  }

  try {
    const { data: watched } = await supabase
      .from("watched_companies")
      .select("company_id, companies(id, symbol, sector)");

    if (watched && watched.length > 0) {
      const nonMining = watched.filter(
        (w) => w.companies?.sector !== "Mining"
      );

      for (const w of nonMining) {
        if (!w.companies) continue;
        const symbol = w.companies.symbol;

        try {
          const yfUrl = `https://finance.yahoo.com/rss/headline?s=${symbol}.V`;
          const yfRes = await fetch(yfUrl, {
            headers: { "User-Agent": "Mozilla/5.0" },
          });
          const yfXml = await yfRes.text();
          const yfItems = parseRSS(yfXml);

          for (const item of yfItems.slice(0, 10)) {
            const { data: existing } = await supabase
              .from("articles")
              .select("id")
              .eq("url", item.link)
              .single();

            if (existing) {
              skipped++;
              continue;
            }

      let publishedAt = item.pubDate
        ? new Date(item.pubDate)
        : new Date();
      if (publishedAt > now) publishedAt = now;

      const { error: articleErr } = await supabase.from("articles").insert({
        company_id: w.companies.id,
        title: item.title,
        url: item.link,
        source: "Yahoo Finance",
        published_at: publishedAt.toISOString(),
        summary: item.summary || null,
      });

            if (articleErr) {
              errors.push(`YF ${symbol}: ${articleErr.message}`);
            } else {
              articlesCreated++;
            }
          }
        } catch {
          errors.push(`YF ${symbol}: fetch failed`);
        }
      }
    }
  } catch (e) {
    errors.push(`YF watchlist: ${e.message}`);
  }

  return Response.json({
    ok: true,
    companiesCreated,
    articlesCreated,
    skipped,
    errors: errors.length ? errors : undefined,
  });
}

function extractCompanyName(title) {
  const words = title.split(/\s+/);
  const stopWords = new Set([
    "announces", "reports", "provides", "update", "updates",
    "and", "the", "for", "in", "of", "at", "to", "from", "with",
    "on", "by", "an", "a", "its", "is", "has", "have", "been",
    "agrees", "signs", "files", "receives", "commences", "completes",
    "drills", "intersects", "results", "appointment", "acquisition",
    "financing", "warrant", "options", "grant", "grants", "private",
    "placement", "closed", "closing", "enters", "option", "agreement",
    "earn", "up", "100%", "appoints", "board", "directors", "director",
    "officer", "ceo", "cfo", "president", "chairman", "retires",
    "named", "joins", "mining", "minerals", "metals", "gold", "silver",
    "copper", "lithium", "uranium", "zinc", "lead", "nickel",
    "corp", "corp.", "inc", "inc.", "ltd", "ltd.", "resources",
    "exploration", "energy", "royalty", "goldcorp", "barrick",
  ]);

  let companyWords = [];
  for (const word of words) {
    if (stopWords.has(word.toLowerCase().replace(/[.,]/g, ""))) break;
    companyWords.push(word);
  }

  return companyWords.length > 0 ? companyWords.join(" ") : title.split(" - ")[0];
}
