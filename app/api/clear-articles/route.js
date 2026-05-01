import { createClient } from "@supabase/supabase-js";

export async function POST(request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ error: "Missing Supabase config" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let watchlistOnly = false;
  try {
    const body = await request.json();
    watchlistOnly = !!body.watchlistOnly;
  } catch {}

  try {
    let query = supabase.from("articles").delete();

    if (watchlistOnly) {
      const { data: watched } = await supabase
        .from("watched_companies")
        .select("company_id");
      const ids = (watched || []).map(w => w.company_id);
      if (ids.length === 0) return Response.json({ success: true, articlesCleared: 0 });
      query = query.in("company_id", ids);
    } else {
      query = query.neq("id", 0);
    }

    const { count, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ success: true, articlesCleared: count ?? "all" });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}