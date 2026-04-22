"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Watchlist() {
  const [companies, setCompanies] = useState([]);
  const [allCompanies, setAllCompanies] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWatchlist();
    fetchAllCompanies();
  }, []);

  async function fetchWatchlist() {
    setLoading(true);
    const { data } = await supabase
      .from("watched_companies")
      .select("*, companies(*)")
      .order("added_at", { ascending: false });
    setCompanies(data || []);
    setLoading(false);
  }

  async function fetchAllCompanies() {
    const { data } = await supabase
      .from("companies")
      .select("*")
      .order("symbol");
    setAllCompanies(data || []);
  }

  async function addToWatchlist(companyId) {
    await supabase.from("watched_companies").insert({ company_id: companyId });
    fetchWatchlist();
  }

  async function removeFromWatchlist(companyId) {
    await supabase
      .from("watched_companies")
      .delete()
      .eq("company_id", companyId);
    fetchWatchlist();
  }

  const watchedIds = new Set(companies.map((w) => w.company_id));
  const filtered = allCompanies.filter(
    (c) =>
      !watchedIds.has(c.id) &&
      (c.symbol.toLowerCase().includes(search.toLowerCase()) ||
        c.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="watchlist-page">
      <h1>Watchlist</h1>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <>
          <div className="watchlist-grid">
            {companies.map((w) => (
              <div key={w.id} className="watchlist-card">
                <div className="watchlist-card-header">
                  <a href={`/company/${w.companies.symbol}`} className="symbol-link">
                    {w.companies.symbol}
                  </a>
                  <button
                    className="btn-remove"
                    onClick={() => removeFromWatchlist(w.company_id)}
                  >
                    ✕
                  </button>
                </div>
                <div className="company-name">{w.companies.name}</div>
                {w.companies.sector && (
                  <div className="company-sector">{w.companies.sector}</div>
                )}
              </div>
            ))}
          </div>

          {companies.length === 0 && (
            <div className="empty">
              <p>Your watchlist is empty. Search and add TSXV companies below.</p>
            </div>
          )}

          <div className="add-section">
            <h2>Add Company</h2>
            <input
              type="text"
              placeholder="Search by symbol or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="search-input"
            />
            {search && filtered.length > 0 && (
              <div className="search-results">
                {filtered.slice(0, 10).map((c) => (
                  <div key={c.id} className="search-result-row">
                    <span className="result-symbol">{c.symbol}</span>
                    <span className="result-name">{c.name}</span>
                    <button
                      className="btn-add"
                      onClick={() => addToWatchlist(c.id)}
                    >
                      + Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
