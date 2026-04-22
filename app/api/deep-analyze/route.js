import { createClient } from "@supabase/supabase-js";

const DEEP_PROMPT = `You are a senior mining analyst at a boutique investment bank. Provide an in-depth analysis of this news item.

Context:
- Company: {company} ({symbol}) - {commodity} focused, {region} - TSXV listed
- Sector: {sector}
- Headline: {headline}
- Initial AI assessment: importance {importance}/5, impact: {impact}

Peer companies (similar size, same commodity, same region):
{peer_info}

Recent peer news:
{peer_news}

Company's own recent history:
{own_history}

Provide your analysis in this exact JSON format:
{
  "thesis": "2-3 sentence investment thesis on what this means for the company",
  "peer_comparison": "Compare specifically to the peers listed above. Are they ahead or behind in exploration? How do their results compare? Who has the better project/location?",
  "relative_position": "Is this company a leader, middle-of-pack, or laggard vs these peers? Why?",
  "stock_impact": "Expected short-term stock impact. Be specific (e.g. 'could see 10-20% pop' or 'likely neutral'). Reference how peers' stocks reacted to similar news if known.",
  "catalyst_type": "One of: drill_result, resource_estimate, permitting, financing, m&a, management, production, exploration_update, corporate, other",
  "key_risk": "What could go wrong with this thesis?",
  "watch_for": "What milestones or data points should investors watch for next?",
  "grade_assessment": "If drill results: are grades exceptional/good/average/sub-par for this deposit type and region? Compare to peer results. If not drill results: 'N/A'"
}

Be specific, use numbers, reference peers by name. Return ONLY valid JSON.`;

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
    .select("id, title, ai_summary, importance, impact, company_id, companies(id, symbol, name, sector, commodity, region)")
    .eq("id", articleId)
    .single();

  if (articleErr || !article) {
    return Response.json({ error: "Article not found" }, { status: 404 });
  }

  const company = article.companies;
  const sector = company?.sector || "Mining";
  const commodity = company?.commodity || "unknown";
  const region = company?.region || "unknown";

  let peerInfoText = "No peer data available yet.";
  let peerNewsText = "No recent peer news.";

  if (company?.commodity) {
    const { data: peerCompanies } = await supabase
      .from("companies")
      .select("id, symbol, name, commodity, region")
      .eq("commodity", company.commodity)
      .neq("id", company.id)
      .limit(10);

    if (peerCompanies && peerCompanies.length > 0) {
      const regionMatches = company.region
        ? peerCompanies.filter((p) => p.region === company.region)
        : [];

      const rankedPeers = regionMatches.length > 0 ? regionMatches : peerCompanies;

      peerInfoText = rankedPeers
        .map((p) => `- ${p.name} (${p.symbol}): ${p.commodity}, ${p.region || "unknown region"}`)
        .join("\n");

      const peerIds = rankedPeers.map((p) => p.id);
      const { data: peerArticles } = await supabase
        .from("articles")
        .select("title, published_at, importance, impact, companies(symbol, name)")
        .in("company_id", peerIds)
        .order("published_at", { ascending: false })
        .limit(10);

      if (peerArticles && peerArticles.length > 0) {
        peerNewsText = peerArticles
          .map((a) => {
            const imp = a.importance ? ` [${a.importance}/5]` : "";
            const imp2 = a.impact ? ` ${a.impact}` : "";
            return `- ${a.companies?.symbol}: ${a.title}${imp}${imp2}`;
          })
          .join("\n");
      }
    }
  }

  const { data: ownArticles } = await supabase
    .from("articles")
    .select("title, published_at, importance, impact")
    .eq("company_id", company.id)
    .neq("id", articleId)
    .order("published_at", { ascending: false })
    .limit(5);

  let ownHistoryText = "No prior articles.";
  if (ownArticles && ownArticles.length > 0) {
    ownHistoryText = ownArticles
      .map((a) => `- ${a.title}`)
      .join("\n");
  }

  const prompt = DEEP_PROMPT
    .replace("{company}", company?.name || "Unknown")
    .replace("{symbol}", company?.symbol || "?")
    .replace("{commodity}", commodity)
    .replace("{region}", region)
    .replace("{sector}", sector)
    .replace("{headline}", article.title)
    .replace("{importance}", String(article.importance || 3))
    .replace("{impact}", article.impact || "neutral")
    .replace("{peer_info}", peerInfoText)
    .replace("{peer_news}", peerNewsText)
    .replace("{own_history}", ownHistoryText);

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
            maxOutputTokens: 1500,
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
      parsed.relative_position ? `**Relative Position:** ${parsed.relative_position}` : null,
      parsed.stock_impact ? `**Expected Stock Impact:** ${parsed.stock_impact}` : null,
      parsed.key_risk ? `**Key Risk:** ${parsed.key_risk}` : null,
      parsed.watch_for ? `**Watch For:** ${parsed.watch_for}` : null,
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
