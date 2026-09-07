-- HostelHub PostgreSQL Schema (Supabase)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE,
  phone VARCHAR(20) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'seeker' CHECK (role IN ('seeker','owner','agent','admin')),
  is_verified BOOLEAN DEFAULT FALSE,
  is_kyc_verified BOOLEAN DEFAULT FALSE,
  kyc_doc_path VARCHAR(255),
  kyc_selfie_path VARCHAR(255),
  otp_code VARCHAR(10),
  otp_expires_at TIMESTAMPTZ,
  reset_token VARCHAR(100),
  reset_expires_at TIMESTAMPTZ,
  wallet_balance NUMERIC(10,2) DEFAULT 0.00,
  is_suspended BOOLEAN DEFAULT FALSE,
  violation_count INT DEFAULT 0,
  avatar VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
  owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  occupancy_type SMALLINT NOT NULL,
  original_price NUMERIC(10,2) NOT NULL,
  listed_price NUMERIC(10,2) NOT NULL,
  price_per_head NUMERIC(10,2) NOT NULL,
  location_area VARCHAR(200) NOT NULL,
  location_lat NUMERIC(10,8),
  location_lng NUMERIC(11,8),
  nearest_landmark VARCHAR(200),
  gender_preference VARCHAR(10) DEFAULT 'mixed' CHECK (gender_preference IN ('male','female','mixed')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','expired','deactivated')),
  rejection_reason TEXT,
  is_featured BOOLEAN DEFAULT FALSE,
  views_count INT DEFAULT 0,
  interest_count INT DEFAULT 0,
  expires_at DATE,
  move_in_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listing_images (
  id SERIAL PRIMARY KEY,
  listing_id INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  image_path VARCHAR(255) NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  sort_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS amenities (
  id SERIAL PRIMARY KEY,
  listing_id INT UNIQUE NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  water VARCHAR(20) DEFAULT 'none' CHECK (water IN ('constant','intermittent','borehole','none')),
  electricity VARCHAR(20) DEFAULT 'none' CHECK (electricity IN ('prepaid','postpaid','generator','none')),
  security VARCHAR(20) DEFAULT 'none' CHECK (security IN ('fenced','gated','guard','cctv','none')),
  furnishing VARCHAR(20) DEFAULT 'unfurnished' CHECK (furnishing IN ('furnished','semi-furnished','unfurnished')),
  bathroom VARCHAR(10) DEFAULT 'shared' CHECK (bathroom IN ('private','shared')),
  kitchen_access BOOLEAN DEFAULT FALSE,
  wifi BOOLEAN DEFAULT FALSE,
  parking BOOLEAN DEFAULT FALSE,
  pet_friendly BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS contact_requests (
  id SERIAL PRIMARY KEY,
  uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
  listing_id INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  seeker_id INT REFERENCES users(id) ON DELETE SET NULL,
  seeker_name VARCHAR(100) NOT NULL,
  seeker_phone VARCHAR(20),
  seeker_email VARCHAR(150),
  move_in_date DATE,
  message TEXT,
  status VARCHAR(20) DEFAULT 'received' CHECK (status IN ('received','in_progress','connected','closed')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
  contact_request_id INT NOT NULL REFERENCES contact_requests(id),
  listing_id INT NOT NULL REFERENCES listings(id),
  owner_id INT NOT NULL REFERENCES users(id),
  total_amount NUMERIC(10,2) NOT NULL,
  platform_fee NUMERIC(10,2) NOT NULL,
  owner_commission NUMERIC(10,2) NOT NULL,
  payment_method VARCHAR(30) NOT NULL,
  payment_ref VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payout_requests (
  id SERIAL PRIMARY KEY,
  owner_id INT NOT NULL REFERENCES users(id),
  amount NUMERIC(10,2) NOT NULL,
  payment_method VARCHAR(30) NOT NULL,
  account_number VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  admin_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  listing_id INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reviewer_id INT NOT NULL REFERENCES users(id),
  contact_request_id INT NOT NULL REFERENCES contact_requests(id),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (contact_request_id, reviewer_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_id INT REFERENCES users(id) ON DELETE SET NULL,
  listing_id INT REFERENCES listings(id) ON DELETE CASCADE,
  reported_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(30) NOT NULL CHECK (reason IN ('contact_info','scam','inappropriate','fake','other')),
  details TEXT,
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id SERIAL PRIMARY KEY,
  admin_id INT NOT NULL REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('user','listing','request','transaction','payout')),
  target_id INT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  link VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_listings_updated BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_requests_updated BEFORE UPDATE ON contact_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Default admin (password: Admin@1234 — bcrypt hash)
INSERT INTO users (name, email, password_hash, role, is_verified, is_kyc_verified)
VALUES ('Platform Admin', 'admin@hostels.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', TRUE, TRUE)
ON CONFLICT (email) DO NOTHING;
