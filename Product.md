# Water Monitoring System — Product.md

ระบบเฝ้าระวังน้ำ 7 บ่อ พร้อมระบบผู้ใช้ ฐานข้อมูล และการแจ้งเตือนผ่าน LINE

เอกสารนี้เป็นข้อกำหนดสำหรับพัฒนาแอปจริง ต่อยอดจาก prototype หน้าจอ `water-monitoring-dashboard-v13.html`

---

## 1. ภาพรวมระบบ

| ส่วน | เทคโนโลยี |
|---|---|
| Frontend | Web app (responsive) ใช้ได้ทั้งคอมและมือถือ |
| Backend | REST API |
| ฐานข้อมูล | **PostgreSQL** |
| ยืนยันตัวตน | **LINE Login** + รหัสพนักงาน |
| แจ้งเตือน | **LINE Official Account (OA)** Messaging API |
| แหล่งข้อมูลวัด | PLC / Sensor gateway → API → PostgreSQL |

**หลักการ:** พนักงานล็อกอินด้วย LINE ที่ใช้อยู่แล้ว ผูกกับรหัสพนักงานหนึ่งครั้ง จากนั้นเข้าใช้งานได้เลย และรับแจ้งเตือนผ่าน LINE ตัวเดียวกัน

---

## 2. ผู้ใช้และสิทธิ์

### 2.1 ระดับสิทธิ์

| ระดับ | ตำแหน่ง | จำนวน | สิทธิ์เพิ่มจากระดับล่าง |
|---|---|---|---|
| `admin` | ผู้ดูแลระบบ | ตามที่กำหนด | จัดการพนักงาน สิทธิ์ ค่า setpoint และดู audit log |
| `engineer` | วิศวกร, วิศวกร 4 | 5 | **Export CSV** ตั้งค่าแจ้งเตือน ปิดการแจ้งเตือน |
| `technician` | ช่างเทคนิค, ช่างไฟฟ้า, ช่างเครื่องกล | 16 | รับทราบการแจ้งเตือน บันทึกหมายเหตุ |
| `staff` | พนักงานข้อมูลซ่อมบำรุง | 1 | ดูหน้าจอและประวัติย้อนหลัง |

หลักเกณฑ์ที่ระบุไว้: **วิศวกรขึ้นไปเท่านั้นที่ Export ไฟล์ .csv ได้**

### 2.2 รายชื่อพนักงานตั้งต้น (22 คน)

| รหัส | ชื่อ | ตำแหน่ง | หน่วยงาน | สิทธิ์ |
|---|---|---|---|---|
| 0008136 | นาย กมล แก้วพัด | วิศวกร 4 ซ่อมบำรุง (เทียบเท่า) | WF06 | engineer |
| 0007904 | นาย ภูริทรรศน์ สิรินานนท์ | วิศวกร 4 ซ่อมบำรุง (เทียบเท่า) | WF05 | engineer |
| 0013649 | นาย นิธิ มูลตระกูล | วิศวกร ซ่อมบำรุง | WF06 | engineer |
| 0019229 | นาย ธนวัฒน์ มะลิฉ่ำ | วิศวกร ซ่อมบำรุง | WF06 | engineer |
| 0019656 | นาย อโนชา พงษ์สัจจา | วิศวกร ซ่อมบำรุง | WF06 | engineer |
| 0014476 | นาย วิทยา ใจบุญ | ช่างเทคนิค ชำนาญการ | WF06 | technician |
| 0015655 | นาย นนทศักดิ์ ปัทมนาวิน | ช่างเทคนิค ชำนาญการ | WF06 | technician |
| 0018025 | นาย สืบวงศ์ มูลตรีภักดี | ช่างเทคนิค ชำนาญการ | WF06 | technician |
| 0014216 | นาย พิทักษ์ ผลาเลิศ | ช่างเทคนิค ชำนาญการ | WF06 | technician |
| 0016685 | นาย ธนพล ศรีวิลัย | ช่างเทคนิค ชำนาญการ | WF06 | technician |
| 0013481 | นาย ทิวาทร สุดรัมย์ | ช่างเทคนิค ชำนาญการ | WF06 | technician |
| 0015572 | นาย ณัฐพงษ์ ช่างสอน | ช่างเทคนิค ชำนาญการ | WF06 | technician |
| 0014478 | นาย ธีรพนธ์ แก้วกาหลง | ช่างเทคนิค ชำนาญการ | WF06 | technician |
| 0020827 | นาย กฤษฎา ธรรมมิยะ | ช่างไฟฟ้า ซ่อมบำรุง | WF06 | technician |
| 0019351 | นาย ธีรศักดิ์ วิเศษจันทร์ | ช่างไฟฟ้า ซ่อมบำรุง | WF06 | technician |
| 0019393 | นาย ไชยา บุพศิริ | ช่างไฟฟ้า ซ่อมบำรุง | WF06 | technician |
| 0017977 | นาย สุทัศน์ สุระพล | ช่างไฟฟ้า ซ่อมบำรุง | WF06 | technician |
| 0021982 | นาย ธนากร ม่วงเขียว | ช่างไฟฟ้า ซ่อมบำรุง | WF06 | technician |
| 0005782 | นาย ปิยะศักดิ์ แจ่มสกุล | ช่างเครื่องกล ซ่อมบำรุง | WF06 | technician |
| 0022555 | นาย พัสกร มงคลวัจน์ | ช่างเครื่องกล ซ่อมบำรุง | WF06 | technician |
| 0022608 | นาย ธนากร สุราช | ช่างเครื่องกล ซ่อมบำรุง | WF06 | technician |
| 0006888 | น.ส. รัชนี มูลไชยะ | พนักงานข้อมูลซ่อมบำรุง | WF04 | staff |

**หมายเหตุ:** ทุกคนอยู่ WF06 ยกเว้น 0007904 (WF05) และ 0006888 (WF04)

---

## 3. การเข้าสู่ระบบ

### 3.1 ผู้ใช้ใหม่

1. เปิดเว็บแอป กด **เข้าสู่ระบบด้วย LINE**
2. ยืนยันสิทธิ์บนหน้า LINE Login (scope `profile`, `openid`)
3. ระบบไม่พบการผูกบัญชี จึงแสดงหน้า **ผูกรหัสพนักงาน**
4. กรอกรหัสพนักงาน 7 หลัก เช่น `0013649`
5. ระบบตรวจว่ารหัสมีอยู่จริงและ **ยังไม่ถูกผูกกับ LINE บัญชีอื่น**
6. ผูกสำเร็จ บันทึกลง `user_line_links` แล้วเข้าหน้าหลัก

### 3.2 ผู้ใช้เดิม
กด **เข้าสู่ระบบด้วย LINE** ระบบพบ `line_user_id` ที่ผูกไว้ จึงเข้าหน้าหลักทันที

### 3.3 กฎการผูกบัญชี
- LINE 1 บัญชี ผูกได้กับรหัสพนักงาน **1 รหัสเท่านั้น**
- รหัสพนักงาน 1 รหัส ผูกได้กับ LINE **1 บัญชีเท่านั้น**
- เปลี่ยนบัญชี LINE ต้องให้ admin ยกเลิกการผูกให้ก่อน
- พนักงานที่ `is_active = false` ล็อกอินไม่ได้ แม้เคยผูกไว้แล้ว

### 3.4 การเข้าสู่โหมด Admin
ผู้ใช้ที่ล็อกอินแล้วกดเมนู **จัดการระบบ** แล้วกรอกรหัส Admin

รหัส Admin ที่กำหนด: `Admin173` และ `Admin1173`

- ยืนยันแล้วได้สิทธิ์ admin **เฉพาะ session นั้น** หมดอายุใน 30 นาทีหลังไม่มีการใช้งาน
- ทุกครั้งที่ยืนยันสำเร็จหรือล้มเหลว บันทึกลง `audit_log` พร้อมรหัสพนักงานและเวลา
- กรอกผิดเกิน 5 ครั้งใน 15 นาที ระงับการพยายามของผู้ใช้นั้น 30 นาที

> **ข้อควรพิจารณา** รหัส Admin แบบใช้ร่วมกันมีข้อเสียคือสาวไม่ได้ว่าใครเป็นคนแก้ และเมื่อรหัสรั่วต้องเปลี่ยนพร้อมกันทั้งระบบ แนะนำให้ใช้คู่กับธง `is_admin` รายบุคคลในตาราง `employees` เพื่อให้เฉพาะคนที่ได้รับอนุญาตใช้รหัสนี้ได้ และให้เปลี่ยนรหัสได้จากหน้า admin โดยเก็บเป็น hash (bcrypt หรือ argon2) ไม่ใช่ข้อความธรรมดาในโค้ด

---

## 4. หน้าจอในระบบ

| หน้า | สิทธิ์ต่ำสุด | เนื้อหา |
|---|---|---|
| Dashboard | staff | ผังบ่อ 7 บ่อ ค่าปัจจุบัน หน้าปัดแรงดัน กราฟแนวโน้ม บันทึกแจ้งเตือน (ตาม prototype v13) |
| ประวัติย้อนหลัง | staff | ช่วง 1 ชม. / 24 ชม. / 7 วัน / 30 วัน และช่วงวันที่กำหนดเอง |
| แจ้งเตือน | technician | รายการทั้งหมด กดรับทราบ ใส่หมายเหตุ ดูผู้รับทราบ |
| Export | engineer | เลือกชุดข้อมูลและช่วงเวลา ดาวน์โหลด .csv |
| ตั้งค่า setpoint | engineer | แก้ค่า LL/HH ของแต่ละจุดวัด |
| **จัดการพนักงาน** | admin | เพิ่ม แก้ไข ปิดใช้งาน กำหนดสิทธิ์ ยกเลิกการผูก LINE |
| ตั้งค่าระบบ | admin | ตั้งค่าการแจ้งเตือน หน่วงเวลา ผู้รับ และดู audit log |

### หน้าจัดการพนักงาน

**ตารางรายชื่อ** แสดง รหัสพนักงาน / ชื่อ / ตำแหน่ง / หน่วยงาน / สิทธิ์ / สถานะผูก LINE / สถานะใช้งาน / เข้าใช้ล่าสุด
ค้นหาด้วยรหัสหรือชื่อ กรองตามสิทธิ์ หน่วยงาน และสถานะ

**สิ่งที่ทำได้**
- เพิ่มพนักงานใหม่ (รหัส ชื่อ ตำแหน่ง หน่วยงาน สิทธิ์)
- แก้ไขข้อมูลและเปลี่ยนระดับสิทธิ์
- ปิดใช้งาน ไม่ลบทิ้ง เพื่อรักษาประวัติการรับทราบแจ้งเตือนที่อ้างถึงคนนั้น
- ยกเลิกการผูก LINE เพื่อให้ผูกใหม่ได้
- นำเข้ารายชื่อจาก CSV และส่งออกรายชื่อเป็น CSV

ทุกการเปลี่ยนแปลงบันทึกลง `audit_log` ว่าใครแก้ แก้อะไร จากค่าเดิมเป็นค่าใหม่ เมื่อไหร่

---

## 5. การแจ้งเตือนผ่าน LINE

### 5.1 เงื่อนไขการรับแจ้งเตือน
ผู้ใช้จะได้รับข้อความก็ต่อเมื่อครบทั้งสามข้อ

1. **เพิ่ม LINE OA ของระบบเป็นเพื่อนแล้ว**
2. **ผูกบัญชี LINE กับรหัสพนักงานในเว็บแอปแล้ว**
3. เปิดรับแจ้งเตือนในหน้าตั้งค่าส่วนตัว (ค่าเริ่มต้นคือเปิด)

หากยังไม่ครบ ระบบแสดงแถบเตือนบนหน้าหลักพร้อม QR code สำหรับเพิ่มเพื่อน สถานะการเป็นเพื่อนอัปเดตจาก webhook เหตุการณ์ `follow` และ `unfollow`

### 5.2 เงื่อนไขที่ทำให้เกิดการแจ้งเตือน

| ประเภท | เงื่อนไข | ระดับ |
|---|---|---|
| ระดับน้ำสูง | ค่า ≥ HH | warning |
| ระดับน้ำต่ำ | ค่า ≤ LL | warning |
| อุณหภูมิสูง | TT-05 ≥ HH | warning |
| อัตราไหลต่ำ | FT-600Q ≤ LL | warning |
| แรงดันผิดปกติ | PT-AIR / PT-STM หลุดช่วง | warning |
| ค่าวิกฤต | หลุดเกิน HH-HH หรือ LL-LL (ถ้ากำหนด) | critical |
| ขาดสัญญาณ | ไม่มีข้อมูลใหม่เกิน 5 นาที | critical |

**หน่วงเวลา (debounce)** ค่าต้องหลุดช่วงต่อเนื่องตามเวลาที่กำหนด (ค่าเริ่มต้น 60 วินาที) จึงจะส่ง ป้องกันข้อความถล่มจากค่าที่แกว่งชั่วขณะ
**ไม่ส่งซ้ำ** แจ้งเตือนที่ยังไม่กลับสู่ปกติจะไม่ส่งซ้ำ แต่ส่งข้อความย้ำทุก 30 นาทีหากยังไม่มีใครรับทราบ
**แจ้งเมื่อกลับปกติ** ส่งข้อความปิดเรื่องเมื่อค่ากลับเข้าช่วง

### 5.3 ผู้รับ
กำหนดได้ในหน้าตั้งค่าระบบ เช่น warning ส่งถึง technician ขึ้นไปในหน่วยงานที่เกี่ยวข้อง ส่วน critical ส่งถึงทุกคนรวมวิศวกร

### 5.4 รูปแบบข้อความ
ใช้ Flex Message ประกอบด้วยระดับความรุนแรง (แถบสี) ชื่อจุดวัดและ tag ค่าที่วัดได้เทียบกับขีดจำกัด เวลาที่เกิด และปุ่มเปิด Dashboard

```
[WARNING] ระดับน้ำสูง
บ่อ 2 · LT-2
ค่าที่วัดได้ 91.4 %  (HH 90 %)
เวลา 07/09/2569 14:32
→ เปิดหน้าจอเฝ้าระวัง
```

### 5.5 การรับทราบผ่าน LINE
กดปุ่มในข้อความ เปิด LIFF ยืนยันตัวตนจาก session เดิม แล้วบันทึกการรับทราบพร้อมชื่อผู้กด

---

## 6. การ Export ข้อมูล (.csv)

**สิทธิ์:** `engineer` และ `admin` เท่านั้น ผู้ใช้ระดับอื่นไม่เห็นเมนูนี้ และ API ปฏิเสธคำขอด้วย HTTP 403

### ชุดข้อมูลที่ export ได้
| ชุด | เนื้อหา |
|---|---|
| ค่าที่วัดได้ | ทุกจุดวัดตามช่วงเวลาและความละเอียดที่เลือก |
| ประวัติแจ้งเตือน | เวลาเกิด เวลาคืนสภาพ ค่าที่ทำให้เกิด ผู้รับทราบ หมายเหตุ |
| สรุปรายวัน | ค่าต่ำสุด สูงสุด เฉลี่ย และเวลาที่หลุดช่วงของแต่ละจุดวัด |
| รายชื่อพนักงาน | เฉพาะ admin |

### ข้อกำหนดไฟล์
- เข้ารหัส **UTF-8 with BOM** เพื่อให้ Excel ภาษาไทยอ่านได้ถูกต้อง
- คั่นด้วยคอมมา ขึ้นบรรทัดใหม่แบบ CRLF
- วันเวลาเป็น ISO 8601 พร้อม timezone เช่น `2026-09-07T14:32:00+07:00`
- ชื่อไฟล์รูปแบบ `water_readings_20260801_20260907.csv`
- ช่วงเวลาสูงสุดต่อครั้ง 90 วัน หากเกินให้ประมวลผลเบื้องหลังแล้วส่งลิงก์ดาวน์โหลด
- ทุกครั้งที่ export บันทึกลง `export_log` ว่าใคร ดึงอะไร ช่วงไหน กี่แถว

```csv
timestamp,tag,pond,metric,value,unit,status
2026-09-07T14:32:00+07:00,LT-2,2,level,91.4,%,HH
2026-09-07T14:32:00+07:00,TT-05,5,temperature,38.2,°C,NORMAL
```

---

## 7. ฐานข้อมูล PostgreSQL

```sql
-- พนักงาน
CREATE TABLE employees (
  emp_code     VARCHAR(7) PRIMARY KEY,          -- '0013649'
  full_name    TEXT NOT NULL,
  position     TEXT,
  department   VARCHAR(10),                     -- 'WF06'
  role         TEXT NOT NULL
               CHECK (role IN ('staff','technician','engineer','admin')),
  is_admin     BOOLEAN NOT NULL DEFAULT FALSE,  -- อนุญาตให้ใช้รหัส Admin ได้
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- การผูกบัญชี LINE
CREATE TABLE user_line_links (
  line_user_id   TEXT PRIMARY KEY,
  emp_code       VARCHAR(7) NOT NULL UNIQUE REFERENCES employees(emp_code),
  display_name   TEXT,
  is_oa_friend   BOOLEAN NOT NULL DEFAULT FALSE,
  notify_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  linked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

-- บ่อ
CREATE TABLE ponds (
  pond_id     VARCHAR(8) PRIMARY KEY,           -- '1A','600Q'
  name        TEXT NOT NULL,
  capacity_m3 NUMERIC(10,2),
  sort_order  INT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- จุดวัด
CREATE TABLE sensors (
  tag          VARCHAR(20) PRIMARY KEY,         -- 'LT-2','TT-05','PT-AIR'
  pond_id      VARCHAR(8) REFERENCES ponds(pond_id),
  metric       TEXT NOT NULL,                   -- level|temperature|flow|pressure
  unit         TEXT NOT NULL,
  range_min    NUMERIC(10,3),
  range_max    NUMERIC(10,3),
  ll           NUMERIC(10,3),
  hh           NUMERIC(10,3),
  ll_critical  NUMERIC(10,3),
  hh_critical  NUMERIC(10,3),
  debounce_sec INT NOT NULL DEFAULT 60,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

-- ค่าที่วัดได้ (ตารางใหญ่ที่สุด แบ่ง partition รายเดือน)
CREATE TABLE readings (
  ts      TIMESTAMPTZ NOT NULL,
  tag     VARCHAR(20) NOT NULL REFERENCES sensors(tag),
  value   NUMERIC(10,3) NOT NULL,
  quality SMALLINT NOT NULL DEFAULT 1,          -- 1=ดี, 0=สงสัย
  PRIMARY KEY (tag, ts)
) PARTITION BY RANGE (ts);

CREATE INDEX ON readings (ts DESC);

-- ค่ารายชั่วโมงสำหรับกราฟช่วงยาว
CREATE TABLE readings_hourly (
  bucket  TIMESTAMPTZ NOT NULL,
  tag     VARCHAR(20) NOT NULL REFERENCES sensors(tag),
  min_val NUMERIC(10,3),
  max_val NUMERIC(10,3),
  avg_val NUMERIC(10,3),
  n       INT,
  PRIMARY KEY (tag, bucket)
);

-- แจ้งเตือน
CREATE TABLE alarms (
  id            BIGSERIAL PRIMARY KEY,
  tag           VARCHAR(20) NOT NULL REFERENCES sensors(tag),
  severity      TEXT NOT NULL CHECK (severity IN ('warning','critical')),
  condition     TEXT NOT NULL,                  -- HH|LL|HH_CRIT|LL_CRIT|NO_SIGNAL
  trigger_value NUMERIC(10,3),
  threshold     NUMERIC(10,3),
  raised_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_at    TIMESTAMPTZ,
  acked_at      TIMESTAMPTZ,
  acked_by      VARCHAR(7) REFERENCES employees(emp_code),
  ack_note      TEXT
);

CREATE INDEX ON alarms (raised_at DESC);
CREATE INDEX ON alarms (cleared_at) WHERE cleared_at IS NULL;

-- ประวัติการส่ง LINE
CREATE TABLE notification_log (
  id           BIGSERIAL PRIMARY KEY,
  alarm_id     BIGINT REFERENCES alarms(id),
  emp_code     VARCHAR(7) REFERENCES employees(emp_code),
  channel      TEXT NOT NULL DEFAULT 'line',
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL,                   -- sent|failed|skipped
  error_detail TEXT
);

-- ประวัติการ export
CREATE TABLE export_log (
  id         BIGSERIAL PRIMARY KEY,
  emp_code   VARCHAR(7) NOT NULL REFERENCES employees(emp_code),
  dataset    TEXT NOT NULL,
  range_from TIMESTAMPTZ,
  range_to   TIMESTAMPTZ,
  row_count  INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- audit log
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  emp_code   VARCHAR(7),
  action     TEXT NOT NULL,                     -- employee.update, setpoint.change, admin.login
  target     TEXT,
  old_value  JSONB,
  new_value  JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### การจัดการข้อมูล
- **Partition** ตาราง `readings` แบ่งรายเดือน สร้าง partition ล่วงหน้าอัตโนมัติ
- **Rollup** สรุปค่าลง `readings_hourly` ทุกชั่วโมง ใช้กับกราฟ 7 วันและ 30 วัน เพื่อไม่ต้องอ่านข้อมูลดิบทั้งหมด
- **Retention** เก็บข้อมูลดิบ 12 เดือน เก็บค่ารายชั่วโมงและแจ้งเตือนถาวร ตั้งค่าได้จากหน้า admin
- **Backup** สำรองข้อมูลรายวันและทดสอบกู้คืนอย่างน้อยไตรมาสละครั้ง
- **ไม่ลบพนักงาน** ใช้ `is_active = false` แทน เพื่อไม่ให้ประวัติการรับทราบขาดการอ้างอิง

---

## 8. API หลัก

| Method | Path | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| GET | `/auth/line/login` | — | เริ่ม LINE Login |
| GET | `/auth/line/callback` | — | รับ callback แลก token |
| POST | `/auth/link-employee` | ล็อกอินแล้ว | ผูกรหัสพนักงาน |
| POST | `/auth/admin-code` | ล็อกอินแล้ว | ยืนยันรหัส Admin |
| POST | `/auth/logout` | ล็อกอินแล้ว | ออกจากระบบ |
| GET | `/api/readings/latest` | staff | ค่าล่าสุดทุกจุดวัด |
| GET | `/api/readings/history?range=&tag=` | staff | ประวัติย้อนหลัง |
| GET | `/api/alarms?status=` | staff | รายการแจ้งเตือน |
| POST | `/api/alarms/:id/ack` | technician | รับทราบพร้อมหมายเหตุ |
| GET | `/api/export/:dataset.csv` | engineer | ดาวน์โหลด CSV |
| PUT | `/api/sensors/:tag/setpoints` | engineer | แก้ค่า LL/HH |
| GET | `/api/employees` | admin | รายชื่อพนักงาน |
| POST | `/api/employees` | admin | เพิ่มพนักงาน |
| PATCH | `/api/employees/:code` | admin | แก้ไข เปลี่ยนสิทธิ์ ปิดใช้งาน |
| DELETE | `/api/employees/:code/line-link` | admin | ยกเลิกการผูก LINE |
| POST | `/api/ingest` | service token | รับค่าจาก PLC gateway |
| POST | `/webhook/line` | LINE | รับ event เพิ่มเพื่อน / บล็อก |

**การตรวจสิทธิ์ต้องทำที่ฝั่งเซิร์ฟเวอร์ทุกครั้ง** การซ่อนปุ่มบนหน้าจอไม่ใช่การรักษาความปลอดภัย

---

## 9. การเก็บค่าจากเซนเซอร์

```
PLC / Sensor → Gateway (Modbus TCP → JSON) → POST /api/ingest → PostgreSQL
                                                   ↓
                                        ตรวจ LL/HH + debounce
                                                   ↓
                                     สร้าง alarm → LINE Messaging API
```

- Gateway ส่งค่าทุก 5–10 วินาที browser อ่าน Modbus ตรงไม่ได้จึงต้องมีตัวกลางเสมอ
- ระบุ `quality = 0` เมื่อค่าที่อ่านได้น่าสงสัย เพื่อไม่ให้ค่าผิดพลาดสร้างแจ้งเตือนลวง
- ไม่มีข้อมูลใหม่เกิน 5 นาที ให้สร้างแจ้งเตือน `NO_SIGNAL` ระดับ critical

---

## 10. ความปลอดภัย

- ใช้ HTTPS ทั้งระบบ ตั้ง cookie เป็น `HttpOnly` `Secure` `SameSite=Lax`
- Session หมดอายุใน 8 ชั่วโมง สิทธิ์ admin หมดอายุใน 30 นาที
- รหัส Admin เก็บเป็น hash เท่านั้น เปลี่ยนได้จากหน้า admin ไม่ hardcode ในโค้ด
- จำกัดจำนวนครั้งของการผูกรหัสพนักงานและการยืนยันรหัส Admin
- ตรวจสอบ `X-Line-Signature` ของ webhook ทุกครั้ง
- ไม่บันทึก LINE access token ลงฐานข้อมูลถาวร
- ข้อความ LINE ไม่ควรมีข้อมูลส่วนบุคคลเกินจำเป็น

> **จุดที่ต้องยอมรับความเสี่ยง** รหัสพนักงานเป็นข้อมูลที่คนในองค์กรรู้กันได้ทั่วไป การใช้รหัสพนักงานอย่างเดียวจึงไม่ใช่การพิสูจน์ตัวตนที่แข็งแรง สิ่งที่กันได้จริงคือกฎหนึ่งรหัสต่อหนึ่ง LINE แบบถาวร เพราะถ้ามีคนแอบผูกก่อน เจ้าตัวจะผูกไม่ได้และเรื่องจะถูกจับได้ทันที ควรกำหนดช่วงเวลาผูกครั้งแรกให้ชัดเจน แล้วให้ admin ตรวจรายการที่ผูกแล้วเทียบกับตัวจริงอีกชั้น

---

## 11. สิ่งที่ต้องยืนยันก่อนพัฒนา

1. พนักงานข้อมูลซ่อมบำรุง (0006888) ควร export CSV ได้หรือไม่ ตามกฎ "วิศวกรขึ้นไป" คือไม่ได้ แต่ตำแหน่งงานเกี่ยวข้องกับข้อมูลโดยตรง
2. ใครบ้างใน 22 คนที่ควรได้ธง `is_admin`
3. พนักงาน WF05 และ WF04 ควรเห็นข้อมูลเดียวกับ WF06 หรือแยกตามหน่วยงาน
4. ค่า LL/HH จริงของทุกจุดวัด และต้องมีระดับวิกฤตหรือไม่
5. ความจุจริงของแต่ละบ่อเป็นกี่ m³
6. แจ้งเตือนเฉพาะเวลาทำงาน หรือส่งตลอด 24 ชั่วโมง
7. ปลายทางของน้ำจากบ่อ 3 และบ่อ 600Q ที่ยังไม่ระบุในผัง

---

## 12. แผนการพัฒนา

**เฟส 1 — ระบบพื้นฐาน** ตั้งฐานข้อมูล PostgreSQL, API รับค่าจาก gateway, Dashboard แสดงผลจริงแทนข้อมูลจำลองใน prototype

**เฟส 2 — ผู้ใช้และสิทธิ์** LINE Login, ผูกรหัสพนักงาน, ระบบสิทธิ์ 4 ระดับ, หน้าจัดการพนักงาน, นำเข้ารายชื่อ 22 คน

**เฟส 3 — แจ้งเตือน** LINE OA, ตรรกะ debounce และไม่ส่งซ้ำ, รับทราบผ่าน LIFF, ประวัติการส่ง

**เฟส 4 — รายงาน** Export CSV ทุกชุดข้อมูล, สรุปรายวันและรายสัปดาห์, audit log

**เฟส 5 — ต่อยอด** แสดงสถานะปั๊มและวาล์ว, โหมด TV สำหรับจอในโรงงาน, รายงานส่งอัตโนมัติทุกเช้า

---

## ภาคผนวก — เอกสารที่เกี่ยวข้อง

- `Product-v1-dashboard-only.md` — เอกสารเดิมที่เน้นเฉพาะ prototype หน้าจอ ยังใช้อ้างอิงโครงสร้างโค้ดและระบบสีของ dashboard ได้
- `water-monitoring-dashboard-v13.html` — prototype หน้าจอปัจจุบัน
