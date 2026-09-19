# Tank600Q — Modbus → MongoDB bridge

สคริปต์เดี่ยว รันแยกจากโปรเจกต์หลัก (`Water_monitoring`) บน Raspberry Pi อีกตัวที่หน้างานบ่อ 600Q
ไม่มีหน้าเว็บ ไม่ต่อ Postgres — หน้าที่เดียวคืออ่าน AI1/AI2 จาก PLC ผ่าน Modbus TCP แล้วส่งเข้า
MongoDB Atlas ตรง ๆ:

- **AI1** (ระดับน้ำ 600Q) → db `Tank600Q` collection `Level Water`
- **AI2** (Flowrate 600Q) → db `Tank600Q` collection `Flowrate`

## ติดตั้งบน Raspberry Pi ตัวนี้

```bash
cd Tank600Qandetc.
npm install
cp .env.example .env   # ถ้ายังไม่มี .env (มีให้แล้วในโฟลเดอร์นี้ — แก้ให้ตรงหน้างานจริง)
```

แก้ไฟล์ `.env`:
- `MONGODB_URI` — ใส่ connection string จริงจาก MongoDB Atlas (Connect > Drivers > Node.js)
- `PLC_HOST` — ตั้งไว้ที่ `192.168.0.5` แล้ว ปรับถ้า IP หน้างานจริงต่างจากนี้
- `AI1_*` / `AI2_*` — ค่าเริ่มต้นคือ FC4 (Read Input Registers) address `0`/`1` แบบ raw uint16
  ตามรูปแบบ LOGO!+AM2 ที่โปรเจกต์หลักเคยยืนยันไว้ (ดู `../docs/plc-wiring-logo-am2.md` ข้อ 6.2)
  แต่ PLC ตัวนี้เป็นอุปกรณ์คนละตัว **ต้องทดสอบอ่านค่าจริงเทียบกับระดับน้ำ/อัตราการไหลหน้างานก่อนใช้งานจริงเสมอ**
  แล้วปรับ `ADDRESS`/`SCALE`/`OFFSET` ผ่าน `.env` ได้โดยไม่ต้องแก้โค้ด

## รัน

```bash
npm start
# หรือ
node index.js
```

log จะพิมพ์ค่าที่อ่านได้และปลายทางที่บันทึกทุกรอบ poll (ค่าเริ่มต้นทุก 1 วินาที ปรับได้ที่ `MODBUS_POLL_MS`)

## รันค้างไว้ตลอด (systemd)

```ini
# /etc/systemd/system/tank600q-bridge.service
[Unit]
Description=Tank600Q Modbus to MongoDB bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/wetfood173/Desktop/Water_monitoring/Tank600Qandetc.
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tank600q-bridge
sudo journalctl -u tank600q-bridge -f
```
