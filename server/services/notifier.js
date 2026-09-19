import { query, many, one } from "../db/index.js";
import { getSetting } from "../lib/settings.js";
import * as line from "./lineClient.js";

/**
 * หาผู้รับแจ้งเตือนตามเงื่อนไขข้อ 5.1
 * ต้องครบทั้งสามข้อ: เป็นเพื่อนกับ OA + ผูกบัญชีแล้ว + เปิดรับแจ้งเตือน
 */
export async function resolveRecipients(severity, departmentOfAlarm = null) {
  const cfg = (await getSetting("notify.recipients")) || {};
  const rule = cfg[severity] || { roles: ["technician", "engineer", "admin"], departments: "all" };
  const roles = rule.roles?.length ? rule.roles : ["technician", "engineer", "admin"];

  const params = [roles];
  let where = `e.is_active = TRUE AND e.role = ANY($1)
               AND l.line_user_id IS NOT NULL
               AND l.notify_enabled = TRUE
               AND l.is_oa_friend = TRUE`;

  if (Array.isArray(rule.departments) && rule.departments.length) {
    params.push(rule.departments);
    where += ` AND e.department = ANY($${params.length})`;
  } else if (rule.departments === "related" && departmentOfAlarm) {
    params.push(departmentOfAlarm);
    where += ` AND e.department = $${params.length}`;
  }

  return many(
    `SELECT e.emp_code, e.full_name, l.line_user_id
       FROM employees e JOIN user_line_links l ON l.emp_code = e.emp_code
      WHERE ${where}`,
    params
  );
}

function withinQuietHours(quiet, now = new Date()) {
  if (!quiet?.enabled) return false;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  });
  const cur = fmt.format(now);
  const { from, to } = quiet;
  // ช่วงที่คร่อมเที่ยงคืน เช่น 22:00–06:00
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to;
}

async function logNotification(alarmId, empCode, kind, status, error = null) {
  await query(
    `INSERT INTO notification_log (alarm_id, emp_code, channel, kind, status, error_detail)
     VALUES ($1,$2,'line',$3,$4,$5)`,
    [alarmId, empCode, kind, status, error]
  );
}

/**
 * ส่งแจ้งเตือนหนึ่งรายการไปยังผู้รับที่เข้าเงื่อนไข
 * kind: raise | repeat | clear
 */
export async function notifyAlarm(alarmId, kind = "raise") {
  const alarm = await one(
    `SELECT a.*, s.name AS sensor_name, s.unit, s.decimals, s.pond_id, p.name AS pond_name
       FROM alarms a
       JOIN sensors s ON s.tag = a.tag
       LEFT JOIN ponds p ON p.pond_id = s.pond_id
      WHERE a.id = $1`,
    [alarmId]
  );
  if (!alarm) return { sent: 0, skipped: 0 };

  // critical ต้องส่งเสมอ แม้อยู่ในช่วงเวลาเงียบ
  const quiet = await getSetting("notify.quiet_hours");
  if (alarm.severity !== "critical" && withinQuietHours(quiet)) {
    await logNotification(alarmId, null, kind, "skipped", "อยู่ในช่วงเวลางดแจ้งเตือน");
    await query(`UPDATE alarms SET last_notified_at = now() WHERE id=$1`, [alarmId]);
    return { sent: 0, skipped: 1 };
  }

  const recipients = await resolveRecipients(alarm.severity);
  const message = line.buildAlarmFlex(alarm, { kind });

  let sent = 0;
  let skipped = 0;

  if (!line.lineMessagingEnabled) {
    // ยังไม่ได้ตั้งค่า OA — บันทึกไว้ให้ตรวจสอบได้ว่าใครควรได้รับ
    for (const r of recipients) {
      await logNotification(alarmId, r.emp_code, kind, "skipped", "ยังไม่ได้ตั้งค่า LINE Messaging API");
      skipped++;
    }
    if (!recipients.length) {
      await logNotification(alarmId, null, kind, "skipped", "ไม่มีผู้รับที่เข้าเงื่อนไข");
    }
  } else {
    for (const r of recipients) {
      try {
        await line.pushTo(r.line_user_id, [message]);
        await logNotification(alarmId, r.emp_code, kind, "sent");
        sent++;
      } catch (err) {
        await logNotification(alarmId, r.emp_code, kind, "failed", err.message.slice(0, 500));
      }
    }
    if (!recipients.length) {
      await logNotification(alarmId, null, kind, "skipped", "ไม่มีผู้รับที่เข้าเงื่อนไข");
    }
  }

  if (kind !== "clear") {
    await query(
      `UPDATE alarms SET last_notified_at = now(), notify_count = notify_count + 1 WHERE id=$1`,
      [alarmId]
    );
  }
  return { sent, skipped };
}
