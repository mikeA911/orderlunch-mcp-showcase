CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS outlets (id text PRIMARY KEY, name text NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS menu_items (
  id text PRIMARY KEY, outlet_id text NOT NULL REFERENCES outlets(id), name text NOT NULL, description text NOT NULL DEFAULT '',
  price_minor integer NOT NULL CHECK (price_minor >= 0), currency text NOT NULL CHECK (currency = 'PHP'), available boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, project_id text NOT NULL, outlet_id text NOT NULL REFERENCES outlets(id),
  fulfilment text NOT NULL CHECK (fulfilment IN ('pickup', 'delivery')), currency text NOT NULL CHECK (currency = 'PHP'), items jsonb NOT NULL,
  total_minor integer NOT NULL CHECK (total_minor >= 0), quote_hash text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS payment_terms text NOT NULL DEFAULT 'pay_on_delivery';
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_payment_terms_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_payment_terms_check CHECK (payment_terms = 'pay_on_delivery');
CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid NOT NULL REFERENCES quotes(id), user_id text NOT NULL, project_id text NOT NULL,
  quote_hash text NOT NULL, outlet_id text NOT NULL, fulfilment text NOT NULL, total_minor integer NOT NULL, currency text NOT NULL,
  operation text NOT NULL CHECK (operation = 'place_order'), expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approved_by text;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS payment_terms text NOT NULL DEFAULT 'pay_on_delivery';
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_payment_terms_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_payment_terms_check CHECK (payment_terms = 'pay_on_delivery');
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid NOT NULL REFERENCES quotes(id), approval_id uuid NOT NULL UNIQUE REFERENCES approvals(id),
  idempotency_key text NOT NULL, user_id text NOT NULL, project_id text NOT NULL, outlet_id text NOT NULL, fulfilment text NOT NULL,
  currency text NOT NULL, items jsonb NOT NULL, total_minor integer NOT NULL,
  state text NOT NULL CHECK (state IN ('placed','preparing','ready','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, project_id, idempotency_key)
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_terms text NOT NULL DEFAULT 'pay_on_delivery';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_terms_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_terms_check CHECK (payment_terms = 'pay_on_delivery');
CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(), request_id text NOT NULL, user_id text NOT NULL,
  project_id text NOT NULL, action text NOT NULL, entity_type text NOT NULL, entity_id text, outcome text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS cancellation_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), user_id text NOT NULL, project_id text NOT NULL,
  expires_at timestamptz NOT NULL, confirmed_at timestamptz NOT NULL DEFAULT now(), confirmed_by text NOT NULL, consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotes_owner_idx ON quotes(project_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_owner_idx ON orders(project_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_scope_idx ON audit_events(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS cancellation_owner_idx ON cancellation_confirmations(project_id,user_id,created_at DESC);
INSERT INTO outlets(id, name) VALUES ('canteen-sim', 'EveryDay Canteen (Simulated)'), ('bento-sim', 'Builder Bento (Simulated)') ON CONFLICT (id) DO NOTHING;
INSERT INTO menu_items(id, outlet_id, name, description, price_minor, currency) VALUES
  ('canteen-adobo', 'canteen-sim', 'Chicken Adobo Rice', 'Simulated rice meal', 16500, 'PHP'),
  ('canteen-sinigang', 'canteen-sim', 'Sinigang Rice', 'Simulated soup and rice meal', 17500, 'PHP'),
  ('canteen-pancit', 'canteen-sim', 'Pancit', 'Simulated noodle meal', 12000, 'PHP'),
  ('bento-chicken', 'bento-sim', 'Chicken Bento', 'Simulated bento meal', 21000, 'PHP'),
  ('bento-tofu', 'bento-sim', 'Tofu Bento', 'Simulated vegetarian bento', 19000, 'PHP') ON CONFLICT (id) DO NOTHING;
