"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Home() {
  const [articles, setArticles] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState(null);

  useEffect(() => {
    fetchCompanies();
  }, []);

  useEffect(() => {
    fetchArticles();
  }, [filter]);

  async function fetchCompanies() {
    const { data } = await supabase
      .from("companies")
      .select("id, symbol, name")
      .order("symbol");
    setCompanies(data || []);
  }

  async function fetchArticles() {
    setLoading(true);
    let query = supabase
      .from("articles")
      .select("*, companies(symbol, name)")
      .order("published_at", { ascending: false })
      .limit(50);

    if (filter !== "all") {
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
          {fetching ? "Fetching..." : "Fetch News"}
        </button>
      </div>
      {fetchResult && (
        <div className={`fetch-status ${fetchResult.error ? "error" : "success"}`}>
          {fetchResult.error
            ? fetchResult.error
            : `${fetchResult.articlesCreated} new articles, ${fetchResult.companiesCreated} new companies`}
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
            <a
              key={article.id}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="article-card"
            >
              <div className="article-meta">
                <span className="company-badge">
                  {article.companies?.symbol}
                </span>
                <span className="article-source">{article.source}</span>
                <span className="article-time">{timeAgo(article.published_at)}</span>
              </div>
              <h2 className="article-title">{article.title}</h2>
              {article.summary && (
                <p className="article-summary">{article.summary}</p>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
