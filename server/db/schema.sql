-- ระบบเฝ้าระวังน้ำ — schema PostgreSQL
-- รันซ้ำได้ (idempotent)

-- ============ พนักงาน ============
CREATE TABLE IF NOT EXISTS employees (
  emp_code     VARCHAR(7) PRIMARY KEY,
  full_name    TEXT NOT NULL,
  position     TEXT,
  department   VARCHAR(10),
  role         TEXT NOT NULL
               CHECK (role IN ('staff','technician','engineer','admin')),
  is_admin     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ การผูกบัญชี LINE ============
CREATE TABLE IF NOT EXISTS user_line_links (
  line_user_id   TEXT PRIMARY KEY,
  emp_code       VARCHAR(7) NOT NULL UNIQUE REFERENCES employees(emp_code),
  display_name   TEXT,
  is_oa_friend   BOOLEAN NOT NULL DEFAULT FALSE,
  notify_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  linked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

-- ============ session ============
-- ไม่ได้อยู่ในสเปคเดิม แต่จำเป็นเพื่อให้เพิกถอน session ได้ทันที
-- เมื่อ admin ปิดใช้งานพนักงานหรือยกเลิกการผูก LINE
CREATE TABLE IF NOT EXISTS sessions (
  sid          TEXT PRIMARY KEY,
  emp_code     VARCHAR(7) REFERENCES employees(emp_code),
  line_user_id TEXT,
  pending_link BOOLEAN NOT NULL DEFAULT FALSE,
  admin_until  TIMESTAMPTZ,
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_emp_idx ON sessions (emp_code);
CREATE INDEX IF NOT EXISTS sessions_exp_idx ON sessions (expires_at);

-- ============ บ่อ ============
CREATE TABLE IF NOT EXISTS ponds (
  pond_id     VARCHAR(8) PRIMARY KEY,
  name        TEXT NOT NULL,
  capacity_m3 NUMERIC(10,2),
  sort_order  INT,
  role_note   TEXT,
  src_note    TEXT,
  dst_note    TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============ PLC (เครื่อง Modbus TCP แต่ละตัวในสนาม — จุดวัดคนละตัวใช้คนละ PLC ได้) ============
CREATE TABLE IF NOT EXISTS plcs (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  host       TEXT NOT NULL,
  port       INT NOT NULL DEFAULT 502,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT
);
CREATE UNIQUE INDEX IF NOT EXISTS plcs_host_port_idx ON plcs (host, port);
-- ดึงค่าจาก PLC ตัวนี้ทุกกี่วินาที ปรับได้ต่อ PLC จากหน้าเว็บ (ไม่ต้องรีสตาร์ตเซิร์ฟเวอร์)
ALTER TABLE plcs ADD COLUMN IF NOT EXISTS poll_sec INT NOT NULL DEFAULT 1;

-- ============ บัญชี MongoDB Atlas (เพิ่ม/แก้/ลบได้จากหน้าเว็บ — รองรับหลายคลัสเตอร์/แอคเคาท์พร้อมกัน) ============
-- uri เก็บ connection string เต็ม (มี credential ฝังอยู่) จึงไม่คืนค่านี้กลับไปที่หน้าเว็บ ส่งแค่ id/name/is_active
CREATE TABLE IF NOT EXISTS mongo_accounts (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  uri        TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT
);

-- ============ จุดวัด ============
CREATE TABLE IF NOT EXISTS sensors (
  tag          VARCHAR(20) PRIMARY KEY,
  pond_id      VARCHAR(8) REFERENCES ponds(pond_id),
  name         TEXT,
  metric       TEXT NOT NULL,
  unit         TEXT NOT NULL,
  range_min    NUMERIC(10,3),
  range_max    NUMERIC(10,3),
  ll           NUMERIC(10,3),
  hh           NUMERIC(10,3),
  ll_critical  NUMERIC(10,3),
  hh_critical  NUMERIC(10,3),
  debounce_sec INT NOT NULL DEFAULT 60,
  decimals     SMALLINT NOT NULL DEFAULT 1,
  sort_order   INT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============ ค่าที่วัดได้ (partition รายเดือน) ============
CREATE TABLE IF NOT EXISTS readings (
  ts      TIMESTAMPTZ NOT NULL,
  tag     VARCHAR(20) NOT NULL REFERENCES sensors(tag),
  value   NUMERIC(10,3) NOT NULL,
  quality SMALLINT NOT NULL DEFAULT 1,
  PRIMARY KEY (tag, ts)
) PARTITION BY RANGE (ts);

CREATE INDEX IF NOT EXISTS readings_ts_idx ON readings (ts DESC);

-- ============ ค่ารายชั่วโมง ============
CREATE TABLE IF NOT EXISTS readings_hourly (
  bucket  TIMESTAMPTZ NOT NULL,
  tag     VARCHAR(20) NOT NULL REFERENCES sensors(tag),
  min_val NUMERIC(10,3),
  max_val NUMERIC(10,3),
  avg_val NUMERIC(10,3),
  n       INT,
  PRIMARY KEY (tag, bucket)
);

-- ============ แจ้งเตือน ============
CREATE TABLE IF NOT EXISTS alarms (
  id               BIGSERIAL PRIMARY KEY,
  tag              VARCHAR(20) NOT NULL REFERENCES sensors(tag),
  severity         TEXT NOT NULL CHECK (severity IN ('warning','critical')),
  condition        TEXT NOT NULL,
  trigger_value    NUMERIC(10,3),
  threshold        NUMERIC(10,3),
  raised_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_at       TIMESTAMPTZ,
  acked_at         TIMESTAMPTZ,
  acked_by         VARCHAR(7) REFERENCES employees(emp_code),
  ack_note         TEXT,
  last_notified_at TIMESTAMPTZ,
  notify_count     INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS alarms_raised_idx ON alarms (raised_at DESC);
CREATE INDEX IF NOT EXISTS alarms_open_idx ON alarms (cleared_at) WHERE cleared_at IS NULL;
-- แจ้งเตือนที่ยังไม่คืนสภาพ ต้องมีได้ครั้งละหนึ่งรายการต่อ tag+condition
CREATE UNIQUE INDEX IF NOT EXISTS alarms_open_unique
  ON alarms (tag, condition) WHERE cleared_at IS NULL;

-- ============ ประวัติการส่ง LINE ============
CREATE TABLE IF NOT EXISTS notification_log (
  id           BIGSERIAL PRIMARY KEY,
  alarm_id     BIGINT REFERENCES alarms(id),
  emp_code     VARCHAR(7) REFERENCES employees(emp_code),
  channel      TEXT NOT NULL DEFAULT 'line',
  kind         TEXT NOT NULL DEFAULT 'raise',
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL,
  error_detail TEXT
);
CREATE INDEX IF NOT EXISTS notification_log_sent_idx ON notification_log (sent_at DESC);

-- ============ ประวัติการ export ============
CREATE TABLE IF NOT EXISTS export_log (
  id         BIGSERIAL PRIMARY KEY,
  emp_code   VARCHAR(7) NOT NULL REFERENCES employees(emp_code),
  dataset    TEXT NOT NULL,
  range_from TIMESTAMPTZ,
  range_to   TIMESTAMPTZ,
  row_count  INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ audit log ============
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  emp_code   VARCHAR(7),
  action     TEXT NOT NULL,
  target     TEXT,
  old_value  JSONB,
  new_value  JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);

-- ============ การอ่านค่าผ่าน Modbus TCP ============
-- แยกเป็น ALTER เพื่อให้ฐานข้อมูลที่ติดตั้งไปแล้วอัปเกรดได้โดยไม่ต้องสร้างใหม่
-- จุดวัดแต่ละอันอ้างอิง PLC ที่ตัวเองต่ออยู่ได้คนละตัว (บางจุดวัดใช้คนละ PLC)
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS plc_id           INT REFERENCES plcs(id);
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS modbus_address   INT;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS modbus_unit_id   SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS modbus_fc        SMALLINT NOT NULL DEFAULT 3;
-- uint16 | int16 | uint32 | int32 | float32  (แบบ 32 บิตใช้ 2 register)
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS modbus_data_type TEXT NOT NULL DEFAULT 'uint16';
-- ค่าจริง = ค่าดิบจาก register × scale + offset
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS modbus_scale     NUMERIC(12,6) NOT NULL DEFAULT 1;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS modbus_offset    NUMERIC(12,6) NOT NULL DEFAULT 0;
-- PLC บางรุ่นเรียง word ของค่า 32 บิตกลับด้าน
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS modbus_word_swap BOOLEAN NOT NULL DEFAULT FALSE;

-- จุดวัดส่วนใหญ่อ่านผ่าน PLC (modbus) แต่บางจุดรับค่าจากแหล่งอื่นแทน เช่น MongoDB Atlas (real-time change stream)
-- ตรวจสอบค่าที่ยอมรับได้ในโค้ด (server/routes/sensors.js) ไม่ใช้ CHECK constraint เพื่อให้เพิ่มแหล่งใหม่ได้โดยไม่ต้อง migrate
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'modbus';
-- ใช้เมื่อ data_source = 'mongodb' — เลือกได้ว่าจะอ่านจากบัญชี/คลัสเตอร์ไหน (ตาราง mongo_accounts รองรับหลายบัญชี)
-- แล้วเลือก database/collection ในคลัสเตอร์นั้นได้จากหน้าเว็บ
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS mongo_account_id INT REFERENCES mongo_accounts(id);
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS mongo_db         TEXT;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS mongo_collection TEXT;
-- ดึงค่าล่าสุดจาก collection นี้ทุกกี่วินาที ปรับได้จากหน้าเว็บต่อจุดวัด
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS mongo_poll_sec   INT NOT NULL DEFAULT 5;

-- ============ ค่าตั้งระบบ ============
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by VARCHAR(7)
);
