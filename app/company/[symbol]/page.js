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

  function formatNumber(n) {
    if (!n) return "—";
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
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
        <div className="profile-name">{company.name}</div>
        <div className="profile-tags">
          {company.sector && <span className="profile-tag">{company.sector}</span>}
          {company.commodity && <span className="profile-tag">{company.commodity}</span>}
          {company.region && <span className="profile-tag">{company.region}</span>}
          <span className="profile-tag">TSXV</span>
        </div>
      </div>

      <div className="profile-stats">
        <div className="stat-card">
          <div className="stat-label">Market Cap</div>
          <div className="stat-value">{company.market_cap ? `$${formatNumber(company.market_cap)}` : "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Shares Out</div>
          <div className="stat-value">{formatNumber(company.shares_outstanding)}</div>
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

      {company.description && (
        <div className="profile-section">
          <h2 className="section-title">About</h2>
          <p className="profile-desc">{company.description}</p>
        </div>
      )}

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
                  <div className="peer-mcap">MCap: ${formatNumber(p.market_cap)}</div>
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
