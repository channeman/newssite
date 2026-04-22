import { createClient } from "@supabase/supabase-js";

const PROMPT = `You are a mining industry analyst. Analyze this TSXV mining company news headline and return ONLY valid JSON with these fields:

{
  "summary": "1-2 sentence plain English summary of what happened",
  "importance": 1-5 where 1=minor corporate update, 2=routine operational, 3=noteworthy, 4=significant, 5=major catalyst,
  "impact": one of: "very_positive", "positive", "neutral", "negative", "very_negative",
  "impact_reason": "1 sentence explaining why this is positive/negative/neutral"
}

Rating guidelines:
- Importance 5: Major discovery, exceptional drill results, takeover, production start, major financing
- Importance 4: Good drill results, resource estimate, permitting progress, significant partnership
- Importance 3: Moderate drill results, exploration updates, management changes, moderate financing
- Importance 2: Routine operational updates, minor assays, technical reports
- Importance 1: Name changes, stock splits, warrant extensions, minor admin changes

Impact considerations:
- How significant are the grades/widths compared to typical results for this commodity?
- Is this better or worse than market expectations?
- Does this meaningfully advance the project?
- Could this move the stock price significantly?

Headline:`;

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!supabaseUrl || !supabaseKey || !geminiKey) {
    return Response.json({ error: "Missing config" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: articles, error: fetchErr } = await supabase
    .from("articles")
    .select("id, title")
    .is("ai_summary", null)
    .order("published_at", { ascending: false })
    .limit(10);

  if (fetchErr) {
    return Response.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!articles || articles.length === 0) {
    return Response.json({ ok: true, analyzed: 0, message: "No articles to analyze" });
  }

  let analyzed = 0;
  const errors = [];

  for (const article of articles) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${PROMPT}\n${article.title}` }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 300,
            },
          }),
        }
      );

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        errors.push(`Article ${article.id}: no response`);
        continue;
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        errors.push(`Article ${article.id}: no JSON found`);
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const importance = Math.min(5, Math.max(1, parseInt(parsed.importance) || 3));
      const validImpacts = ["very_positive", "positive", "neutral", "negative", "very_negative"];
      const impact = validImpacts.includes(parsed.impact) ? parsed.impact : "neutral";

      await supabase
        .from("articles")
        .update({
          ai_summary: parsed.summary || null,
          importance,
          impact,
        })
        .eq("id", article.id);

      analyzed++;

      if (analyzed < articles.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (e) {
      errors.push(`Article ${article.id}: ${e.message}`);
    }
  }

  return Response.json({
    ok: true,
    analyzed,
    total: articles.length,
    errors: errors.length ? errors : undefined,
  });
}
