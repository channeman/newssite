import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: watched } = await supabase
    .from("watched_companies")
    .select("company_id, companies(symbol)");

  if (!watched || watched.length === 0) {
    return Response.json({ message: "No watched companies" });
  }

  const results = [];

  for (const w of watched) {
    const symbol = w.companies.symbol;
    const rssUrl = `https://finance.yahoo.com/rss/headline?s=${symbol}.V`;

    try {
      const res = await fetch(rssUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const text = await res.text();

      const items = text
        .split("<item>")
        .slice(1)
        .map((item) => {
          const title = item.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] ||
            item.match(/<title>(.*?)<\/title>/)?.[1] || "";
          const link = item.match(/<link>(.*?)<\/link>/)?.[1] || "";
          const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
          return { title, link, pubDate };
        })
        .filter((i) => i.title && i.link);

      for (const item of items.slice(0, 10)) {
        const { data: existing } = await supabase
          .from("articles")
          .select("id")
          .eq("url", item.link)
          .single();

        if (!existing) {
          const { error } = await supabase.from("articles").insert({
            company_id: w.company_id,
            title: item.title,
            url: item.link,
            source: "Yahoo Finance",
            published_at: item.pubDate
              ? new Date(item.pubDate).toISOString()
              : new Date().toISOString(),
          });
          if (!error) results.push(item.title);
        }
      }
    } catch (e) {
      console.error(`Failed to fetch for ${symbol}:`, e.message);
    }
  }

  return Response.json({ fetched: results.length, articles: results });
}
