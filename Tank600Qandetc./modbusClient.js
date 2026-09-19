import net from "node:net";
import { EventEmitter } from "node:events";

/**
 * Modbus TCP client อ่านอย่างเดียว (FC3 / FC4)
 * คัดลอกมาจาก server/services/modbusClient.js ของโปรเจกต์หลัก เพื่อให้โฟลเดอร์นี้รันแยก
 * เป็นเอกเทศบน Raspberry Pi อีกตัวได้โดยไม่ต้องพึ่งโค้ดของโปรเจกต์หลัก
 *
 * ต่อใหม่อัตโนมัติเมื่อสายหลุด, timeout รายคำขอ และส่งทีละคำขอไม่ยิงซ้อน
 * (PLC หลายรุ่นตอบผิดพลาดเมื่อมีคำขอค้างพร้อมกันหลายรายการ)
 */

const MBAP_LEN = 7;
const MAX_REGISTERS = 125; // ขีดจำกัดของ FC3/FC4 ต่อหนึ่งคำขอ

const EXCEPTIONS = {
  1: "ฟังก์ชันนี้ไม่รองรับ",
  2: "address อยู่นอกช่วงที่อุปกรณ์มี",
  3: "จำนวน register ไม่ถูกต้อง",
  4: "อุปกรณ์ทำงานผิดพลาด",
  5: "อุปกรณ์รับคำขอแล้วแต่ยังประมวลผลไม่เสร็จ",
  6: "อุปกรณ์ไม่ว่าง",
  11: "gateway ติดต่ออุปกรณ์ปลายทางไม่ได้",
};

export class ModbusTcpClient extends EventEmitter {
  #socket = null;
  #buffer = Buffer.alloc(0);
  #pending = null;
  #queue = [];
  #transactionId = 0;
  #reconnectTimer = null;
  #closed = false;

  constructor({ host, port = 502, timeoutMs = 3000, reconnectMs = 5000 }) {
    super();
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.reconnectMs = reconnectMs;
    this.connected = false;
    this.lastError = null;
    this.connectedAt = null;
  }

  connect() {
    if (this.#socket || this.#closed) return;
    const socket = new net.Socket();
    this.#socket = socket;
    socket.setNoDelay(true);

    socket.on("connect", () => {
      this.connected = true;
      this.connectedAt = new Date();
      this.lastError = null;
      this.emit("connect");
    });
    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("error", (err) => {
      this.lastError = err.message;
      this.emit("error", err);
    });
    socket.on("close", () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.#socket = null;
      this.#buffer = Buffer.alloc(0);
      this.#failAll(new Error("การเชื่อมต่อ Modbus ถูกตัด"));
      if (wasConnected) this.emit("disconnect");
      this.#scheduleReconnect();
    });

    socket.connect({ host: this.host, port: this.port });
  }

  #scheduleReconnect() {
    if (this.#closed || this.#reconnectTimer) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.connect();
    }, this.reconnectMs);
  }

  #failAll(err) {
    if (this.#pending) {
      clearTimeout(this.#pending.timer);
      this.#pending.reject(err);
      this.#pending = null;
    }
    const queued = this.#queue.splice(0);
    for (const item of queued) item.reject(err);
  }

  /**
   * อ่าน holding registers (FC3) หรือ input registers (FC4)
   * คืน Buffer ความยาว quantity × 2 ไบต์ เรียงแบบ big-endian ตามมาตรฐาน Modbus
   */
  readRegisters(unitId, address, quantity, fc = 3) {
    if (quantity < 1 || quantity > MAX_REGISTERS) {
      return Promise.reject(new Error(`อ่านได้ครั้งละ 1–${MAX_REGISTERS} register`));
    }
    if (fc !== 3 && fc !== 4) {
      return Promise.reject(new Error("รองรับเฉพาะ FC3 และ FC4"));
    }
    return new Promise((resolve, reject) => {
      this.#queue.push({ unitId, address, quantity, fc, resolve, reject });
      this.#drain();
    });
  }

  #drain() {
    if (this.#pending || !this.#queue.length) return;
    if (!this.connected || !this.#socket) {
      this.#failAll(new Error("ยังไม่ได้เชื่อมต่อกับ PLC"));
      return;
    }

    const job = this.#queue.shift();
    this.#transactionId = (this.#transactionId + 1) & 0xffff;
    const tid = this.#transactionId;

    const frame = Buffer.alloc(12);
    frame.writeUInt16BE(tid, 0);
    frame.writeUInt16BE(0, 2); // protocol id
    frame.writeUInt16BE(6, 4); // ความยาวส่วนที่เหลือ
    frame.writeUInt8(job.unitId, 6);
    frame.writeUInt8(job.fc, 7);
    frame.writeUInt16BE(job.address, 8);
    frame.writeUInt16BE(job.quantity, 10);

    const timer = setTimeout(() => {
      const p = this.#pending;
      this.#pending = null;
      p?.reject(new Error(`PLC ไม่ตอบภายใน ${this.timeoutMs} มิลลิวินาที`));
      // คำตอบที่มาช้าจะไม่ตรง transaction id ที่รออยู่แล้ว จึงถูกทิ้งไปเอง
      this.#drain();
    }, this.timeoutMs);

    this.#pending = { ...job, tid, timer };
    this.#socket.write(frame);
  }

  #onData(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);

    while (this.#buffer.length >= MBAP_LEN) {
      const length = this.#buffer.readUInt16BE(4);
      const total = 6 + length;
      if (this.#buffer.length < total) break;

      const frame = this.#buffer.subarray(0, total);
      this.#buffer = this.#buffer.subarray(total);
      this.#handleFrame(frame);
    }
  }

  #handleFrame(frame) {
    const tid = frame.readUInt16BE(0);
    const fc = frame.readUInt8(7);
    const pending = this.#pending;

    // คำตอบที่มาช้ากว่า timeout จะไม่ตรงกับคำขอที่รออยู่ ทิ้งได้ทันที
    if (!pending || pending.tid !== tid) return;

    clearTimeout(pending.timer);
    this.#pending = null;

    if (fc & 0x80) {
      const code = frame.readUInt8(8);
      pending.reject(new Error(`PLC ปฏิเสธคำขอ: ${EXCEPTIONS[code] ?? `exception ${code}`}`));
    } else {
      const byteCount = frame.readUInt8(8);
      const data = frame.subarray(9, 9 + byteCount);
      if (data.length !== pending.quantity * 2) {
        pending.reject(new Error("ข้อมูลที่ได้จาก PLC ยาวไม่ตรงกับที่ขอ"));
      } else {
        pending.resolve(data);
      }
    }
    this.#drain();
  }

  close() {
    this.#closed = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#failAll(new Error("ปิดการเชื่อมต่อ Modbus"));
    this.#socket?.destroy();
    this.#socket = null;
    this.connected = false;
  }
}

/* ================= การถอดค่าจาก register ================= */

/** จำนวน register ที่แต่ละชนิดข้อมูลใช้ */
export function registerSize(dataType) {
  return dataType === "uint32" || dataType === "int32" || dataType === "float32" ? 2 : 1;
}

export const DATA_TYPES = ["uint16", "int16", "uint32", "int32", "float32"];

/**
 * ถอดค่าดิบจาก buffer ที่ตำแหน่ง offset (หน่วยเป็น register)
 * wordSwap ใช้กับ PLC ที่เรียง word ของค่า 32 บิตกลับด้าน
 */
export function decodeRegisters(buffer, offsetRegisters, dataType, wordSwap = false) {
  const at = offsetRegisters * 2;
  switch (dataType) {
    case "int16":
      return buffer.readInt16BE(at);
    case "uint32":
    case "int32":
    case "float32": {
      const hi = buffer.readUInt16BE(wordSwap ? at + 2 : at);
      const lo = buffer.readUInt16BE(wordSwap ? at : at + 2);
      const pair = Buffer.alloc(4);
      pair.writeUInt16BE(hi, 0);
      pair.writeUInt16BE(lo, 2);
      if (dataType === "uint32") return pair.readUInt32BE(0);
      if (dataType === "int32") return pair.readInt32BE(0);
      return pair.readFloatBE(0);
    }
    default:
      return buffer.readUInt16BE(at);
  }
}
