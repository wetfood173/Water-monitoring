import express, { Router } from "express";
import { query } from "../db/index.js";
import { wrap } from "../lib/http.js";
import { verifyWebhookSignature } from "../services/lineClient.js";

export const router = Router();

/**
 * รับ event จาก LINE OA
 * ต้องอ่าน raw body เพื่อตรวจ X-Line-Signature ก่อน parse (ข้อ 10)
 */
router.post(
  "/webhook/line",
  express.raw({ type: "*/*", limit: "1mb" }),
  wrap(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    if (!verifyWebhookSignature(raw, req.headers["x-line-signature"])) {
      return res.status(401).json({ error: "ลายเซ็นไม่ถูกต้อง" });
    }

    // ตอบ 200 ทันทีตามข้อกำหนดของ LINE แล้วค่อยประมวลผลต่อ
    res.status(200).end();

    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }

    for (const event of payload.events ?? []) {
      const lineUserId = event.source?.userId;
      if (!lineUserId) continue;
      try {
        if (event.type === "follow") {
          await query(`UPDATE user_line_links SET is_oa_friend = TRUE WHERE line_user_id = $1`, [
            lineUserId,
          ]);
        } else if (event.type === "unfollow") {
          await query(`UPDATE user_line_links SET is_oa_friend = FALSE WHERE line_user_id = $1`, [
            lineUserId,
          ]);
        }
      } catch (err) {
        console.error("[webhook] ประมวลผล event ไม่สำเร็จ:", err.message);
      }
    }
  })
);
