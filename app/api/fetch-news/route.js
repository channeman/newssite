import { createClient } from "@supabase/supabase-js";

export const maxDuration = 300;

function inEasternWindow() {
  // Returns true if current time is 6:00–8:59 AM America/New_York (handles EDT/EST automatically)
  const eastern = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = eastern.getHours();
  return h >= 6 && h < 9;
}

const PRESS_RELEASE_SOURCES = [
  "business wire", "businesswire",
  "pr newswire", "prnewswire",
  "globe newswire", "globenewswire",
  "accesswire", "access wire",
  "newsfile",
  "marketwired",
  "einpresswire",
  "cision",
  "newswire",
  "canada newswire",
  "cnw group",
  "prlog",
  "accessnewswire",
];

function isPressRelease(source) {
  const s = (source || "").toLowerCase();
  return PRESS_RELEASE_SOURCES.some(d => s.includes(d));
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
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

    const source =
      block.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || "";

    const descMatch = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/);
    const summary = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").trim().slice(0, 1000)
      : "";

    const contributor =
      block.match(/<dc:contributor>(.*?)<\/dc:contributor>/)?.[1] || "";

    const categories = [];
    const catRegex = /<category[^>]*>([\s\S]*?)<\/category>/g;
    let catMatch;
    while ((catMatch = catRegex.exec(block)) !== null) {
      categories.push(catMatch[1].trim());
    }

    if (title && link) {
      items.push({ title, link, pubDate, summary, source, categories, contributor });
    }
  }

  return items;
}

function extractFromCategories(categories) {
  const tickers = [];
  for (const cat of categories) {
    const m = cat.match(/^(TSX-V|TSXV|TSX|CNSX|CSE|NEO|Neo|OTC|NASDAQ|NYSE|Frankfurt)\s*:\s*([A-Z0-9.\-]+)/i);
    if (m) {
      const raw = m[2].toUpperCase();
      const symbol = raw.split(/[\.\-]/)[0];
      const prefix = m[1].toUpperCase().replace(/-/g, "");
      const exchange =
        prefix === "TSXV" ? "TSXV" :
        prefix === "TSX" ? "TSX" :
        prefix === "CNSX" || prefix === "CSE" ? "CSE" :
        prefix === "NEO" ? "NEO" : null;
      if (exchange && symbol.length >= 2 && symbol.length <= 5) {
        tickers.push({ exchange, symbol });
      }
    }
  }
  return tickers;
}

function extractTickerFromText(title, summary) {
  const text = `${title} ${summary || ""}`;
  const patterns = [
    { regex: /\(?\s*(TSX-V|TSXV|TSX\s+Venture|TSX)\s*:\s*([A-Z0-9]{2,5})/gi, normalize: "auto" },
    { regex: /\(?\s*(CSE|CNSX)\s*:\s*([A-Z0-9]{2,5})/gi, normalize: "auto" },
    { regex: /\(?\s*(NEO)\s*:\s*([A-Z0-9]{2,5})/gi, normalize: "auto" },
  ];

  const results = [];
  for (const p of patterns) {
    let m;
    while ((m = p.regex.exec(text)) !== null) {
      const prefix = m[1].toUpperCase().replace(/[\s-]/g, "").replace(/^TSXVENTURE$/, "TSXV").replace(/^TSXV$/, "TSXV");
      const exchange =
        prefix === "TSXV" ? "TSXV" :
        prefix === "TSX" ? "TSX" :
        prefix === "CSE" || prefix === "CNSX" ? "CSE" :
        prefix === "NEO" ? "NEO" : null;
      const symbol = m[2].toUpperCase();
      if (exchange) {
        results.push({ exchange, symbol });
      }
    }
  }
  return results;
}


function extractFromURL(url) {
  const patterns = [
    { regex: /\/press-releases\/\d+-tsx-venture\/([a-z0-9]+)\//i, exchange: "TSXV" },
    { regex: /\/press-releases\/\d+-tsx\/([a-z0-9]+)\//i, exchange: "TSX" },
    { regex: /\/press-releases\/\d+-cse\/([a-z0-9]+)\//i, exchange: "CSE" },
    { regex: /\/press-releases\/\d+-neo\/([a-z0-9]+)\//i, exchange: "NEO" },
  ];

  for (const p of patterns) {
    const m = url.match(p.regex);
    if (m) {
      return { exchange: p.exchange, symbol: m[1].toUpperCase() };
    }
  }

  return null;
}

async function isDuplicate(supabase, url, title) {
  const [{ count: c1 }, { count: c2 }] = await Promise.all([
    supabase.from("articles").select("id", { count: "exact", head: true }).eq("url", url),
    supabase.from("articles").select("id", { count: "exact", head: true }).eq("title", title),
  ]);
  return (c1 ?? 0) > 0 || (c2 ?? 0) > 0;
}

async function fetchWithTimeout(url, timeoutMs = 15000) {
  return fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/rss+xml, application/xml, text/xml",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// SEC EDGAR requires a descriptive User-Agent with contact email or requests get blocked
async function fetchEdgar(url, timeoutMs = 12000) {
  return fetch(url, {
    headers: {
      "User-Agent": "MiningNewsSite/1.0 andreas.baath@gmail.com",
      "Accept": "application/atom+xml, text/html, */*",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function parseEdgarAtom(xml) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").trim();
    const link = block.match(/<link[^>]*href="([^"]+)"/)?.[1] || "";
    const updated = block.match(/<updated>(.*?)<\/updated>/)?.[1] || "";

    // EDGAR encodes the filing document table inside <content> — decode and find EX-99.1
    const rawContent = block.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] || "";
    const content = rawContent
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"');
    const allHrefs = [...content.matchAll(/href="(\/Archives\/edgar\/data\/[^"]+)"/gi)]
      .map(m => m[1]);
    const ex99 = allHrefs.find(h => /ex[_-]?99[_\-.]?1/i.test(h) || /exhibit.?99/i.test(h));

    if (link && updated) {
      entries.push({ title, link, updated, exhibit99: ex99 ? `https://www.sec.gov${ex99}` : null });
    }
  }
  return entries;
}

// EDGAR exhibits are sometimes wrapped in an SGML header before the <html> block.
// Slice past it so title/summary extraction only sees the actual HTML.
function stripEdgarSgml(raw) {
  const idx = raw.search(/<html[\s>]/i);
  return idx > 0 ? raw.slice(idx) : raw;
}

function toPlain(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

// Returns { title, summary } where summary starts immediately after the headline.
// Apple and other iXBRL exhibits use styled <div>/<font> elements — no <h1> tags — so
// we convert block elements to newlines and scan lines to find the first real headline.
function extractEdgarContent(html) {
  // Extract <title> before stripping head — some exhibits (e.g. BusinessWire) put the
  // real headline there. Must happen before head removal below.
  const tagTitle = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const goodTagTitle = tagTitle.length >= 20 &&
    !/^(document|edgarfiling|ex-99[\d.]*|8-k|6-k|untitled)$/i.test(tagTitle)
    ? tagTitle : null;

  // Strip head, style, and script — head content (e.g. "EdgarFiling") bleeds into body
  // text if left in and causes false title matches.
  const clean = html
    .replace(/<head[^>]*>[\s\S]*?<\/head>/i, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

  // Try <h1>/<h2>/<h3> first (PRNewswire, BusinessWire standard HTML)
  const headingRegex = /<h[123][^>]*>([\s\S]*?)<\/h[123]>/gi;
  let m;
  while ((m = headingRegex.exec(clean)) !== null) {
    const t = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (t.length >= 15 && !/^(for immediate release|contact:|exhibit\s*\d)/i.test(t)) {
      return {
        title: (goodTagTitle || t).slice(0, 300),
        summary: toPlain(clean.slice(m.index + m[0].length)).slice(0, 500),
      };
    }
  }

  // No heading tags — convert block elements to newlines and scan line by line.
  // Apple iXBRL exhibits use <div><font style="font-size:15pt"> for the headline.
  const lined = clean
    .replace(/<br[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|tr|li|td)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n");

  const lines = lined.split("\n").map(l => l.trim()).filter(l => l.length >= 5);
  const SKIP = /^(exhibit\s*[\d.]+|ex-[\d.]+|for immediate release|contact:|media contact|\d{1,2}[\/\-]\d{1,2})/i;

  let titleIdx = -1;
  let titleLine = null;
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const l = lines[i];
    if (l.length >= 15 && l.length <= 250 && !SKIP.test(l)) {
      titleLine = l;
      titleIdx = i;
      break;
    }
  }

  if (titleLine || goodTagTitle) {
    const title = (goodTagTitle || titleLine).slice(0, 300);
    const summaryLines = lines.slice(titleIdx + 1);
    return { title, summary: summaryLines.join(" ").slice(0, 500) };
  }

  return { title: null, summary: toPlain(clean).slice(0, 500) };
}

async function fetchFilingDocument(filingHref) {
  try {
    const res = await fetchEdgar(filingHref, 8000);
    if (!res.ok) return null;
    const html = await res.text();
    const docRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const htmDocs = [];
    for (const row of docRows) {
      const href = row.match(/href="(\/Archives\/edgar\/data\/[^"]+\.htm)"/i)?.[1] || row.match(/href="\/ix\?doc=(\/Archives\/edgar\/data\/[^"]+\.htm)"/i)?.[1];
      if (href) {
        const desc = row.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        htmDocs.push({ href, desc });
      }
    }
    const priority = [
      (d) => /ex[_\-.]?99/i.test(d.href) || /exhibit.?99/i.test(d.href) || /ex[_\-.]?99/i.test(d.desc),
      (d) => /form\s*8[\-_]?k/i.test(d.desc) || /8[\-_]?k/i.test(d.href),
      (d) => /6[\-_]?k/i.test(d.href) || /form\s*6[\-_]?k/i.test(d.desc),
    ];
    let picked = null;
    for (const matcher of priority) {
      picked = htmDocs.find(matcher);
      if (picked) break;
    }
    if (!picked && htmDocs.length > 0) picked = htmDocs[0];
    if (!picked) return null;
    const docUrl = `https://www.sec.gov${picked.href}`;
    const docRes = await fetchEdgar(docUrl, 8000);
    if (!docRes.ok) return { url: docUrl, title: null, summary: null };
    const docHtml = stripEdgarSgml(await docRes.text());
    const { title, summary } = extractEdgarContent(docHtml);
    return { url: docUrl, title, summary };
  } catch {}
  return null;
}

async function fetchExhibit99Text(url) {
  if (/\.pdf$/i.test(url)) return { title: null, summary: null };
  try {
    const res = await fetchEdgar(url, 8000);
    if (!res.ok) return { title: null, summary: null };
    const raw = await res.text();
    if (/<html/i.test(raw.slice(0, 2000))) {
      const html = stripEdgarSgml(raw);
      return extractEdgarContent(html);
    }
    const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
    return { title: lines[0]?.slice(0, 300) || null, summary: lines.slice(0, 8).join(" ").slice(0, 500) };
  } catch {
    return { title: null, summary: null };
  }
}


export async function GET(request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // Cron guard: only run automatically during 6–9 AM Eastern; manual UI calls always proceed.
  // Vercel identifies cron requests via Authorization: Bearer <CRON_SECRET> (set in Vercel env vars).
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`;
  if (isCron && !inEasternWindow()) {
    return Response.json({ skipped: true, reason: "Outside 6–9 AM Eastern window" });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const watchlistOnly = new URL(request.url).searchParams.get("watchlistOnly") === "1";

  let companiesCreated = 0;
  let articlesCreated = 0;
  const skip = { tooOld: 0, duplicate: 0, nonEnglish: 0, noCompany: 0, notPressRelease: 0, wrongExchange: 0 };
  const storedByCompany = {};
  const errors = [];
  const feedCounts = {};
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [{ data: allCompanies }, { data: watchedData }] = await Promise.all([
    supabase.from("companies").select("id, symbol, name, sector, exchange"),
    supabase.from("watched_companies").select("company_id"),
  ]);

  const companies = allCompanies || [];
  const watchedIds = new Set((watchedData || []).map(w => w.company_id));
  const watchedCompanies = companies.filter(c => watchedIds.has(c.id));

  // GlobeNewswire industry feeds — verified to be TSXV-dominant in 2026.
  // The broad country/CA feed returns 20 items (mostly large-cap TSX).
  // The exchange/TSX-V feed is empty. Industry feeds return 20 items each
  // with 75-90% TSX-V junior mining coverage; URL dedup merges overlaps.
  // Newsfile Corp (TMX-owned) feeds added as a second distribution network —
  // many junior miners publish exclusively through Newsfile, not GlobeNewswire.
  // feeds.newsfilecorp.com returns 10 items per feed; no categories/source tags,
  // but tickers appear in description body as "(TSXV: ABC)" within the first ~200 chars.
  const pressReleaseSources = [
    {
      url: "https://www.globenewswire.com/RssFeed/industry/1000-Basic Materials/",
      name: "GlobeNewswire - Basic Materials",
      newswire: "GlobeNewswire",
    },
    {
      url: "https://www.globenewswire.com/RssFeed/industry/1775-General Mining/",
      name: "GlobeNewswire - General Mining",
      newswire: "GlobeNewswire",
    },
    {
      url: "https://www.globenewswire.com/RssFeed/industry/1777-Gold Mining/",
      name: "GlobeNewswire - Gold Mining",
      newswire: "GlobeNewswire",
    },
    {
      url: "https://www.globenewswire.com/RssFeed/industry/55102040-Copper/",
      name: "GlobeNewswire - Copper",
      newswire: "GlobeNewswire",
    },
    {
      url: "https://www.globenewswire.com/RssFeed/industry/1779-Platinum%20%26%20Precious%20Metals/",
      name: "GlobeNewswire - Precious Metals",
      newswire: "GlobeNewswire",
    },
    {
      url: "https://www.globenewswire.com/RssFeed/industry/1755-Nonferrous Metals/",
      name: "GlobeNewswire - Nonferrous Metals",
      newswire: "GlobeNewswire",
    },
    {
      url: "https://feeds.newsfilecorp.com/industry/mining-metals",
      name: "Newsfile - Mining & Metals",
      newswire: "Newsfile",
    },
    {
      url: "https://feeds.newsfilecorp.com/industry/precious-metals",
      name: "Newsfile - Precious Metals",
      newswire: "Newsfile",
    },
    {
      url: "https://feeds.newsfilecorp.com/industry/non-ferrous-metals",
      name: "Newsfile - Non-Ferrous Metals",
      newswire: "Newsfile",
    },
    {
      url: "https://feeds.newsfilecorp.com/industry/energy-metals",
      name: "Newsfile - Energy Metals",
      newswire: "Newsfile",
    },
    {
      url: "https://feeds.newsfilecorp.com/industry/rare-earths",
      name: "Newsfile - Rare Earths",
      newswire: "Newsfile",
    },
    {
      url: "https://feeds.newsfilecorp.com/industry/diamonds",
      name: "Newsfile - Diamonds",
      newswire: "Newsfile",
    },
  ];

  let items = [];

  if (!watchlistOnly) {
    const feedResults = await Promise.allSettled(
    pressReleaseSources.map(async (source) => {
      const res = await fetchWithTimeout(source.url);
      if (!res.ok) {
        feedCounts[source.name] = `HTTP ${res.status}`;
        return [];
      }
      const xml = await res.text();
      if (!xml.includes("<item") && !xml.includes("<entry")) {
        feedCounts[source.name] = "empty";
        return [];
      }
      const parsed = parseRSS(xml);
      feedCounts[source.name] = parsed.length;
      return parsed.map(item => ({ ...item, newswire: source.newswire }));
    })
  );

  for (const result of feedResults) {
    if (result.status !== "fulfilled") continue;
    const seenUrls = new Set(items.map(i => i.link));
    for (const item of result.value) {
      if (!seenUrls.has(item.link)) {
        items.push(item);
        seenUrls.add(item.link);
      }
    }
  }
  } // end if (!watchlistOnly)

  console.log(`Total ${items.length} press release items${watchlistOnly ? " (watchlist-only, broad feeds skipped)" : " from broad feeds"}`);

  // Per-company SEC EDGAR for NASDAQ/NYSE watched companies.
  // Searches both 8-K (US issuers, with Exhibit 99.1) and 6-K (foreign private issuers).
  const usWatched = watchedCompanies.filter(c => c.exchange === "NASDAQ" || c.exchange === "NYSE");

  const edgarResults = await Promise.allSettled(
    usWatched.map(async (company) => {
      const filingItems = [];

      // Search 8-K filings (US issuers)
      try {
        const url8k = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(company.symbol)}&type=8-K&dateb=&owner=include&count=40&search_text=&output=atom`;
        const res8k = await fetchEdgar(url8k);
        if (res8k.ok) {
          const xml8k = await res8k.text();
          const entries8k = parseEdgarAtom(xml8k).filter(e => new Date(e.updated) >= cutoff);
          const exhibitResults = await Promise.allSettled(
            entries8k.map(async (entry) => {
              if (entry.exhibit99) {
                const exhibit = await fetchExhibit99Text(entry.exhibit99);
                return { entry, url: entry.exhibit99, title: exhibit.title, summary: exhibit.summary };
              }
              if (!entry.link) return null;
              const doc = await fetchFilingDocument(entry.link);
              if (!doc) return null;
              return { entry, url: doc.url, title: doc.title, summary: doc.summary };
            })
          );
          for (const r of exhibitResults) {
            if (r.status !== "fulfilled" || !r.value) continue;
            const { entry, url, title, summary } = r.value;
            const cleanTitle = title || entry.title.replace(/\s*\(Filed.*\)/i, "").replace(/\s*\(\d{10}\)/g, "").trim();
            filingItems.push({
              title: cleanTitle, link: url, pubDate: entry.updated,
              summary: summary || "", source: "SEC EDGAR", categories: [],
              contributor: "", newswire: "SEC EDGAR", companyId: company.id,
            });
          }
        }
      } catch {}

      // Search 6-K filings (foreign private issuers — Canadian companies on NASDAQ/NYSE)
      try {
        const url6k = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(company.symbol)}&type=6-K&dateb=&owner=include&count=40&search_text=&output=atom`;
        const res6k = await fetchEdgar(url6k);
        if (res6k.ok) {
          const xml6k = await res6k.text();
          const entries6k = parseEdgarAtom(xml6k).filter(e => new Date(e.updated) >= cutoff);

          const seenFilingItems = new Set(filingItems.map(f => f.pubDate));
          const new6k = entries6k.filter(e => !seenFilingItems.has(e.updated));
          const docResults = await Promise.allSettled(
            new6k.map(async (entry) => {
              const filingHref = entry.link;
              if (!filingHref) return null;
              const doc = await fetchFilingDocument(filingHref);
              return { entry, doc };
            })
          );
          for (const r of docResults) {
            if (r.status !== "fulfilled" || !r.value?.doc) continue;
            const { entry, doc } = r.value;
            const title = doc.title || `${company.name} - 6-K Filing`;
            filingItems.push({
              title, link: doc.url, pubDate: entry.updated,
              summary: doc.summary || "", source: "SEC EDGAR", categories: [],
              contributor: "", newswire: "SEC EDGAR", companyId: company.id,
            });
          }
        }
      } catch {}

      return { company, filingItems, status: filingItems.length };
    })
  );

  for (const result of edgarResults) {
    if (result.status !== "fulfilled") continue;
    const { company, filingItems, status } = result.value;
    feedCounts[`EDGAR:${company.symbol}`] = status;
    const seenUrls = new Set(items.map(i => i.link));
    for (const item of filingItems) {
      if (!seenUrls.has(item.link)) {
        items.push(item);
        seenUrls.add(item.link);
      }
    }
  }

  console.log(`Total ${items.length} items after EDGAR fetch`);

  // Google News RSS per-company for watched NASDAQ/NYSE companies.
  // Only items whose <source> matches a known press release wire service are kept.
  // Google News aggregates BusinessWire, PRNewswire, GlobeNewswire, AccessWire, etc.
  // and usually returns the direct publisher URL (not a Google redirect) for wire content.
  const gnewsResults = await Promise.allSettled(
    usWatched.map(async (company) => {
      const query = encodeURIComponent(`"${company.name}"`);
      const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en&gl=US&ceid=US:en`;
      try {
        const res = await fetch(rssUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/rss+xml, application/xml, text/xml",
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          feedCounts[`GNEWS:${company.symbol}`] = `HTTP ${res.status}`;
          return [];
        }
        const xml = await res.text();
        const parsed = parseRSS(xml);
        const pressReleases = parsed.filter(item => isPressRelease(item.source));
        feedCounts[`GNEWS:${company.symbol}`] = pressReleases.length;
        return pressReleases.map(item => ({
          ...item,
          newswire: item.source,
          companyId: company.id,
        }));
      } catch (e) {
        feedCounts[`GNEWS:${company.symbol}`] = `err: ${e.message?.slice(0, 30)}`;
        return [];
      }
    })
  );

  for (const result of gnewsResults) {
    if (result.status !== "fulfilled") continue;
    const seenUrls = new Set(items.map(i => i.link));
    for (const item of result.value) {
      if (!seenUrls.has(item.link)) {
        items.push(item);
        seenUrls.add(item.link);
      }
    }
  }

  console.log(`Total ${items.length} items after Google News press releases`);

  // Per-company GlobeNewswire search for watched Canadian-listed companies only.
  // NASDAQ/NYSE companies use EDGAR + Google News.
  const gnwWatched = watchedCompanies.filter(c =>
    c.exchange === "TSX" || c.exchange === "TSXV" || c.exchange === "CSE" || c.exchange === "NEO"
  );

  const gnwResults = await Promise.allSettled(
    gnwWatched.map(async (company) => {
      const seenUrls = new Set();
      const foundItems = [];
      const companyNameNorm = (company.name || "").toLowerCase().replace(/[.,]/g, "").trim();

      // Keyword search with source-name extraction from HTML
      const searchTerms = [company.name, company.symbol].filter(Boolean);
      for (const term of searchTerms) {
        try {
          const encoded = encodeURIComponent(term).replace(/%20/g, "+");
          const searchUrl = `https://www.globenewswire.com/Search/keyword/${encoded}`;
          const res = await fetch(searchUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml",
            },
            signal: AbortSignal.timeout(12000),
          });
          if (!res.ok) { console.log(`GNW search "${term}": HTTP ${res.status}`); continue; }
          const html = await res.text();

          const articleRegex = /\/news-release\/(\d{4})\/(\d{2})\/(\d{2})\/\d+\/\d+\/en\/([^"'<>\s]+\.html)/g;
          let m;
          while ((m = articleRegex.exec(html)) !== null) {
            const [fullMatch, year, month, day, slug] = m;
            const fullUrl = `https://www.globenewswire.com${fullMatch}`;
            if (seenUrls.has(fullUrl)) continue;

            const pubDate = new Date(`${year}-${month}-${day}T12:00:00Z`);
            if (pubDate < cutoff) continue;

            const pos = m.index;
            const surroundingHtml = html.slice(Math.max(0, pos - 500), pos + fullMatch.length + 200);
            const sourceMatch = surroundingHtml.match(/class="sourceLink"[^>]*>([^<]+)<\/a>/);
            const sourceName = sourceMatch ? sourceMatch[1].trim().toLowerCase().replace(/[.,]/g, "") : "";

            const slugLower = slug.toLowerCase();
            const symbolLower = company.symbol.toLowerCase();
            const nameParts = companyNameNorm
              .split(/\s+/)
              .filter(p => p.length >= 3 && !["inc", "ltd", "corp", "the", "and", "resources", "mining", "gold", "metals", "minerals"].includes(p));

            const sourceMatches = sourceName.length > 3 && (sourceName.includes(companyNameNorm) || companyNameNorm.includes(sourceName));
            const slugMatches = slugLower.includes(symbolLower) || nameParts.some(p => slugLower.includes(p));

            if (!sourceMatches && !slugMatches) continue;

            seenUrls.add(fullUrl);
            const afterUrl = html.slice(pos + fullMatch.length, pos + fullMatch.length + 400);
            const titleFromAnchor = afterUrl.match(/^[^>]*>([\s\S]*?)<\/a>/)?.[1]
              ?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
            const title = (titleFromAnchor && titleFromAnchor.length > 5)
              ? titleFromAnchor
              : slug.replace(/\.html$/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

            foundItems.push({
              title,
              link: fullUrl,
              pubDate: pubDate.toISOString(),
              summary: "",
              source: "GlobeNewswire",
              categories: [],
              contributor: company.name,
              newswire: "GlobeNewswire",
              companyId: company.id,
            });
          }

          if (foundItems.length > 0) break;
        } catch (e) {
          console.log(`GNW keyword "${term}": ${e.message?.slice(0, 60)}`);
        }
      }

      feedCounts[`GNW:${company.symbol}`] = foundItems.length;
      return foundItems;
    })
  );

  for (const result of gnwResults) {
    if (result.status !== "fulfilled") continue;
    const seenUrls = new Set(items.map(i => i.link));
    for (const item of result.value) {
      if (!seenUrls.has(item.link)) {
        items.push(item);
        seenUrls.add(item.link);
      }
    }
  }

  console.log(`Total ${items.length} items after GlobeNewswire keyword search`);

  for (const item of items) {
    let publishedAt = item.pubDate ? new Date(item.pubDate) : now;
    if (publishedAt > now) publishedAt = now;
    if (publishedAt < cutoff) {
      skip.tooOld++;
      continue;
    }

    if (await isDuplicate(supabase, item.link, item.title)) {
      skip.duplicate++;
      continue;
    }

    // Drop law firm securities-alert ads — not actual company news
    if (/attorney advertising/i.test(item.title + " " + item.summary) ||
        /\b(shareholder alert|investor alert|class action lawsuit|class action|securities fraud|investigation alert|important deadline|reminds investors|encourages investors|announces investigation|filing deadline|to discuss your rights|lost money in|urged to contact|encouraged to reach out)\b/i.test(item.title) ||
        /recover(ing)? (their |your )?(investment )?loss/i.test(item.title)) {
      skip.notPressRelease++;
      continue;
    }

    // Drop non-English articles: URL language codes, French accents, and non-Latin scripts
    const NON_ENGLISH_URL = ["/fr/", "/french/", "/de/", "/es/", "/pt/", "/zh/", "/ja/", "/ko/", "/ru/"];
    if (NON_ENGLISH_URL.some(p => item.link.includes(p))) {
      skip.nonEnglish++;
      continue;
    }
    if (/[àâçéèêëîïôùûüÿœæÀÂÇÉÈÊËÎÏÔÙÛÜŸŒÆ]/.test(item.title)) {
      skip.nonEnglish++;
      continue;
    }
    if (/[Ѐ-ӿ؀-ۿ一-鿿぀-ヿ]/.test(item.title)) {
      skip.nonEnglish++;
      continue;
    }

    let company = null;

    if (item.companyId) {
      company = companies.find(c => c.id === item.companyId) || null;
    }

    if (!company) {
      const catTickers = extractFromCategories(item.categories || []);
      if (catTickers.length > 0) {
        for (const t of catTickers) {
          company = companies.find(c => c.symbol === t.symbol && c.exchange === t.exchange);
          if (company) break;
        }
        if (!company) {
          for (const t of catTickers) {
            company = companies.find(c => c.symbol === t.symbol);
            if (company) break;
          }
        }
      }
    }

    if (!company) {
      const textTickers = extractTickerFromText(item.title, item.summary);
      if (textTickers.length > 0) {
        for (const t of textTickers) {
          company = companies.find(c => c.symbol === t.symbol && c.exchange === t.exchange);
          if (company) break;
        }
        if (!company) {
          for (const t of textTickers) {
            company = companies.find(c => c.symbol === t.symbol);
            if (company) break;
          }
        }
      }
    }

    if (!company) {
      const info = extractFromURL(item.link);
      if (info) {
        company = companies.find(c => c.symbol === info.symbol && c.exchange === info.exchange);
        if (!company) {
          company = companies.find(c => c.symbol === info.symbol);
        }
      }
    }

    if (!company) {
      const titleLower = item.title.toLowerCase();
      company = companies.find(c => {
        const name = (c.name || "").toLowerCase();
        return name.length > 5 && titleLower.includes(name);
      });
    }

    if (!company && item.contributor) {
      const contribNorm = item.contributor.toLowerCase().replace(/[.,]/g, "").trim();
      if (contribNorm.length > 3) {
        company = companies.find(c => {
          const nameNorm = (c.name || "").toLowerCase().replace(/[.,]/g, "").trim();
          return nameNorm.length > 3 && (contribNorm.includes(nameNorm) || nameNorm.includes(contribNorm));
        });
      }
    }

    if (!company && !item.companyId) {
      const catTickers = extractFromCategories(item.categories || []).filter(t => t.exchange === "TSX" || t.exchange === "TSXV");
      if (catTickers.length > 0) {
        const t = catTickers[0];
        const companyName = item.contributor || t.symbol;
        const { data: created } = await supabase
          .from("companies")
          .insert({ symbol: t.symbol, name: companyName, exchange: t.exchange })
          .select("id, symbol, name, sector, exchange")
          .single();
        if (created) {
          company = created;
          companies.push(created);
          companiesCreated++;
        }
      }
    }

    if (!company && !item.companyId) {
      const textTickers = extractTickerFromText(item.title, item.summary).filter(t => t.exchange === "TSX" || t.exchange === "TSXV");
      if (textTickers.length > 0) {
        const t = textTickers[0];
        const companyName = item.contributor || t.symbol;
        const { data: created } = await supabase
          .from("companies")
          .insert({ symbol: t.symbol, name: companyName, exchange: t.exchange })
          .select("id, symbol, name, sector, exchange")
          .single();
        if (created) {
          company = created;
          companies.push(created);
          companiesCreated++;
        }
      }
    }

    if (!company) {
      skip.noCompany++;
      continue;
    }

    if (company.exchange !== "TSX" && company.exchange !== "TSXV" && !watchedIds.has(company.id)) {
      skip.wrongExchange++;
      continue;
    }

    const sourceLabel = item.source || item.newswire || "Press Release";

    const { error: articleErr } = await supabase.from("articles").insert({
      company_id: company.id,
      title: item.title,
      url: item.link,
      source: sourceLabel,
      published_at: publishedAt.toISOString(),
      summary: item.summary || null,
    });

    if (articleErr) {
      errors.push(`${company.symbol}: ${articleErr.message}`);
    } else {
      articlesCreated++;
      storedByCompany[company.id] = (storedByCompany[company.id] || 0) + 1;
    }
  }

  const watchlistSummary = watchedCompanies.map(c => ({
    symbol: c.symbol,
    exchange: c.exchange,
    storedThisRun: storedByCompany[c.id] || 0,
  }));

  return Response.json({
    ok: true,
    companiesCreated,
    articlesCreated,
    skipped: skip.tooOld + skip.duplicate + skip.nonEnglish + skip.noCompany + skip.wrongExchange,
    skip,
    totalFound: items.length,
    feeds: feedCounts,
    watchlist: watchlistSummary,
    errors: errors.length ? errors : undefined,
  });
}
