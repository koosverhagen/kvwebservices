ALTER TABLE bookings ADD COLUMN customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_customer
ON bookings(customer_id);