CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT,
  mobile TEXT,
  notes TEXT DEFAULT '',
  hire_count INTEGER DEFAULT 0,
  first_hire_at TEXT,
  last_hire_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email
ON customers(email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_mobile
ON customers(mobile);

CREATE INDEX IF NOT EXISTS idx_customers_last_hire
ON customers(last_hire_at);