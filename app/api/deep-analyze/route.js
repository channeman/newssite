import { createClient } from "@supabase/supabase-js";

const DEEP_PROMPT = `You are a senior mining analyst at a boutique investment bank. Provide an in-depth analysis of this news item.

Context:
- The company: {company} ({symbol}) - {sector} sector on TSXV
- News headline: {headline}
- AI initial assessment: importance {importance}/5, impact: {impact}

Recent peer news (same sector):
{peer_news}

Provide your analysis in this exact JSON format:
{
  "thesis": "2-3 sentence investment thesis on what this means for the company",
  "peer_comparison": "How does this compare to recent peer activity? Better/worse/in-line? What are peers doing differently?",
  "stock_impact": "Expected short-term stock impact and why. Be specific about likely price reaction (e.g. 'could see 10-20% pop' or 'likely neutral, already priced in')",
  "catalyst_type": "One of: drill_result, resource_estimate, permitting, financing, m&a, management, production, exploration_update, corporate, other",
  "key_risk": "What could go wrong with this thesis?",
  "watch_for": "What should investors watch for next? Specific milestones or data points.",
  "commodity_exposure": "Primary commodity (gold, copper, lithium, uranium, silver, zinc, nickel, etc.)",
  "grade_assessment": "If drill results mentioned: are the grades exceptional/good/average/sub-par for this deposit type? If not drill results: 'N/A'"
}

Be specific and actionable. Use numbers where possible. Return ONLY valid JSON.`;

export async function POST(request) {
  const { articleId } = await request.json();

  if (!articleId) {
    return Response.json({ error: "articleId required" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!supabaseUrl || !supabaseKey || !geminiKey) {
    return Response.json({ error: "Missing config" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: article, error: articleErr } = await supabase
    .from("articles")
    .select("id, title, ai_summary, importance, impact, company_id, companies(id, symbol, name, sector)")
    .eq("id", articleId)
    .single();

  if (articleErr || !article) {
    return Response.json({ error: "Article not found" }, { status: 404 });
  }

  const company = article.companies;
  const sector = company?.sector || "Mining";

  const { data: peerArticles } = await supabase
    .from("articles")
    .select("title, published_at, companies(symbol, name)")
    .neq("company_id", article.company_id)
    .order("published_at", { ascending: false })
    .limit(10);

  let peerNewsText = "No recent peer news available.";
  if (peerArticles && peerArticles.length > 0) {
    peerNewsText = peerArticles
      .map((a) => `- ${a.companies?.symbol || "?"}: ${a.title}`)
      .join("\n");
  }

  const prompt = DEEP_PROMPT
    .replace("{company}", company?.name || "Unknown")
    .replace("{symbol}", company?.symbol || "?")
    .replace("{sector}", sector)
    .replace("{headline}", article.title)
    .replace("{importance}", String(article.importance || 3))
    .replace("{impact}", article.impact || "neutral")
    .replace("{peer_news}", peerNewsText);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1000,
          },
        }),
      }
    );

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return Response.json({ ok: false, error: "No AI response", raw: data });
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ ok: false, error: "No JSON found", raw: text });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const formatted = [
      parsed.thesis ? `**Thesis:** ${parsed.thesis}` : null,
      parsed.grade_assessment && parsed.grade_assessment !== "N/A"
        ? `**Grade Assessment:** ${parsed.grade_assessment}` : null,
      parsed.peer_comparison ? `**Peer Comparison:** ${parsed.peer_comparison}` : null,
      parsed.stock_impact ? `**Expected Stock Impact:** ${parsed.stock_impact}` : null,
      parsed.key_risk ? `**Key Risk:** ${parsed.key_risk}` : null,
      parsed.watch_for ? `**Watch For:** ${parsed.watch_for}` : null,
      parsed.commodity_exposure ? `**Commodity:** ${parsed.commodity_exposure}` : null,
      parsed.catalyst_type ? `**Catalyst Type:** ${parsed.catalyst_type}` : null,
    ].filter(Boolean).join("\n\n");

    await supabase
      .from("articles")
      .update({ deep_analysis: formatted })
      .eq("id", articleId);

    return Response.json({ ok: true, analysis: formatted });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
