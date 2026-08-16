ALTER TABLE booking_forms
ADD COLUMN driver_number INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_forms_booking_driver
ON booking_forms(booking_id, driver_number);

CREATE TABLE IF NOT EXISTS booking_driver_links (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  driver_number INTEGER NOT NULL CHECK (driver_number = 2),
  driver_name TEXT,
  driver_email TEXT NOT NULL,
  form_type TEXT NOT NULL DEFAULT 'long',
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  delivery_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT,
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (booking_id, driver_number)
);

CREATE INDEX IF NOT EXISTS idx_booking_driver_links_booking
ON booking_driver_links(booking_id);

CREATE INDEX IF NOT EXISTS idx_booking_driver_links_token
ON booking_driver_links(token_hash);
