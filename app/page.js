"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

function ArticleCard({ article, impactLabel, timeAgo, onDeepAnalyze, deepLoading, priceMap, isWatched }) {
  const [expanded, setExpanded] = useState(false);
  const hasAnalysis = article.ai_summary || article.importance;

  return (
    <div className={`article-card-wrapper${isWatched ? " watched" : ""}`}>
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="article-card"
      >
        <div className="article-meta">
          <span className="company-badge">
            {article.companies?.symbol}
          </span>
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
          <span className="article-source">{article.source}</span>
          {priceMap[article.companies?.symbol] && (
            <span className={`price-tag ${priceMap[article.companies.symbol].change >= 0 ? "price-up" : "price-down"}`}>
              ${priceMap[article.companies.symbol].price.toFixed(3)}
              {priceMap[article.companies.symbol].change != null && (
                <span> {priceMap[article.companies.symbol].change >= 0 ? "+" : ""}{priceMap[article.companies.symbol].change}%</span>
              )}
            </span>
          )}
          <span className="article-time">{timeAgo(article.published_at)}</span>
        </div>
        <h2 className="article-title">{article.title}</h2>
        {article.ai_summary && (
          <p className="article-ai-summary">{article.ai_summary}</p>
        )}
        {article.summary && !article.ai_summary && (
          <p className="article-summary">{article.summary}</p>
        )}
      </a>
      {hasAnalysis && (
        <div className="article-actions">
          {article.deep_analysis ? (
            <button
              className="btn-deep-toggle"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Hide" : "Deep Analysis"}
            </button>
          ) : (
            <button
              className="btn-deep-analyze"
              onClick={() => onDeepAnalyze(article.id)}
              disabled={deepLoading[article.id]}
            >
              {deepLoading[article.id] ? "Analyzing..." : "Deep Analyze"}
            </button>
          )}
        </div>
      )}
      {expanded && article.deep_analysis && (
        <div className="deep-analysis">
          {article.deep_analysis.split("\n\n").map((block, i) => {
            const boldMatch = block.match(/^\*\*(.*?)\*\*(.*)/);
            if (boldMatch) {
              return (
                <div key={i} className="deep-block">
                  <span className="deep-label">{boldMatch[1]}</span>
                  <span>{boldMatch[2]}</span>
                </div>
              );
            }
            return <div key={i} className="deep-block">{block}</div>;
          })}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [articles, setArticles] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState(null);
  const [deepLoading, setDeepLoading] = useState({});
  const [watchedIds, setWatchedIds] = useState([]);
  const [priceMap, setPriceMap] = useState({});
  const [fetchingPrices, setFetchingPrices] = useState(false);

  useEffect(() => {
    fetchCompanies();
    fetchWatchlist();
  }, []);

  useEffect(() => {
    fetchArticles();
  }, [filter, watchedIds]);

  async function fetchCompanies() {
    const { data } = await supabase
      .from("companies")
      .select("id, symbol, name, price, price_change_pct")
      .order("symbol");
    setCompanies(data || []);
    const map = {};
    (data || []).forEach((c) => {
      if (c.price) map[c.symbol] = { price: c.price, change: c.price_change_pct };
    });
    setPriceMap(map);
  }

  async function fetchWatchlist() {
    const { data } = await supabase
      .from("watched_companies")
      .select("company_id");
    setWatchedIds((data || []).map((w) => w.company_id));
  }

  async function fetchArticles() {
    setLoading(true);
    let query = supabase
      .from("articles")
      .select("*, companies(symbol, name)")
      .order("published_at", { ascending: false })
      .limit(50);

    if (filter === "watchlist") {
      query = query.in("company_id", watchedIds.length > 0 ? watchedIds : [0]);
    } else if (filter !== "all") {
      query = query.eq("company_id", filter);
    }

    const { data, error } = await query;
    if (!error) setArticles(data || []);
    setLoading(false);
  }

  async function handleFetchNews() {
    setFetching(true);
    setFetchResult(null);
    try {
      const res = await fetch("/api/fetch-news");
      const data = await res.json();
      setFetchResult(data);
      fetchArticles();
      fetchCompanies();
    } catch {
      setFetchResult({ error: "Failed to fetch" });
    }
    setFetching(false);
    setTimeout(() => setFetchResult(null), 5000);
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalyzeResult(null);
    try {
      const res = await fetch("/api/analyze-articles");
      const data = await res.json();
      setAnalyzeResult(data);
      fetchArticles();
    } catch {
      setAnalyzeResult({ error: "Failed to analyze" });
    }
    setAnalyzing(false);
    setTimeout(() => setAnalyzeResult(null), 8000);
  }

  async function handleDeepAnalyze(articleId) {
    setDeepLoading((prev) => ({ ...prev, [articleId]: true }));
    try {
      const res = await fetch("/api/deep-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId }),
      });
      const data = await res.json();
      if (data.ok) {
        setArticles((prev) =>
          prev.map((a) =>
            a.id === articleId ? { ...a, deep_analysis: data.analysis } : a
          )
        );
      }
    } catch {}
    setDeepLoading((prev) => ({ ...prev, [articleId]: false }));
  }

  async function handleFetchPrices() {
    setFetchingPrices(true);
    try {
      await fetch("/api/fetch-prices");
      fetchCompanies();
    } catch {}
    setFetchingPrices(false);
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
    <div className="feed">
      <div className="feed-header">
        <h1>Latest News</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Companies</option>
          <option value="watchlist">Watchlist</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.symbol} — {c.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleFetchNews}
          disabled={fetching}
          className="btn-fetch"
        >
          {fetching ? "..." : "Fetch"}
        </button>
        <button
          onClick={handleFetchPrices}
          disabled={fetchingPrices}
          className="btn-price"
        >
          {fetchingPrices ? "..." : "$"}
        </button>
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="btn-analyze"
        >
          {analyzing ? "..." : "AI"}
        </button>
      </div>
      {fetchResult && (
        <div className={`fetch-status ${fetchResult.error ? "error" : "success"}`}>
          {fetchResult.error
            ? fetchResult.error
            : `${fetchResult.articlesCreated} new articles, ${fetchResult.companiesCreated} new companies`}
        </div>
      )}
      {analyzeResult && (
        <div className={`fetch-status ${analyzeResult.error ? "error" : "success"}`}>
          {analyzeResult.error
            ? analyzeResult.error
            : `Analyzed ${analyzeResult.analyzed} articles with AI`}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading articles...</div>
      ) : articles.length === 0 ? (
        <div className="empty">
          <p>No articles yet. Add companies to your watchlist to start tracking news.</p>
        </div>
      ) : (
        <div className="article-list">
          {articles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              impactLabel={impactLabel}
              timeAgo={timeAgo}
              onDeepAnalyze={handleDeepAnalyze}
              deepLoading={deepLoading}
              priceMap={priceMap}
              isWatched={watchedIds.includes(article.company_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
