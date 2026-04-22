"use client";

import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="nav-inner">
        <Link href="/" className="logo">
          TSXV<span className="logo-accent">News</span>
        </Link>
        <div className="nav-links">
          <Link href="/">Feed</Link>
          <Link href="/watchlist">Watchlist</Link>
        </div>
      </div>
    </nav>
  );
}
