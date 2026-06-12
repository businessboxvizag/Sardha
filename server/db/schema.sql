-- Business Wheels — PostgreSQL Schema
-- Run: psql $DATABASE_URL -f db/schema.sql

-- Enable PostGIS for geo queries (install if needed: CREATE EXTENSION IF NOT EXISTS postgis)
-- We use a simple point column instead of PostGIS for portability
-- to switch to PostGIS, change POINT columns to GEOGRAPHY(POINT, 4326)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

/* ======================== USERS ======================== */
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT UNIQUE NOT NULL,
  phone       TEXT,
  password_hash TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('customer', 'merchant', 'admin')),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

/* ======================== VENDORS ======================== */
CREATE TABLE IF NOT EXISTS vendors (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  category    TEXT,
  area        TEXT,
  rating      NUMERIC(3,1) DEFAULT 0,
  lat         NUMERIC(10,7),
  lng         NUMERIC(10,7),
  prep_mins   INT DEFAULT 15,
  img         TEXT DEFAULT '🏪',
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

/* ======================== PRODUCTS ======================== */
CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id   UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  price       NUMERIC(10,2) NOT NULL,
  unit        TEXT DEFAULT 'piece',
  available   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

/* ======================== RIDERS ======================== */
CREATE TABLE IF NOT EXISTS riders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  phone           TEXT,
  vehicle         TEXT DEFAULT 'Bike',
  status          TEXT DEFAULT 'offline' CHECK (status IN ('available','on_delivery','offline')),
  lat             NUMERIC(10,7),
  lng             NUMERIC(10,7),
  shift           TEXT,
  deliveries_today INT DEFAULT 0,
  rating          NUMERIC(3,1) DEFAULT 5.0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

/* ======================== CUSTOMERS ======================== */
CREATE TABLE IF NOT EXISTS customers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  address     TEXT,
  lat         NUMERIC(10,7),
  lng         NUMERIC(10,7),
  joined      DATE DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

/* ======================== ORDERS ======================== */
CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id     UUID NOT NULL REFERENCES customers(id),
  vendor_id       UUID NOT NULL REFERENCES vendors(id),
  rider_id        UUID REFERENCES riders(id),
  status          TEXT NOT NULL DEFAULT 'PLACED'
                    CHECK (status IN ('PLACED','ACCEPTED','ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
  subtotal        NUMERIC(10,2) NOT NULL,
  delivery_fee    NUMERIC(10,2) DEFAULT 25,
  total           NUMERIC(10,2) NOT NULL,
  payment_status  TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded')),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  deliver_to      TEXT,
  deliver_lat     NUMERIC(10,7),
  deliver_lng     NUMERIC(10,7),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

/* ======================== ORDER ITEMS ======================== */
CREATE TABLE IF NOT EXISTS order_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  price       NUMERIC(10,2) NOT NULL,
  qty         INT NOT NULL CHECK (qty > 0)
);

/* ======================== ORDER HISTORY ======================== */
CREATE TABLE IF NOT EXISTS order_history (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id  UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status    TEXT NOT NULL,
  note      TEXT,
  at        TIMESTAMPTZ DEFAULT NOW()
);

/* ======================== FAVORITES ======================== */
CREATE TABLE IF NOT EXISTS favorites (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  vendor_id   UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  PRIMARY KEY (customer_id, vendor_id)
);

/* ======================== INDEXES ======================== */
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_vendor   ON orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_orders_rider    ON orders(rider_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

/* ======================== AUTO-UPDATE updated_at ======================== */
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
