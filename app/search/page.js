"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function SearchContent() {
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q") || "";
  const [query, setQuery] = useState(initialQ);
  const [articles, setArticles] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setArticles([]);
      setCompanies([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setArticles(data.articles || []);
        setCompanies(data.companies || []);
      } catch {}
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  return (
    <div className="search-page">
      <h1>Search</h1>
      <input
        type="text"
        placeholder="Search articles, companies, commodities..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="search-main-input"
        autoFocus
      />

      {loading && <div className="loading">Searching...</div>}

      {!loading && companies.length > 0 && (
        <div className="search-section">
          <h2>Companies</h2>
          <div className="search-companies">
            {companies.map((c) => (
              <a
                key={c.id}
                href={`/company/${c.symbol}`}
                className="search-company-card"
              >
                <span className="search-company-symbol">{c.symbol}</span>
                <span className="search-company-name">{c.name}</span>
                {c.commodity && (
                  <span className="search-company-commodity">{c.commodity}</span>
                )}
                {c.price && (
                  <span className="search-company-price">
                    ${c.price.toFixed(2)}
                    {c.price_change_pct != null && (
                      <span className={c.price_change_pct >= 0 ? "price-up" : "price-down"}>
                        {" "}{c.price_change_pct >= 0 ? "+" : ""}{c.price_change_pct}%
                      </span>
                    )}
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {!loading && articles.length > 0 && (
        <div className="search-section">
          <h2>Articles ({articles.length})</h2>
          <div className="article-list">
            {articles.map((a) => (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="article-card"
              >
                <div className="article-meta">
                  <span className="company-badge">{a.companies?.symbol}</span>
                  {a.importance && (
                    <span className={`importance-badge imp-${a.importance}`}>
                      {a.importance}
                    </span>
                  )}
                  <span className="article-source">{a.source}</span>
                  <span className="article-time">{timeAgo(a.published_at)}</span>
                </div>
                <h3 className="article-title">{a.title}</h3>
                {a.ai_summary && (
                  <p className="article-ai-summary">{a.ai_summary}</p>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {!loading && query.length >= 2 && articles.length === 0 && companies.length === 0 && (
        <div className="empty">No results found for &quot;{query}&quot;</div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="loading">Loading...</div>}>
      <SearchContent />
    </Suspense>
  );
}
