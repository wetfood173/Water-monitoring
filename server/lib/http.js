export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg, code) => new HttpError(400, msg, code);
export const unauthorized = (msg = "ต้องเข้าสู่ระบบก่อน", code) => new HttpError(401, msg, code);
export const forbidden = (msg = "ไม่มีสิทธิ์ใช้งานส่วนนี้", code) => new HttpError(403, msg, code);
export const notFound = (msg = "ไม่พบข้อมูล", code) => new HttpError(404, msg, code);
export const conflict = (msg, code) => new HttpError(409, msg, code);
export const tooMany = (msg, code) => new HttpError(429, msg, code);

/** ห่อ async handler ให้ error ตกไปที่ error middleware แทนที่จะค้าง */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}
