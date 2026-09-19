import net from "node:net";

/**
 * PLC จำลองที่พูด Modbus TCP สำหรับทดสอบการอ่านค่าโดยไม่ต้องต่อของจริง
 *
 *   node tools/fake-plc.js [port] [baseAddress]
 *
 * ตอบ FC3 และ FC4 โดยค่าที่ AI1..AI7 (เริ่มที่ 528) จะเดินขึ้นลงช้า ๆ
 * อยู่ในช่วง 0–100 เหมือนระดับน้ำจริง
 */

const PORT = Number(process.argv[2] ?? 5502);
const BASE = Number(process.argv[3] ?? 528);
// ระดับน้ำ AI1–AI7 ส่งเป็น 0–1000 (ทศนิยม 1 ตำแหน่ง) ตามที่ PLC จริงใช้
const LEVEL_MAX = 1000;
const COUNT = 11;

const registers = new Uint16Array(65536);
for (let i = 0; i < COUNT; i++) {
  registers[BASE + i] = i < 7 ? 400 + Math.floor(Math.random() * 300) : 40 + Math.floor(Math.random() * 30);
}

setInterval(() => {
  for (let i = 0; i < COUNT; i++) {
    const max = i < 7 ? LEVEL_MAX : 100;
    const step = i < 7 ? 60 : 6;
    const next = registers[BASE + i] + Math.round((Math.random() - 0.5) * step);
    registers[BASE + i] = Math.max(0, Math.min(max, next));
  }
}, 1000);

const server = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 7) {
      const length = buffer.readUInt16BE(4);
      const total = 6 + length;
      if (buffer.length < total) break;
      const frame = buffer.subarray(0, total);
      buffer = buffer.subarray(total);

      const tid = frame.readUInt16BE(0);
      const unit = frame.readUInt8(6);
      const fc = frame.readUInt8(7);
      const address = frame.readUInt16BE(8);
      const quantity = frame.readUInt16BE(10);

      if (fc !== 3 && fc !== 4) {
        const err = Buffer.alloc(9);
        err.writeUInt16BE(tid, 0);
        err.writeUInt16BE(0, 2);
        err.writeUInt16BE(3, 4);
        err.writeUInt8(unit, 6);
        err.writeUInt8(fc | 0x80, 7);
        err.writeUInt8(1, 8); // illegal function
        socket.write(err);
        continue;
      }

      const byteCount = quantity * 2;
      const res = Buffer.alloc(9 + byteCount);
      res.writeUInt16BE(tid, 0);
      res.writeUInt16BE(0, 2);
      res.writeUInt16BE(3 + byteCount, 4);
      res.writeUInt8(unit, 6);
      res.writeUInt8(fc, 7);
      res.writeUInt8(byteCount, 8);
      for (let i = 0; i < quantity; i++) {
        res.writeUInt16BE(registers[(address + i) & 0xffff], 9 + i * 2);
      }
      socket.write(res);
    }
  });
  socket.on("error", () => {});
});

server.listen(PORT, () => {
  console.log(`PLC จำลองรออยู่ที่พอร์ต ${PORT} · register ${BASE}–${BASE + COUNT - 1} มีค่าเดินอยู่`);
});
