import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";

import { config, ROOT, lineLoginEnabled, lineMessagingEnabled } from "./config.js";
import { connect, close, backend } from "./db/index.js";
import { migrate, ensurePartitions, dropExpiredPartitions, trimOldReadings } from "./db/migrate.js";
import { loadSession, purgeExpiredSessions } from "./middleware/session.js";
import { HttpError } from "./lib/http.js";
import { getSetting } from "./lib/settings.js";

import { router as authRoutes } from "./routes/auth.js";
import { router as readingRoutes } from "./routes/readings.js";
import { router as alarmRoutes } from "./routes/alarms.js";
import { router as sensorRoutes } from "./routes/sensors.js";
import { router as plcRoutes } from "./routes/plcs.js";
import { router as employeeRoutes } from "./routes/employees.js";
import { router as exportRoutes } from "./routes/export.js";
import { router as systemRoutes } from "./routes/system.js";
import { router as webhookRoutes } from "./routes/lineWebhook.js";

import { checkNoSignal, repeatUnacked } from "./services/alarmEngine.js";
import { rollupHourly } from "./services/rollup.js";
import { runBackup } from "./services/backup.js";
import { startSimulator, backfill } from "./services/simulator.js";
import { startModbusPoller, stopModbusPoller, status as modbusStatus } from "./services/modbusPoller.js";
import { startMongoPoller, stopMongoPoller } from "./services/mongoPoller.js";
import { closeMongo } from "./services/mongoClient.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// webhook ต้องมาก่อน express.json เพราะต้องใช้ raw body ตรวจลายเซ็น
app.use(webhookRoutes);

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(loadSession);

app.use(authRoutes);
app.use(readingRoutes);
app.use(alarmRoutes);
app.use(sensorRoutes);
app.use(plcRoutes);
app.use(employeeRoutes);
app.use(exportRoutes);
app.use(systemRoutes);

const PUBLIC = path.join(ROOT, "public");
app.use(express.static(PUBLIC, { index: false, maxAge: config.isProd ? "1h" : 0 }));

app.get("/login", (req, res) => res.sendFile(path.join(PUBLIC, "login.html")));
app.get("/link", (req, res) => res.sendFile(path.join(PUBLIC, "link.html")));

app.use("/api", (req, res) => res.status(404).json({ error: "ไม่พบ endpoint นี้" }));

// ทุกเส้นทางที่เหลือเป็นของ SPA
app.get("*", (req, res) => res.sendFile(path.join(PUBLIC, "index.html")));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  console.error("[error]", err);
  res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
});

/* ================= งานเบื้องหลัง ================= */

const timers = [];
const every = (ms, fn, label) => {
  const run = () => fn().catch((e) => console.error(`[${label}]`, e.message));
  timers.push(setInterval(run, ms));
  run();
};

function startBackgroundJobs() {
  every(30_000, checkNoSignal, "no-signal");
  every(60_000, repeatUnacked, "repeat-notify");
  every(5 * 60_000, () => rollupHourly(3), "rollup");
  every(60 * 60_000, purgeExpiredSessions, "purge-sessions");
  every(
    24 * 60 * 60_000,
    async () => {
      await ensurePartitions();
      const months = (await getSetting("retention.raw_months")) ?? 12;
      const dropped = await dropExpiredPartitions(months);
      if (dropped.length) console.log(`[retention] ลบ partition เก่า: ${dropped.join(", ")}`);

      const days = (await getSetting("retention.raw_days")) ?? 0;
      if (days > 0) {
        const n = await trimOldReadings(days);
        if (n) console.log(`[retention] ลบข้อมูลดิบที่เก่ากว่า ${days} วัน: ${n} แถว`);
      }
    },
    "partition-maintenance"
  );
  every(
    24 * 60 * 60_000,
    async () => {
      const name = await runBackup();
      if (name) console.log(`[backup] สำรองข้อมูลแล้ว: ${name}`);
    },
    "backup"
  );
}

/* ================= บูต ================= */

async function main() {
  await connect();
  await migrate();

  if (config.simulate) {
    const n = await backfill(48, 5);
    if (n) console.log(`[simulator] เติมข้อมูลย้อนหลัง 48 ชั่วโมง (${n} ค่า)`);
  }
  await rollupHourly(72);

  startBackgroundJobs();
  startSimulator();
  await startModbusPoller();
  await startMongoPoller();

  const server = app.listen(config.port, () => {
    console.log(`
ระบบเฝ้าระวังน้ำ พร้อมใช้งานที่ ${config.baseUrl}
  ฐานข้อมูล      ${backend}${backend === "pglite" ? ` (${config.pgliteDir})` : ""}
  LINE Login     ${lineLoginEnabled ? "เปิดใช้งาน" : "ยังไม่ได้ตั้งค่า"}
  LINE OA        ${lineMessagingEnabled ? "เปิดใช้งาน" : "ยังไม่ได้ตั้งค่า"}
  Modbus TCP     ${
    config.modbus.enabled
      ? `${modbusStatus.plcs.length} PLC ทุก ${config.modbus.pollMs} มิลลิวินาที (ตั้งค่า PLC ได้จากหน้าจุดวัด)`
      : "ปิด"
  }
  ข้อมูลจำลอง     ${config.simulate ? "เปิด" : "ปิด (รอค่าจาก Modbus หรือ /api/ingest)"}
  เข้าระบบพัฒนา   ${config.devLogin ? "เปิด" : "ปิด"}
`);
  });

  const shutdown = async () => {
    timers.forEach(clearInterval);
    stopModbusPoller();
    await stopMongoPoller();
    await closeMongo();
    server.close();
    await close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("เริ่มระบบไม่สำเร็จ:", err);
  process.exit(1);
});
