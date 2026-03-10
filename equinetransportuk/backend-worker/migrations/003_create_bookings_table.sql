CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  vehicle_id TEXT NOT NULL,

  pickup_at TEXT NOT NULL,
  dropoff_at TEXT NOT NULL,

  duration_days INTEGER,

  price_total REAL,
  paid_now REAL,

  extras_json TEXT,

  status TEXT DEFAULT 'pending',

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer
ON bookings(customer_id);

CREATE INDEX IF NOT EXISTS idx_bookings_vehicle
ON bookings(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_bookings_dates
ON bookings(pickup_at, dropoff_at);