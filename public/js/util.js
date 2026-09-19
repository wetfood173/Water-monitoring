export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** สร้าง element พร้อม attribute และลูก — ใช้แทน innerHTML เมื่อมีข้อมูลจากผู้ใช้ */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "style") node.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** append ที่ข้าม null/undefined/false — DOM append เปล่า ๆ จะแปลงเป็นข้อความ "null" */
export function add(node, ...children) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ---------- รูปแบบตัวเลขและเวลา ---------- */

export const nf = (v, dp = 1) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? "—"
    : Number(v).toLocaleString("th-TH", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const nfInt = (v) =>
  v === null || v === undefined ? "—" : Math.round(Number(v)).toLocaleString("th-TH");

const TZ = { timeZone: "Asia/Bangkok" };

export const fmtTime = (v) =>
  v ? new Date(v).toLocaleTimeString("th-TH", { ...TZ, hour: "2-digit", minute: "2-digit" }) : "—";

export const fmtDateTime = (v) =>
  v
    ? new Date(v).toLocaleString("th-TH", {
        ...TZ,
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("th-TH", { ...TZ, day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

export function fmtDuration(ms) {
  if (ms == null) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} วินาที`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชม. ${m % 60} นาที`;
  return `${Math.floor(h / 24)} วัน ${h % 24} ชม.`;
}

/** ค่าสำหรับ <input type="datetime-local"> ตามเวลาไทย */
export function toLocalInput(date) {
  const d = new Date(date.getTime() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

/* ---------- toast ---------- */

export function toast(message, kind = "ok", ms = 4000) {
  let box = $("#toasts");
  if (!box) {
    box = el("div", { id: "toasts" });
    document.body.append(box);
  }
  const node = el("div", { class: `toast ${kind}` }, message);
  box.append(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transition = "opacity .2s";
    setTimeout(() => node.remove(), 220);
  }, ms);
}

/* ---------- modal ---------- */

export function modal({ title, body, confirmLabel = "บันทึก", onConfirm, danger = false }) {
  return new Promise((resolve) => {
    const close = (value) => {
      bg.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
    };

    const confirmBtn = el(
      "button",
      { class: danger ? "danger" : "primary" },
      confirmLabel
    );
    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      try {
        const value = onConfirm ? await onConfirm() : true;
        if (value !== false) close(value);
        else confirmBtn.disabled = false;
      } catch (err) {
        toast(err.message, "err");
        confirmBtn.disabled = false;
      }
    });

    const card = el(
      "div",
      { class: "modal", role: "dialog", "aria-modal": "true" },
      el("h3", {}, title),
      body,
      el(
        "div",
        { class: "actions" },
        el("button", { onclick: () => close(null) }, "ยกเลิก"),
        confirmBtn
      )
    );
    const bg = el("div", { class: "modal-bg", onclick: (e) => e.target === bg && close(null) }, card);
    document.body.append(bg);
    document.addEventListener("keydown", onKey);
    card.querySelector("input,select,textarea,button")?.focus();
  });
}

export const confirmDialog = (title, message, confirmLabel = "ยืนยัน") =>
  modal({ title, body: el("p", { style: "font-size:14px" }, message), confirmLabel, danger: true });

/* ---------- ป้ายกำกับ ---------- */

export const ROLE_LABEL = {
  staff: "พนักงาน",
  technician: "ช่างเทคนิค",
  engineer: "วิศวกร",
  admin: "ผู้ดูแลระบบ",
};

export const CONDITION_LABEL = {
  HH: "ระดับสูงเกินขีดจำกัด",
  LL: "ต่ำกว่าขีดจำกัด",
  HH_CRIT: "สูงถึงระดับวิกฤต",
  LL_CRIT: "ต่ำถึงระดับวิกฤต",
  NO_SIGNAL: "ขาดสัญญาณ",
};

export const SEVERITY_LABEL = { warning: "เตือน", critical: "วิกฤต" };

/** สถานะของค่าเทียบกับ setpoint — คืน "", "hi" หรือ "lo" */
export function statusOf(value, s) {
  if (value == null) return "";
  const n = Number(value);
  if (s.hh_critical != null && n >= Number(s.hh_critical)) return "hi";
  if (s.ll_critical != null && n <= Number(s.ll_critical)) return "lo";
  if (s.hh != null && n >= Number(s.hh)) return "hi";
  if (s.ll != null && n <= Number(s.ll)) return "lo";
  return "";
}
