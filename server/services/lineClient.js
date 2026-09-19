import crypto from "node:crypto";
import { config, lineLoginEnabled, lineMessagingEnabled } from "../config.js";

const LOGIN_AUTH = "https://access.line.me/oauth2/v2.1/authorize";
const LOGIN_TOKEN = "https://api.line.me/oauth2/v2.1/token";
const LOGIN_VERIFY = "https://api.line.me/oauth2/v2.1/verify";
const PROFILE = "https://api.line.me/v2/profile";
const BOT_PROFILE = "https://api.line.me/v2/bot/profile";
const PUSH = "https://api.line.me/v2/bot/message/push";
const MULTICAST = "https://api.line.me/v2/bot/message/multicast";

export { lineLoginEnabled, lineMessagingEnabled };

/* ============ LINE Login ============ */

export function buildAuthorizeUrl(state, nonce) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.line.loginChannelId,
    redirect_uri: config.line.loginCallbackUrl,
    state,
    scope: "profile openid",
    nonce,
    bot_prompt: "aggressive", // ชวนเพิ่ม OA เป็นเพื่อนตอนล็อกอิน
  });
  return `${LOGIN_AUTH}?${params}`;
}

export async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.line.loginCallbackUrl,
    client_id: config.line.loginChannelId,
    client_secret: config.line.loginChannelSecret,
  });
  const res = await fetch(LOGIN_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`แลก token กับ LINE ไม่สำเร็จ: ${res.status} ${await res.text()}`);
  return res.json();
}

/** ตรวจ id_token ที่ฝั่ง LINE เพื่อยืนยัน nonce และดึง sub/name ที่เชื่อถือได้ */
export async function verifyIdToken(idToken, nonce) {
  const body = new URLSearchParams({
    id_token: idToken,
    client_id: config.line.loginChannelId,
    nonce,
  });
  const res = await fetch(LOGIN_VERIFY, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`ตรวจ id_token ไม่สำเร็จ: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function fetchProfile(accessToken) {
  const res = await fetch(PROFILE, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`อ่านโปรไฟล์ LINE ไม่สำเร็จ: ${res.status}`);
  return res.json();
}

/* ============ Webhook ============ */

export function verifyWebhookSignature(rawBody, signature) {
  if (!config.line.messagingChannelSecret || !signature) return false;
  const expected = crypto
    .createHmac("sha256", config.line.messagingChannelSecret)
    .update(rawBody)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ============ Messaging API ============ */

async function callMessaging(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.line.messagingAccessToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`LINE Messaging API ตอบ ${res.status}: ${await res.text()}`);
  }
}

/**
 * ตรวจว่าผู้ใช้เพิ่ม OA เป็นเพื่อนอยู่หรือไม่ โดยถามโปรไฟล์ผ่าน Messaging API
 * 200 = เป็นเพื่อน, 404 = ยังไม่ได้เพิ่มหรือบล็อกไว้
 * ใช้เสริม webhook follow/unfollow ซึ่งส่งมาไม่ได้ตอนรันบน localhost
 * คืน null เมื่อถามไม่สำเร็จ เพื่อให้ผู้เรียกคงค่าเดิมไว้แทนการเดา
 */
export async function checkFriendship(lineUserId) {
  if (!lineMessagingEnabled || !lineUserId) return null;
  try {
    const res = await fetch(`${BOT_PROFILE}/${encodeURIComponent(lineUserId)}`, {
      headers: { Authorization: `Bearer ${config.line.messagingAccessToken}` },
    });
    if (res.ok) return true;
    if (res.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

export async function pushTo(lineUserId, messages) {
  if (!lineMessagingEnabled) throw new Error("ยังไม่ได้ตั้งค่า LINE Messaging API");
  await callMessaging(PUSH, { to: lineUserId, messages });
}

export async function multicast(lineUserIds, messages) {
  if (!lineMessagingEnabled) throw new Error("ยังไม่ได้ตั้งค่า LINE Messaging API");
  for (let i = 0; i < lineUserIds.length; i += 500) {
    await callMessaging(MULTICAST, { to: lineUserIds.slice(i, i + 500), messages });
  }
}

/* ============ Flex message ============ */

const SEVERITY = {
  critical: { color: "#E2594B", label: "CRITICAL" },
  warning: { color: "#E3A33C", label: "WARNING" },
  normal: { color: "#3FB4A8", label: "คืนสภาพปกติ" },
};

const CONDITION_TEXT = {
  HH: "ค่าสูงเกินขีดจำกัด",
  LL: "ค่าต่ำกว่าขีดจำกัด",
  HH_CRIT: "ค่าสูงถึงระดับวิกฤต",
  LL_CRIT: "ค่าต่ำถึงระดับวิกฤต",
  NO_SIGNAL: "ขาดสัญญาณจากเซนเซอร์",
};

export function conditionText(condition) {
  return CONDITION_TEXT[condition] || condition;
}

const fmtTime = (d) =>
  new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(d));

function row(label, value, bold = false) {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#8C9CA3", flex: 3 },
      {
        type: "text",
        text: String(value),
        size: "sm",
        color: "#111111",
        flex: 6,
        wrap: true,
        weight: bold ? "bold" : "regular",
      },
    ],
  };
}

/**
 * สร้าง Flex Message ตามรูปแบบในข้อ 5.4
 * kind: raise | repeat | clear
 */
export function buildAlarmFlex(alarm, { kind = "raise" } = {}) {
  const isClear = kind === "clear";
  const sev = isClear ? SEVERITY.normal : SEVERITY[alarm.severity] || SEVERITY.warning;
  const title = isClear
    ? `${alarm.sensor_name} กลับสู่ช่วงปกติ`
    : `${sev.label} · ${conditionText(alarm.condition)}`;
  const where = alarm.pond_id ? `บ่อ ${alarm.pond_id} · ${alarm.tag}` : alarm.tag;
  const dp = alarm.decimals ?? 1;
  const unit = alarm.unit || "";

  const body = [
    { type: "text", text: alarm.sensor_name || where, weight: "bold", size: "md", wrap: true },
    { type: "text", text: where, size: "xs", color: "#8C9CA3", margin: "xs" },
    { type: "separator", margin: "md" },
    {
      type: "box",
      layout: "vertical",
      margin: "md",
      spacing: "sm",
      contents: [
        alarm.condition !== "NO_SIGNAL" && alarm.trigger_value != null
          ? row("ค่าที่วัดได้", `${Number(alarm.trigger_value).toFixed(dp)} ${unit}`, true)
          : row("สถานะ", conditionText(alarm.condition), true),
        alarm.threshold != null
          ? row("ขีดจำกัด", `${alarm.condition.startsWith("HH") ? "HH" : "LL"} ${Number(alarm.threshold).toFixed(dp)} ${unit}`)
          : null,
        row("เวลาที่เกิด", fmtTime(alarm.raised_at)),
        isClear && alarm.cleared_at ? row("เวลาคืนสภาพ", fmtTime(alarm.cleared_at)) : null,
        kind === "repeat" ? row("หมายเหตุ", "ยังไม่มีผู้รับทราบ") : null,
      ].filter(Boolean),
    },
  ];

  const dashboardUrl = `${config.baseUrl}/#/alarms?id=${alarm.id}`;
  const ackUrl = config.line.liffId
    ? `https://liff.line.me/${config.line.liffId}?alarm=${alarm.id}`
    : dashboardUrl;

  const footer = {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      !isClear && {
        type: "button",
        style: "primary",
        height: "sm",
        color: sev.color,
        action: { type: "uri", label: "รับทราบการแจ้งเตือน", uri: ackUrl },
      },
      {
        type: "button",
        style: "link",
        height: "sm",
        action: { type: "uri", label: "เปิดหน้าจอเฝ้าระวัง", uri: `${config.baseUrl}/` },
      },
    ].filter(Boolean),
  };

  return {
    type: "flex",
    altText: `[${sev.label}] ${title} — ${where}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: sev.color,
        paddingAll: "12px",
        contents: [{ type: "text", text: title, color: "#FFFFFF", weight: "bold", size: "sm", wrap: true }],
      },
      body: { type: "box", layout: "vertical", contents: body },
      footer,
    },
  };
}
