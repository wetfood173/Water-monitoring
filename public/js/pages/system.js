import { api, download } from "../api.js";
import { $, el, clear, fmtDateTime, toast, modal, ROLE_LABEL } from "../util.js";

const ROLES = ["staff", "technician", "engineer", "admin"];

const PAGE_SIZE = 50;

export function systemPage(ctx) {
  const root = el("div");
  let settings = {};
  let status = {};
  let auditPage = 1;
  let notifPage = 1;

  root.append(
    el("div", { class: "page-head" },
      el("div", {},
        el("h2", {}, "ตั้งค่าระบบ"),
        el("p", {}, "ผู้รับแจ้งเตือน หน่วงเวลา ระยะเก็บข้อมูล และ audit log")))
  );

  const statusCard = el("div", { class: "card" }, el("h3", {}, "สถานะระบบ"), el("div", { id: "sysStatus" }));
  root.append(statusCard);

  const notifyCard = el("div", { class: "card" }, el("h3", {}, "การแจ้งเตือน"), el("div", { id: "notifyBox" }));
  root.append(notifyCard);

  const adminCard = el("div", { class: "card" }, el("h3", {}, "รหัส Admin"),
    el("p", { style: "font-size:13.5px;color:var(--mute);margin-bottom:12px" },
      "รหัสเก็บเป็น hash เท่านั้น เปลี่ยนแล้วรหัสเดิมทั้งหมดจะใช้ไม่ได้ทันที"),
    el("button", { onclick: changeAdminCode }, "เปลี่ยนรหัส Admin"));
  root.append(adminCard);

  const backupBtn = el("button", { class: "sm", onclick: runBackupNow }, "สำรองตอนนี้");
  const backupCard = el("div", { class: "card" },
    el("h3", {}, el("span", {}, "สำรองข้อมูล"), backupBtn),
    el("p", { style: "font-size:13.5px;color:var(--mute);margin-bottom:12px" },
      "สำรองอัตโนมัติทุกวัน เก็บไว้ 14 ไฟล์ล่าสุด — ดาวน์โหลดไปทดสอบกู้คืนได้ทุกไตรมาสตามที่กำหนดไว้"),
    el("div", { class: "tablewrap", id: "backupBox" }));
  root.append(backupCard);

  const auditCard = el("div", { class: "card" },
    el("h3", {}, el("span", {}, "Audit log"),
      el("select", { id: "auditFilter", style: "width:200px", onchange: () => { auditPage = 1; loadAudit(); } },
        el("option", { value: "" }, "ทุกประเภท"),
        el("option", { value: "auth." }, "การเข้าสู่ระบบ"),
        el("option", { value: "admin." }, "โหมดผู้ดูแลระบบ"),
        el("option", { value: "employee." }, "จัดการพนักงาน"),
        el("option", { value: "setpoint." }, "แก้ setpoint"),
        el("option", { value: "setting." }, "แก้ค่าตั้งระบบ"),
        el("option", { value: "alarm." }, "รับทราบแจ้งเตือน"),
        el("option", { value: "export." }, "ส่งออกข้อมูล"))),
    el("div", { class: "tablewrap", id: "auditBox" }));
  root.append(auditCard);

  const notifCard = el("div", { class: "card" }, el("h3", {}, "ประวัติการส่ง LINE ล่าสุด"), el("div", { class: "tablewrap", id: "notifBox" }));
  root.append(notifCard);

  function renderStatus() {
    const box = clear($("#sysStatus", root));
    const line = (k, ok, text) =>
      el("div", { style: "display:flex;gap:10px;align-items:center;padding:6px 0;font-size:13.5px" },
        el("span", { class: ok ? "dot" : "dot off" }),
        el("span", { style: "color:var(--mute);min-width:170px" }, k),
        el("span", {}, text));
    box.append(
      line("ฐานข้อมูล", true, status.backend === "postgres" ? "PostgreSQL" : "PGlite (ฝังในแอป — ใช้สำหรับพัฒนา)"),
      line("LINE Login", status.lineLogin, status.lineLogin ? "เปิดใช้งาน" : "ยังไม่ได้ตั้งค่า channel"),
      line("LINE Messaging API", status.lineMessaging, status.lineMessaging ? "เปิดใช้งาน" : "ยังไม่ได้ตั้งค่า — แจ้งเตือนจะบันทึกแต่ไม่ส่งจริง"),
      line("แหล่งข้อมูลวัด", !status.simulate,
        status.simulate
          ? "ข้อมูลจำลอง (SIMULATE=true)"
          : status.modbus?.enabled
            ? `Modbus TCP ${status.modbus.plcs?.filter((p) => p.connected).length ?? 0}/${status.modbus.plcs?.length ?? 0} PLC เชื่อมต่ออยู่`
            : "รับค่าจาก /api/ingest"),
      line("เข้าระบบแบบพัฒนา", !status.devLogin, status.devLogin ? "เปิดอยู่ — ต้องปิดก่อนขึ้น production" : "ปิด")
    );
  }

  function renderNotify() {
    const box = clear($("#notifyBox", root));
    const recipients = settings["notify.recipients"] ?? {};

    for (const sev of ["warning", "critical"]) {
      const rule = recipients[sev] ?? { roles: [], departments: "all" };
      const checks = ROLES.map((r) => {
        const cb = el("input", { type: "checkbox" });
        cb.checked = rule.roles.includes(r);
        cb.dataset.role = r;
        return el("label", { style: "display:flex;gap:6px;align-items:center;color:var(--bone);font-size:13px" }, cb, ROLE_LABEL[r]);
      });
      const deptSel = el("select", {},
        el("option", { value: "all", selected: rule.departments === "all" }, "ทุกหน่วยงาน"),
        el("option", { value: "related", selected: rule.departments === "related" }, "เฉพาะหน่วยงานที่เกี่ยวข้อง"));

      const saveBtn = el("button", {
        class: "sm primary",
        onclick: async () => {
          const next = {
            ...recipients,
            [sev]: {
              roles: checks.map((l) => l.querySelector("input")).filter((c) => c.checked).map((c) => c.dataset.role),
              departments: deptSel.value,
            },
          };
          await save("notify.recipients", next);
        },
      }, "บันทึก");

      box.append(
        el("div", { style: "border:1px solid var(--line);border-radius:3px;padding:12px;margin-bottom:12px" },
          el("div", { style: "font-size:13.5px;margin-bottom:10px" },
            el("span", { class: `pill ${sev}` }, sev === "warning" ? "ระดับเตือน" : "ระดับวิกฤต"),
            el("span", { style: "margin-left:8px;color:var(--mute)" }, "ส่งถึงสิทธิ์ระดับ")),
          el("div", { class: "row", style: "gap:14px" }, ...checks),
          el("div", { class: "row", style: "margin-top:12px" },
            el("div", { class: "field" }, el("label", {}, "ขอบเขตหน่วยงาน"), deptSel),
            saveBtn))
      );
    }

    const repeat = el("input", { type: "number", min: "5", max: "1440", value: settings["notify.repeat_minutes"] ?? 30 });
    const noSignal = el("input", { type: "number", min: "30", max: "86400", value: settings["alarm.no_signal_sec"] ?? 300 });
    const retention = el("input", { type: "number", min: "1", max: "120", value: settings["retention.raw_months"] ?? 12 });
    const retentionDays = el("input", { type: "number", min: "0", max: "3650", value: settings["retention.raw_days"] ?? 30 });
    const quiet = settings["notify.quiet_hours"] ?? { enabled: false, from: "22:00", to: "06:00" };
    const quietOn = el("input", { type: "checkbox" });
    quietOn.checked = quiet.enabled;
    const quietFrom = el("input", { type: "time", value: quiet.from });
    const quietTo = el("input", { type: "time", value: quiet.to });

    box.append(
      el("div", { class: "row", style: "margin-top:4px" },
        el("div", { class: "field" }, el("label", {}, "ส่งข้อความย้ำทุก (นาที) เมื่อยังไม่มีผู้รับทราบ"), repeat),
        el("button", { class: "sm primary", onclick: () => save("notify.repeat_minutes", Number(repeat.value)) }, "บันทึก")),
      el("div", { class: "row", style: "margin-top:12px" },
        el("div", { class: "field" }, el("label", {}, "ถือว่าขาดสัญญาณเมื่อไม่มีข้อมูลใหม่เกิน (วินาที)"), noSignal),
        el("button", { class: "sm primary", onclick: () => save("alarm.no_signal_sec", Number(noSignal.value)) }, "บันทึก")),
      el("div", { class: "row", style: "margin-top:12px" },
        el("div", { class: "field" }, el("label", {}, "เก็บข้อมูลดิบ (เดือน) — เกินกว่านี้จะลบ partition อัตโนมัติ"), retention),
        el("button", { class: "sm primary", onclick: () => save("retention.raw_months", Number(retention.value)) }, "บันทึก")),
      el("div", { class: "row", style: "margin-top:12px" },
        el("div", { class: "field" }, el("label", {}, "เก็บข้อมูลดิบไม่เกิน (วัน) — ตัดละเอียดกว่าด้านบน ลบทุกวัน (0 = ปิด)"), retentionDays),
        el("button", { class: "sm primary", onclick: () => save("retention.raw_days", Number(retentionDays.value)) }, "บันทึก")),
      el("div", { style: "margin-top:16px;border-top:1px solid var(--line);padding-top:14px" },
        el("label", { style: "display:flex;gap:8px;align-items:center;color:var(--bone);margin-bottom:10px" },
          quietOn, "งดส่งแจ้งเตือนระดับเตือนในช่วงเวลาที่กำหนด (ระดับวิกฤตยังส่งเสมอ)"),
        el("div", { class: "row" },
          el("div", { class: "field" }, el("label", {}, "ตั้งแต่"), quietFrom),
          el("div", { class: "field" }, el("label", {}, "ถึง"), quietTo),
          el("button", { class: "sm primary", onclick: () =>
            save("notify.quiet_hours", { enabled: quietOn.checked, from: quietFrom.value, to: quietTo.value }) }, "บันทึก")))
    );
  }

  async function save(key, value) {
    try {
      await api.put(`/api/system/settings/${encodeURIComponent(key)}`, { value });
      toast("บันทึกค่าตั้งแล้ว");
      await load();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  async function changeAdminCode() {
    const current = el("input", { type: "password", autocomplete: "off" });
    const next = el("input", { type: "password", autocomplete: "new-password" });
    const confirm = el("input", { type: "password", autocomplete: "new-password" });
    const ok = await modal({
      title: "เปลี่ยนรหัส Admin",
      confirmLabel: "เปลี่ยนรหัส",
      body: el("div", {},
        el("div", { class: "field" }, el("label", {}, "รหัสเดิม"), current),
        el("div", { class: "field" }, el("label", {}, "รหัสใหม่ (อย่างน้อย 8 ตัวอักษร)"), next),
        el("div", { class: "field" }, el("label", {}, "ยืนยันรหัสใหม่"), confirm)),
      onConfirm: async () => {
        if (next.value !== confirm.value) throw new Error("รหัสใหม่ทั้งสองช่องไม่ตรงกัน");
        return api.post("/auth/admin-code/change", { current: current.value, next: next.value });
      },
    });
    if (ok) toast("เปลี่ยนรหัส Admin แล้ว");
  }

  /** แถบเปลี่ยนหน้า — ใส่ไว้ท้ายตารางที่แบ่งหน้า ป้องกันหน้าเดียวยาวเกินไปเมื่อข้อมูลเยอะขึ้นตอนใช้งานจริง */
  function renderPager(box, { page, total, limit, onChange }) {
    const totalPages = Math.max(1, Math.ceil(total / limit));
    box.append(
      el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:13px;color:var(--mute)" },
        el("span", {}, `ทั้งหมด ${total.toLocaleString("th-TH")} รายการ · หน้า ${page}/${totalPages}`),
        el("div", { class: "row", style: "gap:6px" },
          el("button", { class: "sm", disabled: page <= 1, onclick: () => onChange(page - 1) }, "← ก่อนหน้า"),
          el("button", { class: "sm", disabled: page >= totalPages, onclick: () => onChange(page + 1) }, "ถัดไป →")))
    );
  }

  async function loadAudit() {
    const action = $("#auditFilter", root)?.value ?? "";
    try {
      const { entries, total } = await api.get(
        `/api/system/audit?limit=${PAGE_SIZE}&page=${auditPage}${action ? `&action=${encodeURIComponent(action)}` : ""}`
      );
      const box = clear($("#auditBox", root));
      if (!entries.length) return box.append(el("div", { class: "empty" }, "ยังไม่มีบันทึก"));
      const table = el("table");
      table.append(el("thead", {}, el("tr", {},
        el("th", {}, "เวลา"), el("th", {}, "ผู้ทำ"), el("th", {}, "การกระทำ"),
        el("th", {}, "เป้าหมาย"), el("th", {}, "ค่าเดิม"), el("th", {}, "ค่าใหม่"), el("th", {}, "IP"))));
      const body = el("tbody");
      for (const e of entries) {
        body.append(el("tr", {},
          el("td", { class: "num" }, fmtDateTime(e.created_at)),
          el("td", {}, e.full_name ? `${e.full_name} · ${e.emp_code}` : e.emp_code ?? "—"),
          el("td", {}, e.action),
          el("td", {}, e.target ?? "—"),
          el("td", { class: "wrap", style: "font-size:11.5px;color:var(--mute)" }, e.old_value ? JSON.stringify(e.old_value) : "—"),
          el("td", { class: "wrap", style: "font-size:11.5px;color:var(--mute)" }, e.new_value ? JSON.stringify(e.new_value) : "—"),
          el("td", { class: "num" }, e.ip_address ?? "—")));
      }
      table.append(body);
      box.append(table);
      renderPager(box, { page: auditPage, total, limit: PAGE_SIZE, onChange: (p) => { auditPage = p; loadAudit(); } });
    } catch (err) {
      toast(err.message, "err");
    }
  }

  async function loadNotifications() {
    try {
      const { log, total } = await api.get(`/api/system/notifications?limit=${PAGE_SIZE}&page=${notifPage}`);
      const box = clear($("#notifBox", root));
      if (!log.length) return box.append(el("div", { class: "empty" }, "ยังไม่มีการส่งแจ้งเตือน"));
      const table = el("table");
      table.append(el("thead", {}, el("tr", {},
        el("th", {}, "เวลา"), el("th", {}, "แจ้งเตือน"), el("th", {}, "ผู้รับ"),
        el("th", {}, "ชนิด"), el("th", {}, "สถานะ"), el("th", {}, "รายละเอียด"))));
      const body = el("tbody");
      for (const n of log) {
        body.append(el("tr", {},
          el("td", { class: "num" }, fmtDateTime(n.sent_at)),
          el("td", {}, n.tag ? `${n.tag} · ${n.condition}` : `#${n.alarm_id}`),
          el("td", {}, n.full_name ?? n.emp_code ?? "—"),
          el("td", {}, { raise: "แจ้งครั้งแรก", repeat: "ย้ำซ้ำ", clear: "คืนสภาพ" }[n.kind] ?? n.kind),
          el("td", {}, { sent: "ส่งแล้ว", failed: "ส่งไม่สำเร็จ", skipped: "ข้าม" }[n.status] ?? n.status),
          el("td", { class: "wrap", style: "color:var(--mute);font-size:12px" }, n.error_detail ?? "")));
      }
      table.append(body);
      box.append(table);
      renderPager(box, { page: notifPage, total, limit: PAGE_SIZE, onChange: (p) => { notifPage = p; loadNotifications(); } });
    } catch (err) {
      toast(err.message, "err");
    }
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  async function loadBackups() {
    try {
      const { backups, supported } = await api.get("/api/system/backups");
      const box = clear($("#backupBox", root));
      backupBtn.disabled = !supported;
      if (!supported) {
        return box.append(el("p", { style: "font-size:13.5px;color:var(--mute)" },
          `ฐานข้อมูลปัจจุบัน (${status.backend ?? "?"}) ยังไม่รองรับการสำรองข้อมูลอัตโนมัติจากในระบบ — ใช้เครื่องมือสำรองของฐานข้อมูลนั้นแทน`));
      }
      if (!backups.length) return box.append(el("p", { style: "font-size:13.5px;color:var(--mute)" }, "ยังไม่มีไฟล์สำรอง"));
      const table = el("table");
      table.append(el("thead", {}, el("tr", {},
        el("th", {}, "เวลาที่สำรอง"), el("th", { class: "right" }, "ขนาด"), el("th", {}, ""))));
      const body = el("tbody");
      for (const b of backups) {
        body.append(el("tr", {},
          el("td", { class: "num" }, fmtDateTime(b.createdAt)),
          el("td", { class: "right num" }, fmtSize(b.size)),
          el("td", {}, el("button", {
            class: "sm",
            onclick: () => download(`/api/system/backups/${b.name}`).catch((err) => toast(err.message, "err")),
          }, "ดาวน์โหลด"))));
      }
      table.append(body);
      box.append(table);
    } catch (err) {
      toast(err.message, "err");
    }
  }

  async function runBackupNow() {
    backupBtn.disabled = true;
    try {
      await api.post("/api/system/backups");
      toast("สำรองข้อมูลแล้ว");
      await loadBackups();
    } catch (err) {
      toast(err.message, "err");
    } finally {
      backupBtn.disabled = false;
    }
  }

  async function load() {
    try {
      const data = await api.get("/api/system/settings");
      settings = Object.fromEntries(data.settings.map((s) => [s.key, s.value]));
      status = data.status;
      renderStatus();
      renderNotify();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  load().then(() => Promise.all([loadAudit(), loadNotifications(), loadBackups()]));
  return { node: root };
}
