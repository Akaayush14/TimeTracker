-- ==========================
-- Updated Time Tracker Database with Admin Support
-- ==========================

DROP DATABASE IF EXISTS time_tracker;
CREATE DATABASE time_tracker CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
USE time_tracker;

-- ====== users ======
CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(200) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME NULL,
  deactivated_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed sample user (password: password123)
INSERT INTO users (id, full_name, email, password, is_active)
VALUES (1001, 'Aayush Kharel', 'aayush@example.com', 'password123', 1)
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), email = VALUES(email), password = VALUES(password);

-- Seed admin user (password: admin123)
INSERT INTO users (id, full_name, email, password, is_admin, is_active)
VALUES (1, 'System Admin', 'admin@timetracker.com', 'admin123', 1, 1)
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), email = VALUES(email), password = VALUES(password), is_admin = VALUES(is_admin);

-- ====== sessions ======
CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT NOT NULL PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  login_time DATETIME NOT NULL,
  logout_time DATETIME NULL,
  total_work_seconds BIGINT NOT NULL DEFAULT 0,
  total_break_seconds BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ====== activity ======
CREATE TABLE IF NOT EXISTS activity (
  id BIGINT NOT NULL PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  session_id BIGINT NOT NULL,
  ts DATETIME NOT NULL,
  is_idle TINYINT(1) NOT NULL DEFAULT 0,
  is_break TINYINT(1) NOT NULL DEFAULT 0,
  screenshot_path VARCHAR(500) NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_activity_user ON activity(user_id);
CREATE INDEX idx_activity_session ON activity(session_id);
CREATE INDEX idx_activity_ts ON activity(ts);

-- ====== breaks ======
CREATE TABLE IF NOT EXISTS breaks (
  id BIGINT NOT NULL PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  session_id BIGINT NOT NULL,
  break_type ENUM('manual','idle','other') NOT NULL DEFAULT 'other',
  start_ts DATETIME NOT NULL,
  end_ts DATETIME NULL,
  duration_seconds BIGINT NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_breaks_user ON breaks(user_id);
CREATE INDEX idx_breaks_session ON breaks(session_id);
CREATE INDEX idx_breaks_type ON breaks(break_type);

SELECT id, full_name, email, is_admin, is_active FROM users WHERE email = 'admin@timetracker.com';
SELECT id, full_name, email, is_admin FROM users WHERE email = 'your-admin-email';
SELECT id, full_name, email, is_admin, is_active 
FROM users 
WHERE email = 'admin@timetracker.com';