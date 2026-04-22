CREATE TABLE companies (
  id SERIAL PRIMARY KEY,
  symbol TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  sector TEXT,
  description TEXT,
  website_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE articles (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  summary TEXT,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_articles_company_id ON articles(company_id);
CREATE INDEX idx_articles_published_at ON articles(published_at DESC);
CREATE INDEX idx_articles_source ON articles(source);

CREATE TABLE watched_companies (
  id SERIAL PRIMARY KEY,
  company_id INTEGER UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW()
);
