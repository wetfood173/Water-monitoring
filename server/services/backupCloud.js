import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../config.js";

/**
 * อัปโหลด backup ขึ้น Cloudflare R2 (S3-compatible) — R2 ไม่คิดค่า egress
 * จึงเหมาะเก็บสำเนาสำรองไว้นอกเครื่องที่รันเซิร์ฟเวอร์ ถ้าเครื่อง/ดิสก์เสียยังมีสำเนาอยู่
 */

export const r2Enabled = Boolean(
  config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket
);

let client;
function getClient() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    });
  }
  return client;
}

/** อัปโหลด backup หนึ่งไฟล์ขึ้น R2 — คืน false เงียบ ๆ ถ้ายังไม่ตั้งค่า R2 ไว้ ไม่ทำให้ backup ในเครื่องล้มเหลวตาม */
export async function uploadBackupToCloud(name, buf) {
  if (!r2Enabled) return false;
  await getClient().send(
    new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: `${config.r2.prefix}${name}`,
      Body: buf,
      ContentType: "application/gzip",
    })
  );
  return true;
}
