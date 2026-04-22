"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function CompanyPage() {
  const { symbol } = useParams();
  const [company, setCompany] = useState(null);
  const [articles, setArticles] = useState([]);
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

  if (loading) return <div className="loading">Loading...</div>;
  if (!company) return <div className="empty">Company not found.</div>;

  return (
    <div className="company-page">
      <div className="company-header">
        <h1>
          {company.symbol}{" "}
          <span className="company-name-inline">{company.name}</span>
        </h1>
        {company.sector && (
          <div className="company-sector">{company.sector}</div>
        )}
        {company.description && (
          <p className="company-desc">{company.description}</p>
        )}
        {company.website_url && (
          <a
            href={company.website_url}
            target="_blank"
            rel="noopener noreferrer"
            className="company-link"
          >
            Website →
          </a>
        )}
      </div>

      <h2 className="section-title">News</h2>
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
                <span className="article-time">{formatDate(article.published_at)}</span>
              </div>
              <h3 className="article-title">{article.title}</h3>
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
