"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Navbar() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();

  function handleSearch(e) {
    e.preventDefault();
    if (query.trim().length >= 2) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
      setQuery("");
      setSearchOpen(false);
    }
  }

  return (
    <nav className="navbar">
      <div className="nav-inner">
        <Link href="/" className="logo">
          TSXV<span className="logo-accent">News</span>
        </Link>
        <div className="nav-links">
          <Link href="/">Feed</Link>
          <Link href="/watchlist">Watchlist</Link>
          <button
            className="nav-search-btn"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            Search
          </button>
        </div>
      </div>
      {searchOpen && (
        <div className="nav-search-bar">
          <form onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="Search articles, companies, commodities..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="nav-search-input"
              autoFocus
            />
          </form>
        </div>
      )}
    </nav>
  );
}
