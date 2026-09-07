-- Hostels Marketplace Database Schema
CREATE DATABASE IF NOT EXISTS hostels_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hostels_db;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE,
  phone VARCHAR(20) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('seeker','owner','agent','admin') DEFAULT 'seeker',
  is_verified TINYINT(1) DEFAULT 0,
  is_kyc_verified TINYINT(1) DEFAULT 0,
  kyc_doc_path VARCHAR(255),
  kyc_selfie_path VARCHAR(255),
  otp_code VARCHAR(10),
  otp_expires_at DATETIME,
  reset_token VARCHAR(100),
  reset_expires_at DATETIME,
  wallet_balance DECIMAL(10,2) DEFAULT 0.00,
  is_suspended TINYINT(1) DEFAULT 0,
  violation_count INT DEFAULT 0,
  avatar VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE listings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) UNIQUE NOT NULL,
  owner_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  occupancy_type TINYINT NOT NULL COMMENT '1=1in1, 2=2in1, etc.',
  original_price DECIMAL(10,2) NOT NULL,
  listed_price DECIMAL(10,2) NOT NULL COMMENT 'original + 10%',
  price_per_head DECIMAL(10,2) NOT NULL,
  location_area VARCHAR(200) NOT NULL,
  location_lat DECIMAL(10,8),
  location_lng DECIMAL(11,8),
  nearest_landmark VARCHAR(200),
  gender_preference ENUM('male','female','mixed') DEFAULT 'mixed',
  status ENUM('pending','active','rejected','expired','deactivated') DEFAULT 'pending',
  rejection_reason TEXT,
  is_featured TINYINT(1) DEFAULT 0,
  views_count INT DEFAULT 0,
  interest_count INT DEFAULT 0,
  expires_at DATE,
  move_in_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE listing_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  listing_id INT NOT NULL,
  image_path VARCHAR(255) NOT NULL,
  is_primary TINYINT(1) DEFAULT 0,
  sort_order INT DEFAULT 0,
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

CREATE TABLE amenities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  listing_id INT UNIQUE NOT NULL,
  water ENUM('constant','intermittent','borehole','none') DEFAULT 'none',
  electricity ENUM('prepaid','postpaid','generator','none') DEFAULT 'none',
  security ENUM('fenced','gated','guard','cctv','none') DEFAULT 'none',
  furnishing ENUM('furnished','semi-furnished','unfurnished') DEFAULT 'unfurnished',
  bathroom ENUM('private','shared') DEFAULT 'shared',
  kitchen_access TINYINT(1) DEFAULT 0,
  wifi TINYINT(1) DEFAULT 0,
  parking TINYINT(1) DEFAULT 0,
  pet_friendly TINYINT(1) DEFAULT 0,
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

CREATE TABLE contact_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) UNIQUE NOT NULL,
  listing_id INT NOT NULL,
  seeker_id INT,
  seeker_name VARCHAR(100) NOT NULL,
  seeker_phone VARCHAR(20),
  seeker_email VARCHAR(150),
  move_in_date DATE,
  message TEXT,
  status ENUM('received','in_progress','connected','closed') DEFAULT 'received',
  admin_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  FOREIGN KEY (seeker_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) UNIQUE NOT NULL,
  contact_request_id INT NOT NULL,
  listing_id INT NOT NULL,
  owner_id INT NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  platform_fee DECIMAL(10,2) NOT NULL,
  owner_commission DECIMAL(10,2) NOT NULL,
  payment_method ENUM('momo_mtn','momo_vodafone','momo_airteltigo','card') NOT NULL,
  payment_ref VARCHAR(100),
  status ENUM('pending','completed','failed','refunded') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_request_id) REFERENCES contact_requests(id),
  FOREIGN KEY (listing_id) REFERENCES listings(id),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE payout_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method ENUM('momo_mtn','momo_vodafone','momo_airteltigo','bank') NOT NULL,
  account_number VARCHAR(50) NOT NULL,
  status ENUM('pending','approved','paid','rejected') DEFAULT 'pending',
  admin_note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  listing_id INT NOT NULL,
  reviewer_id INT NOT NULL,
  contact_request_id INT NOT NULL,
  rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_review (contact_request_id, reviewer_id),
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id),
  FOREIGN KEY (contact_request_id) REFERENCES contact_requests(id)
);

CREATE TABLE favorites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  listing_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_fav (user_id, listing_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

CREATE TABLE reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT,
  listing_id INT,
  reported_user_id INT,
  reason ENUM('contact_info','scam','inappropriate','fake','other') NOT NULL,
  details TEXT,
  status ENUM('open','reviewed','resolved') DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE admin_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type ENUM('user','listing','request','transaction','payout') NOT NULL,
  target_id INT NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id)
);

CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  is_read TINYINT(1) DEFAULT 0,
  link VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Default admin user (password: Admin@1234)
INSERT INTO users (uuid, name, email, password_hash, role, is_verified, is_kyc_verified)
VALUES (UUID(), 'Platform Admin', 'admin@hostels.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', 1, 1);
