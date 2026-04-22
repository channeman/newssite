import { createClient } from "@supabase/supabase-js";

const BATCH_PROMPT = `You are a mining industry analyst. Analyze these TSXV mining company news headlines and return ONLY a valid JSON array. Each item must have these fields:

{
  "summary": "1-2 sentence plain English summary",
  "importance": 1-5,
  "impact": one of: "very_positive", "positive", "neutral", "negative", "very_negative",
  "impact_reason": "1 sentence explaining why"
}

Importance guidelines:
- 5: Major discovery, exceptional drill results, takeover, production start, major financing
- 4: Good drill results, resource estimate, permitting progress, significant partnership
- 3: Moderate drill results, exploration updates, management changes, moderate financing
- 2: Routine operational updates, minor assays, technical reports
- 1: Name changes, stock splits, warrant extensions, minor admin changes

Impact considerations:
- How significant are the grades/widths vs typical for this commodity?
- Better or worse than market expectations?
- Does this meaningfully advance the project?
- Could this move the stock price significantly?

Return ONLY the JSON array, no other text. The array must have exactly the same number of items as headlines provided.

Headlines:`;

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

  const headlines = articles.map((a, i) => `${i + 1}. [id:${a.id}] ${a.title}`).join("\n");

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${BATCH_PROMPT}\n${headlines}` }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2000,
          },
        }),
      }
    );

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return Response.json({ ok: false, error: "No response from AI", raw: data });
    }

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return Response.json({ ok: false, error: "No JSON array found", raw: text });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    let analyzed = 0;
    const errors = [];

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const item = parsed[i];

      if (!item) {
        errors.push(`Article ${article.id}: no matching analysis`);
        continue;
      }

      const importance = Math.min(5, Math.max(1, parseInt(item.importance) || 3));
      const validImpacts = ["very_positive", "positive", "neutral", "negative", "very_negative"];
      const impact = validImpacts.includes(item.impact) ? item.impact : "neutral";

      const { error: updateErr } = await supabase
        .from("articles")
        .update({
          ai_summary: item.summary || null,
          importance,
          impact,
        })
        .eq("id", article.id);

      if (updateErr) {
        errors.push(`Article ${article.id}: ${updateErr.message}`);
      } else {
        analyzed++;
      }
    }

    return Response.json({
      ok: true,
      analyzed,
      total: articles.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
