import { MongoClient } from "mongodb";
import { config } from "../config.js";

/**
 * เชื่อมต่อ MongoDB Atlas คลัสเตอร์เดียว (URI มาจาก .env) แต่จุดวัดแต่ละอันเลือกได้ว่าจะอ่านจาก
 * database/collection ไหนจากหน้าเว็บ — อ่านอย่างเดียว ไม่มีการเขียนค่ากลับไปที่ Mongo
 */

let client = null;
let connecting = null;

export async function getClient() {
  if (!config.mongo.uri) throw new Error("ยังไม่ได้ตั้งค่า MONGODB_URI ใน .env");
  if (client) return client;
  if (!connecting) {
    connecting = MongoClient.connect(config.mongo.uri, { serverSelectionTimeoutMS: 8000 })
      .then((c) => {
        client = c;
        return c;
      })
      .finally(() => {
        connecting = null;
      });
  }
  return connecting;
}

/** ทดสอบอ่านค่าจาก database/collection ที่กรอก โดยไม่บันทึกอะไรลงฐานข้อมูล */
export async function testMongoRead(dbName, collectionName) {
  if (!dbName || !collectionName) throw new Error("ต้องระบุทั้ง database และ collection");
  const c = await getClient();
  const coll = c.db(dbName).collection(collectionName);
  const count = await coll.estimatedDocumentCount();
  const sample = await coll.find().sort({ $natural: -1 }).limit(1).toArray();
  return { count, sample: sample[0] ?? null };
}

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
  }
}
