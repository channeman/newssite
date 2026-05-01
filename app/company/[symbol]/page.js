"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function CompanyPage() {
  const { symbol } = useParams();
  const [company, setCompany] = useState(null);
  const [articles, setArticles] = useState([]);
  const [peers, setPeers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetchCompany();
  }, [symbol]);

  async function fetchCompany() {
    setLoading(true);
    const { data: comp } = await supabase
      .from("companies")
      .select("*")
      .eq("symbol", symbol.toUpperCase())
      .single();

    if (comp) {
      setCompany(comp);

      const { data: arts } = await supabase
        .from("articles")
        .select("*")
        .eq("company_id", comp.id)
        .order("published_at", { ascending: false })
        .limit(50);
      setArticles(arts || []);

      if (comp.commodity) {
        const { data: peerData } = await supabase
          .from("companies")
          .select("id, symbol, name, commodity, region, price, price_change_pct, market_cap")
          .eq("commodity", comp.commodity)
          .neq("id", comp.id)
          .limit(8);
        setPeers(peerData || []);
      }
    }
    setLoading(false);
  }

  function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function formatNumber(n, dollarPrefix) {
    if (!n) return "—";
    let s;
    if (n >= 1e9) s = `${(n / 1e9).toFixed(1)}B`;
    else if (n >= 1e6) s = `${(n / 1e6).toFixed(1)}M`;
    else if (n >= 1e3) s = `${(n / 1e3).toFixed(1)}K`;
    else s = String(n);
    return dollarPrefix ? `$${s}` : s;
  }

  function impactLabel(impact) {
    const labels = {
      very_positive: "++",
      positive: "+",
      neutral: "~",
      negative: "-",
      very_negative: "--",
    };
    return labels[impact] || "~";
  }

  if (loading) return <div className="loading">Loading...</div>;
  if (!company) return <div className="empty">Company not found.</div>;

  const avgImportance = articles.filter((a) => a.importance).length > 0
    ? (articles.filter((a) => a.importance).reduce((s, a) => s + a.importance, 0) /
      articles.filter((a) => a.importance).length).toFixed(1)
    : null;

  return (
    <div className="profile-page">
      <div className="profile-header">
        <div className="profile-title-row">
          <h1 className="profile-symbol">{company.symbol}</h1>
          {company.price && (
            <div className="profile-price">
              <span className="profile-price-val">${company.price.toFixed(3)}</span>
              {company.price_change_pct != null && (
                <span className={company.price_change_pct >= 0 ? "price-up" : "price-down"}>
                  {company.price_change_pct >= 0 ? "+" : ""}{company.price_change_pct}%
                </span>
              )}
            </div>
          )}
        </div>
        <div className="profile-name">{company.long_name || company.name}</div>
        <div className="profile-tags">
          {company.sector && <span className="profile-tag">{company.sector}</span>}
          {company.commodity && <span className="profile-tag">{company.commodity}</span>}
          {company.region && <span className="profile-tag">{company.region}</span>}
          <span className="profile-tag">{company.exchange || "TSXV"}</span>
        </div>
      </div>

      <div className="profile-stats">
        <div className="stat-card">
          <div className="stat-label">Market Cap</div>
          <div className="stat-value">
            {formatNumber(company.market_cap || (company.shares_outstanding && company.price ? Math.round(company.shares_outstanding * company.price) : null), true)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cash Position</div>
          <div className="stat-value">
            {formatNumber(company.cash_position, true)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Price</div>
          <div className="stat-value">{company.price ? `$${company.price.toFixed(3)}` : "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Shares Out</div>
          <div className="stat-value">{formatNumber(company.shares_outstanding)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Volume</div>
          <div className="stat-value">{formatNumber(company.volume)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Day Range</div>
          <div className="stat-value">
            {company.day_high && company.day_low
              ? `$${company.day_low.toFixed(3)} – $${company.day_high.toFixed(3)}`
              : "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">52-Week Range</div>
          <div className="stat-value">
            {company.week_52_high && company.week_52_low
              ? `$${company.week_52_low.toFixed(3)} – $${company.week_52_high.toFixed(3)}`
              : "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Articles</div>
          <div className="stat-value">{articles.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Importance</div>
          <div className="stat-value">{avgImportance || "—"}</div>
        </div>
      </div>

      <div className="profile-section">
        <div className="section-title-row">
          <h2 className="section-title" style={{ borderTop: "none", paddingTop: 0 }}>About</h2>
          {!company.description && (
            <button
              className="btn-generate"
              disabled={generating}
              onClick={async () => {
                setGenerating(true);
                try {
                  const res = await fetch("/api/generate-profile", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ companyId: company.id }),
                  });
                  const data = await res.json();
                  if (data.ok && data.description) {
                    setCompany((c) => ({ ...c, description: data.description }));
                  }
                } catch (e) {
                  console.error("Profile generation failed:", e);
                }
                setGenerating(false);
              }}
            >
              {generating ? "Generating..." : "Generate Profile"}
            </button>
          )}
        </div>
        {company.description ? (
          <p className="profile-desc">{company.description}</p>
        ) : (
          <p className="profile-desc" style={{ fontStyle: "italic" }}>No description yet. Click "Generate Profile" to create one using AI.</p>
        )}
      </div>

      {peers.length > 0 && (
        <div className="profile-section">
          <h2 className="section-title">Peers ({company.commodity})</h2>
          <div className="profile-peers">
            {peers.map((p) => (
              <a key={p.id} href={`/company/${p.symbol}`} className="peer-card">
                <div className="peer-symbol">{p.symbol}</div>
                <div className="peer-name">{p.name}</div>
                <div className="peer-meta">
                  {p.region && <span>{p.region}</span>}
                  {p.price && (
                    <span className={p.price_change_pct >= 0 ? "price-up" : "price-down"}>
                      ${p.price.toFixed(3)} {p.price_change_pct >= 0 ? "+" : ""}{p.price_change_pct}%
                    </span>
                  )}
                </div>
                {p.market_cap && (
                  <div className="peer-mcap">MCap: {formatNumber(p.market_cap, true)}</div>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="profile-section">
        <h2 className="section-title">News ({articles.length})</h2>
        {articles.length === 0 ? (
          <div className="empty">No news articles for this company yet.</div>
        ) : (
          <div className="article-list">
            {articles.map((article) => (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="article-card"
              >
                <div className="article-meta">
                  <span className="article-source">{article.source}</span>
                  {article.importance && (
                    <span className={`importance-badge imp-${article.importance}`}>
                      {article.importance}
                    </span>
                  )}
                  {article.impact && (
                    <span className={`impact-badge impact-${article.impact}`}>
                      {impactLabel(article.impact)}
                    </span>
                  )}
                  <span className="article-time">{timeAgo(article.published_at)}</span>
                </div>
                <h3 className="article-title">{article.title}</h3>
                {article.ai_summary && (
                  <p className="article-ai-summary">{article.ai_summary}</p>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
