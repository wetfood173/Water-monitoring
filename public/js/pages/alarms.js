import { api } from "../api.js";
import { $, $$, el, clear, nf, fmtDateTime, fmtDuration, toast, modal,
  CONDITION_LABEL, SEVERITY_LABEL } from "../util.js";

const FILTERS = [
  { key: "open", label: "ที่ยังไม่คืนสภาพ" },
  { key: "unacked", label: "ยังไม่รับทราบ" },
  { key: "cleared", label: "คืนสภาพแล้ว" },
  { key: "all", label: "ทั้งหมด" },
];

export function alarmsPage(ctx) {
  const root = el("div");
  let status = "open";
  let severity = "";

  const counts = el("span", { class: "num", style: "color:var(--mute)" });
  root.append(
    el(
      "div",
      { class: "page-head" },
      el("div", {}, el("h2", {}, "แจ้งเตือน"), el("p", {}, "รายการทั้งหมด กดรับทราบพร้อมใส่หมายเหตุ และดูประวัติการส่ง LINE")),
      counts
    )
  );

  const seg = el("div", { class: "seg", role: "tablist" });
  for (const f of FILTERS) {
    seg.append(
      el(
        "button",
        {
          role: "tab",
          "aria-selected": String(f.key === status),
          dataset: { k: f.key },
          onclick: () => {
            status = f.key;
            $$("button", seg).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.k === f.key)));
            load();
          },
        },
        f.label
      )
    );
  }

  const sevSelect = el(
    "select",
    { onchange: (e) => ((severity = e.target.value), load()) },
    el("option", { value: "" }, "ทุกระดับ"),
    el("option", { value: "warning" }, "เตือน"),
    el("option", { value: "critical" }, "วิกฤต")
  );

  const ackAllBtn = el(
    "button",
    {
      class: "primary",
      onclick: async () => {
        const note = el("textarea", { rows: "2", placeholder: "หมายเหตุ (ไม่บังคับ)" });
        const ok = await modal({
          title: "รับทราบทั้งหมด",
          body: el("div", {},
            el("p", { style: "font-size:14px;margin-bottom:12px" }, "รับทราบแจ้งเตือนที่ยังไม่คืนสภาพและยังไม่มีผู้รับทราบทั้งหมด"),
            el("div", { class: "field" }, el("label", {}, "หมายเหตุ"), note)),
          confirmLabel: "รับทราบทั้งหมด",
          onConfirm: async () => api.post("/api/alarms/ack-all", { note: note.value || null }),
        });
        if (ok) {
          toast(ok.count ? `รับทราบ ${ok.count} รายการแล้ว` : "ไม่มีรายการที่ต้องรับทราบ");
          load();
        }
      },
    },
    "รับทราบทั้งหมด"
  );

  root.append(
    el(
      "div",
      { class: "card" },
      el("h3", {},
        el("div", { class: "row", style: "gap:12px" }, seg, el("div", { style: "width:150px" }, sevSelect)),
        ctx.can("technician") ? ackAllBtn : null),
      el("div", { class: "tablewrap", id: "alarmTable" }, el("div", { class: "empty" }, "กำลังโหลด…"))
    )
  );

  async function showDetail(id) {
    const { alarm, notifications } = await api.get(`/api/alarms/${id}`);
    const rows = notifications.length
      ? notifications.map((n) =>
          el("tr", {},
            el("td", {}, fmtDateTime(n.sent_at)),
            el("td", {}, n.full_name ?? n.emp_code ?? "—"),
            el("td", {}, { raise: "แจ้งครั้งแรก", repeat: "ย้ำซ้ำ", clear: "คืนสภาพ" }[n.kind] ?? n.kind),
            el("td", {}, { sent: "ส่งแล้ว", failed: "ส่งไม่สำเร็จ", skipped: "ข้าม" }[n.status] ?? n.status),
            el("td", { class: "wrap" }, n.error_detail ?? ""))
        )
      : [el("tr", {}, el("td", { colspan: "5" }, "ยังไม่มีประวัติการส่ง"))];

    await modal({
      title: `แจ้งเตือน #${alarm.id} · ${alarm.tag}`,
      confirmLabel: "ปิด",
      body: el("div", {},
        el("table", { style: "margin-bottom:16px" },
          el("tbody", {},
            row("จุดวัด", `${alarm.sensor_name} (${alarm.tag})`),
            row("บ่อ", alarm.pond_id ?? "—"),
            row("ระดับ", SEVERITY_LABEL[alarm.severity] ?? alarm.severity),
            row("เงื่อนไข", CONDITION_LABEL[alarm.condition] ?? alarm.condition),
            row("ค่าที่ทำให้เกิด", alarm.trigger_value == null ? "—" : `${nf(alarm.trigger_value, alarm.decimals)} ${alarm.unit}`),
            row("ขีดจำกัด", alarm.threshold == null ? "—" : `${nf(alarm.threshold, alarm.decimals)} ${alarm.unit}`),
            row("เวลาที่เกิด", fmtDateTime(alarm.raised_at)),
            row("เวลาคืนสภาพ", alarm.cleared_at ? fmtDateTime(alarm.cleared_at) : "ยังไม่คืนสภาพ"),
            row("ระยะเวลา", fmtDuration((alarm.cleared_at ? new Date(alarm.cleared_at) : new Date()) - new Date(alarm.raised_at))),
            row("ผู้รับทราบ", alarm.acked_at ? `${alarm.acked_by_name ?? alarm.acked_by} · ${fmtDateTime(alarm.acked_at)}` : "ยังไม่มี"),
            row("หมายเหตุ", alarm.ack_note ?? "—"),
            row("จำนวนครั้งที่ส่ง", alarm.notify_count))),
        el("h3", { style: "font-size:13px;color:var(--mute);margin-bottom:8px" }, "ประวัติการส่งแจ้งเตือน"),
        el("div", { class: "tablewrap" },
          el("table", {},
            el("thead", {}, el("tr", {}, el("th", {}, "เวลา"), el("th", {}, "ผู้รับ"), el("th", {}, "ชนิด"), el("th", {}, "สถานะ"), el("th", {}, "รายละเอียด"))),
            el("tbody", {}, rows)))),
    });
  }

  const row = (k, v) => el("tr", {}, el("td", { style: "color:var(--mute);width:38%" }, k), el("td", { class: "wrap" }, String(v)));

  async function ack(alarm) {
    const note = el("textarea", { rows: "3", placeholder: "เช่น เปิดวาล์วระบายแล้ว รอค่ากลับเข้าช่วง" });
    const ok = await modal({
      title: `รับทราบ · ${alarm.tag}`,
      body: el("div", {},
        el("p", { style: "font-size:14px;margin-bottom:12px" },
          `${CONDITION_LABEL[alarm.condition] ?? alarm.condition}${alarm.pond_id ? ` · บ่อ ${alarm.pond_id}` : ""}`),
        el("div", { class: "field" }, el("label", {}, "หมายเหตุ"), note)),
      confirmLabel: "บันทึกการรับทราบ",
      onConfirm: async () => api.post(`/api/alarms/${alarm.id}/ack`, { note: note.value || null }),
    });
    if (ok) {
      toast("บันทึกการรับทราบแล้ว");
      load();
    }
  }

  async function load() {
    const params = new URLSearchParams({ status, limit: "200" });
    if (severity) params.set("severity", severity);
    try {
      const { alarms, counts: c } = await api.get(`/api/alarms?${params}`);
      counts.textContent = `ค้างอยู่ ${c.open} รายการ · ยังไม่รับทราบ ${c.unacked}`;
      ackAllBtn.disabled = !c.unacked;

      const box = clear($("#alarmTable", root));
      if (!alarms.length) {
        box.append(el("div", { class: "empty" }, "ไม่มีรายการในเงื่อนไขนี้"));
        return;
      }
      const table = el("table");
      table.append(
        el("thead", {}, el("tr", {},
          el("th", {}, "เวลาที่เกิด"), el("th", {}, "จุดวัด"), el("th", {}, "บ่อ"),
          el("th", {}, "เงื่อนไข"), el("th", { class: "right" }, "ค่า"), el("th", { class: "right" }, "ขีดจำกัด"),
          el("th", {}, "สถานะ"), el("th", {}, "ผู้รับทราบ"), el("th", {}, "")))
      );
      const body = el("tbody");
      for (const a of alarms) {
        body.append(
          el("tr", {},
            el("td", { class: "num" }, fmtDateTime(a.raised_at)),
            el("td", {}, el("i", { class: `sev ${a.severity}` }), a.tag),
            el("td", {}, a.pond_id ?? "—"),
            el("td", {}, CONDITION_LABEL[a.condition] ?? a.condition),
            el("td", { class: "right num" }, a.trigger_value == null ? "—" : `${nf(a.trigger_value, a.decimals)} ${a.unit}`),
            el("td", { class: "right num" }, a.threshold == null ? "—" : nf(a.threshold, a.decimals)),
            el("td", {}, a.cleared_at
              ? el("span", { class: "pill ok" }, "คืนสภาพแล้ว")
              : el("span", { class: `pill ${a.severity}` }, "ยังไม่คืนสภาพ")),
            el("td", { class: "wrap" }, a.acked_at ? `${a.acked_by_name ?? a.acked_by} · ${fmtDateTime(a.acked_at)}` : "—"),
            el("td", {},
              el("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" },
                el("button", { class: "sm", onclick: () => showDetail(a.id).catch((e) => toast(e.message, "err")) }, "รายละเอียด"),
                !a.acked_at && ctx.can("technician")
                  ? el("button", { class: "sm primary", onclick: () => ack(a) }, "รับทราบ")
                  : null)))
        );
      }
      table.append(body);
      box.append(table);
    } catch (err) {
      toast(err.message, "err");
    }
  }

  load();

  // เปิดรายละเอียดโดยตรงจากลิงก์ในข้อความ LINE เช่น #/alarms?id=12
  const id = new URLSearchParams(location.hash.split("?")[1] ?? "").get("id");
  if (id) showDetail(Number(id)).catch((e) => toast(e.message, "err"));

  const timer = setInterval(() => !document.hidden && load(), 15000);
  return { node: root, destroy: () => clearInterval(timer) };
}
