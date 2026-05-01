import { createClient } from "@supabase/supabase-js";

const PROFILE_PROMPT = `Generate a concise company profile based on its recent news. Return ONLY valid JSON:

{
  "description": "2-3 sentences describing what the company does, their main project(s), commodity focus, and current stage of development",
  "commodity": "primary commodity or sector focus",
  "region": "geographic region of main project",
  "cash_position": numeric value of cash on hand in CAD (e.g. 2500000 for $2.5M), or null if not mentioned
}

Company: {symbol} - {name}
Sector: {sector}
Recent news:
{news}`;

export async function POST(request) {
  const { companyId } = await request.json();
  if (!companyId) return Response.json({ error: "companyId required" }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!supabaseUrl || !supabaseKey || !geminiKey) {
    return Response.json({ error: "Missing config" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: company } = await supabase
    .from("companies")
    .select("id, symbol, name, sector, description")
    .eq("id", companyId)
    .single();

  if (!company) return Response.json({ error: "Not found" }, { status: 404 });

  const { data: articles } = await supabase
    .from("articles")
    .select("title")
    .eq("company_id", companyId)
    .order("published_at", { ascending: false })
    .limit(10);

  const newsText = (articles || []).map((a) => `- ${a.title}`).join("\n") || "No recent news available.";

  const prompt = PROFILE_PROMPT
    .replace("{symbol}", company.symbol)
    .replace("{name}", company.name)
    .replace("{sector}", company.sector || "Mining")
    .replace("{news}", newsText);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
        }),
      }
    );

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return Response.json({ ok: false, error: "No response" });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return Response.json({ ok: false, error: "No JSON" });

    const parsed = JSON.parse(jsonMatch[0]);

    await supabase
      .from("companies")
      .update({
        description: parsed.description || company.description || null,
        commodity: parsed.commodity || company.commodity || null,
        region: parsed.region || company.region || null,
        cash_position: parsed.cash_position ?? company.cash_position ?? null,
      })
      .eq("id", companyId);

    return Response.json({ ok: true, description: parsed.description });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
