import { createClient } from "@supabase/supabase-js";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  if (!q || q.trim().length < 2) {
    return Response.json({ articles: [], companies: [] });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ error: "Missing config" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const [articlesRes, companiesRes] = await Promise.all([
    supabase
      .from("articles")
      .select("id, title, url, published_at, importance, impact, ai_summary, source, companies(symbol, name)")
      .or(`title.ilike.%${q}%,ai_summary.ilike.%${q}%`)
      .order("published_at", { ascending: false })
      .limit(20),
    supabase
      .from("companies")
      .select("id, symbol, name, commodity, region, price, price_change_pct")
      .or(`symbol.ilike.%${q}%,name.ilike.%${q}%,commodity.ilike.%${q}%`)
      .limit(10),
  ]);

  return Response.json({
    articles: articlesRes.data || [],
    companies: companiesRes.data || [],
  });
}
