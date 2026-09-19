import { config } from "../config.js";
import { activeSensors } from "./sensorCache.js";
import { activePlcs } from "./plcCache.js";
import { ingest } from "./ingest.js";
import { ModbusTcpClient, decodeRegisters, registerSize } from "./modbusClient.js";

/**
 * อ่านค่าจาก PLC ผ่าน Modbus TCP โดยตรง แทนการผ่าน Node-RED
 *
 * รองรับหลาย PLC พร้อมกัน (จุดวัดคนละตัวต่อคนละ PLC ได้) — รายชื่อ PLC มาจากตาราง `plcs`
 * แก้ไข/เพิ่ม/ลบได้จากหน้า "จุดวัดและ setpoint" โดยไม่ต้องรีสตาร์ตเซิร์ฟเวอร์
 *
 * จุดวัดที่กรอกทั้ง plc_id และ modbus_address ไว้เท่านั้นที่จะถูกอ่าน จุดที่ยังไม่ได้กรอกครบจะถูกข้าม
 * และจะเกิดแจ้งเตือนขาดสัญญาณตามปกติ ทำให้เห็นได้ทันทีว่ายังตั้งค่าไม่ครบ
 *
 * register ที่อยู่ติดกัน "และอยู่ใน PLC เดียวกัน" จะถูกรวมเป็นคำขอเดียว เพราะการอ่าน 7 ค่าเรียงกัน
 * ด้วยคำขอเดียวเร็วกว่าและกวน PLC น้อยกว่าการยิง 7 คำขอทุกวินาที
 *
 * แต่ละ PLC ดึงค่าตามความถี่ของตัวเอง (poll_sec ตั้งได้จากหน้า "จุดวัดและ setpoint") ตัวจับเวลาหลัก
 * (tick) เดินตาม config.modbus.pollMs เป็นตัวคอยเช็คว่าถึงรอบของ PLC ไหนแล้วเท่านั้น
 */

// ยอมอ่าน register ที่ไม่ได้ใช้คั่นกลางได้ไม่เกินเท่านี้ เพื่อแลกกับการลดจำนวนคำขอ
const MAX_GAP = 8;
const MAX_BLOCK = 125;

// plc_id -> { client, plc, connected, lastOkAt, lastError, mappedTags, blocks }
const clients = new Map();
let timer = null;
let polling = false;

export const status = {
  enabled: false,
  plcs: [],
  lastPollAt: null,
  mappedTags: 0,
  blocks: 0,
  lastError: null,
};

/** จัดกลุ่มจุดวัดที่อยู่ใน PLC เดียวกันและ register ติดกันให้อ่านด้วยคำขอเดียว */
export function planBlocks(sensors) {
  const points = sensors
    .filter(
      (s) =>
        (s.data_source ?? "modbus") === "modbus" &&
        s.plc_id != null &&
        s.modbus_address !== null &&
        s.modbus_address !== undefined
    )
    .map((s) => ({
      tag: s.tag,
      plcId: s.plc_id,
      unitId: s.modbus_unit_id ?? 1,
      fc: s.modbus_fc ?? 3,
      address: Number(s.modbus_address),
      size: registerSize(s.modbus_data_type),
      dataType: s.modbus_data_type ?? "uint16",
      scale: Number(s.modbus_scale ?? 1),
      offset: Number(s.modbus_offset ?? 0),
      wordSwap: Boolean(s.modbus_word_swap),
      rangeMin: s.range_min === null ? null : Number(s.range_min),
      rangeMax: s.range_max === null ? null : Number(s.range_max),
    }))
    .sort((a, b) => a.plcId - b.plcId || a.unitId - b.unitId || a.fc - b.fc || a.address - b.address);

  const blocks = [];
  for (const p of points) {
    const last = blocks[blocks.length - 1];
    const end = p.address + p.size;
    const fits =
      last &&
      last.plcId === p.plcId &&
      last.unitId === p.unitId &&
      last.fc === p.fc &&
      p.address - (last.address + last.quantity) <= MAX_GAP &&
      end - last.address <= MAX_BLOCK;

    if (fits) {
      last.quantity = Math.max(last.quantity, end - last.address);
      last.points.push(p);
    } else {
      blocks.push({ plcId: p.plcId, unitId: p.unitId, fc: p.fc, address: p.address, quantity: p.size, points: [p] });
    }
  }
  return blocks;
}

/** เปิด/ปิด client ให้ตรงกับรายชื่อ PLC ที่เปิดใช้งานอยู่ในฐานข้อมูล ณ ตอนนี้ */
function reconcileClients(plcList) {
  const wanted = new Map(plcList.map((p) => [p.id, p]));

  for (const [id, entry] of clients) {
    const p = wanted.get(id);
    if (!p || p.host !== entry.plc.host || p.port !== entry.plc.port) {
      entry.client.close();
      clients.delete(id);
    }
  }

  for (const p of plcList) {
    const existing = clients.get(p.id);
    if (existing) {
      existing.plc = p;
      existing.pollMs = Math.max(1, Number(p.poll_sec ?? 1)) * 1000;
      continue;
    }

    const client = new ModbusTcpClient({
      host: p.host,
      port: p.port,
      timeoutMs: config.modbus.timeoutMs,
      reconnectMs: config.modbus.reconnectMs,
    });
    const entry = {
      client,
      plc: p,
      connected: false,
      lastOkAt: null,
      lastError: null,
      mappedTags: 0,
      blocks: 0,
      pollMs: Math.max(1, Number(p.poll_sec ?? 1)) * 1000,
      nextAt: 0, // 0 = อ่านทันทีในรอบแรกที่เชื่อมต่อสำเร็จ
    };

    client.on("connect", () => {
      entry.connected = true;
      entry.lastError = null;
      console.log(`[modbus] เชื่อมต่อ ${p.name} (${p.host}:${p.port}) สำเร็จ`);
    });
    client.on("disconnect", () => {
      entry.connected = false;
      console.warn(`[modbus] การเชื่อมต่อ ${p.name} (${p.host}:${p.port}) หลุด กำลังต่อใหม่`);
    });
    client.on("error", (err) => {
      entry.lastError = err.message;
    });

    client.connect();
    clients.set(p.id, entry);
  }
}

function refreshStatus() {
  status.plcs = [...clients.values()]
    .sort((a, b) => (a.plc.sort_order ?? 0) - (b.plc.sort_order ?? 0) || a.plc.id - b.plc.id)
    .map((e) => ({
      id: e.plc.id,
      name: e.plc.name,
      host: e.plc.host,
      port: e.plc.port,
      connected: e.connected,
      lastOkAt: e.lastOkAt,
      lastError: e.lastError,
      mappedTags: e.mappedTags,
      blocks: e.blocks,
      pollSec: e.pollMs / 1000,
    }));
  status.mappedTags = status.plcs.reduce((n, p) => n + p.mappedTags, 0);
  status.blocks = status.plcs.reduce((n, p) => n + p.blocks, 0);
  status.lastError = status.plcs.find((p) => p.lastError)?.lastError ?? null;
}

async function pollOnce() {
  if (polling) return;
  polling = true;

  try {
    reconcileClients(await activePlcs());

    // นับจำนวนจุดวัด/คำสั่งอ่านที่ผูกกับแต่ละ PLC ไว้แสดงผล (ทุกจุดวัด ไม่ใช่แค่ PLC ที่ถึงรอบ)
    const allBlocks = planBlocks(await activeSensors());
    for (const entry of clients.values()) {
      entry.mappedTags = 0;
      entry.blocks = 0;
    }
    for (const b of allBlocks) {
      const entry = clients.get(b.plcId);
      if (entry) {
        entry.blocks += 1;
        entry.mappedTags += b.points.length;
      }
    }

    const now = Date.now();
    const dueIds = new Set();
    for (const [id, entry] of clients) {
      if (now >= entry.nextAt) {
        dueIds.add(id);
        entry.nextAt = now + entry.pollMs;
      }
    }
    if (!dueIds.size) {
      refreshStatus();
      return; // ยังไม่ถึงรอบของ PLC ไหนเลย ข้ามรอบ tick นี้
    }

    status.lastPollAt = new Date();

    const blocks = allBlocks.filter((b) => dueIds.has(b.plcId));
    const readings = [];
    for (const block of blocks) {
      const entry = clients.get(block.plcId);
      if (!entry?.client.connected) continue;

      let data;
      try {
        data = await entry.client.readRegisters(block.unitId, block.address, block.quantity, block.fc);
      } catch (err) {
        entry.lastError = `${block.address}+${block.quantity}: ${err.message}`;
        continue;
      }

      for (const p of block.points) {
        const raw = decodeRegisters(data, p.address - block.address, p.dataType, p.wordSwap);
        const value = raw * p.scale + p.offset;

        // ค่าที่หลุดพิสัยของเครื่องมือวัดถือว่าน่าสงสัย บันทึกไว้แต่ไม่ให้สร้างแจ้งเตือน
        // กันกรณีช่องสัญญาณขาดแล้ว PLC คืนค่าสุดสเกล (Product.md ข้อ 9)
        const suspect =
          !Number.isFinite(value) ||
          (p.rangeMin !== null && value < p.rangeMin) ||
          (p.rangeMax !== null && value > p.rangeMax);

        readings.push({
          tag: p.tag,
          value: Number.isFinite(value) ? value : 0,
          quality: suspect ? 0 : 1,
        });
      }
      entry.lastOkAt = new Date();
    }

    if (readings.length) {
      await ingest({ ts: new Date().toISOString(), readings });
    }
    refreshStatus();
  } catch (err) {
    status.lastError = err.message;
    console.error("[modbus] อ่านค่าไม่สำเร็จ:", err.message);
  } finally {
    polling = false;
  }
}

export async function startModbusPoller() {
  if (!config.modbus.enabled) return;
  if (timer) return;

  status.enabled = true;
  reconcileClients(await activePlcs());
  refreshStatus();

  timer = setInterval(() => {
    pollOnce().catch((err) => console.error("[modbus]", err.message));
  }, config.modbus.pollMs);

  console.log(
    `[modbus] เริ่มอ่านค่าจาก ${clients.size} PLC (เช็ครอบทุก ${config.modbus.pollMs} มิลลิวินาที — แต่ละ PLC อ่านจริงตามความถี่ของตัวเอง)`
  );
}

export function stopModbusPoller() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const entry of clients.values()) entry.client.close();
  clients.clear();
  status.enabled = false;
  status.plcs = [];
}

/** ทดสอบอ่านหนึ่งค่าจากหน้าจอตั้งค่า โดยไม่บันทึกลงฐานข้อมูล */
export async function testRead({ plcId, unitId = 1, address, quantity = 1, fc = 3, dataType = "uint16", wordSwap = false }) {
  const entry = clients.get(Number(plcId));
  if (!entry) throw new Error("ไม่พบ PLC นี้ หรือยังไม่ได้เปิดการอ่านผ่าน Modbus (MODBUS_ENABLED)");
  if (!entry.client.connected) throw new Error(`ยังไม่ได้เชื่อมต่อกับ ${entry.plc.name} (${entry.plc.host}:${entry.plc.port})`);
  const size = registerSize(dataType);
  const data = await entry.client.readRegisters(unitId, address, Math.max(quantity, size), fc);
  return {
    raw: decodeRegisters(data, 0, dataType, wordSwap),
    registers: [...Array(data.length / 2)].map((_, i) => data.readUInt16BE(i * 2)),
  };
}
