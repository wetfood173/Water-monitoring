import { POND_COLOR, colorForTag } from "./chart.js";

/**
 * ผังบ่อและทิศทางการไหล — ค่าเริ่มต้นบนแคนวาส 1120 × 684
 * แอดมินจัดผังใหม่ได้จากปุ่ม "แก้ไขผัง" (เก็บใน dashboard.diagram) — ค่าด้านล่างใช้เมื่อยังไม่เคยจัด
 */

export const LAYOUT = {
  // แถวบ่อจัดกึ่งกลางแคนวาส เว้นซ้าย 34 ให้ป้ายอุณหภูมิ และเว้นขวา 36 ให้ Softener
  "5":    { x: 158, y: 170, w: 134, h: 155 },
  "4":    { x: 326, y: 170, w: 134, h: 155 },
  "3":    { x: 494, y: 170, w: 134, h: 155 },
  "2":    { x: 662, y: 170, w: 134, h: 155 },
  "1B":   { x: 830, y: 170, w: 134, h: 62, sm: true },
  "1A":   { x: 830, y: 262, w: 134, h: 62, sm: true },
  // บ่อแยกอิสระ ชิดขอบซ้ายล่าง คู่กับหน้าปัดเข็มที่อยู่ขวาล่าง
  "600Q": { x: 40,  y: 460, w: 230, h: 120 },
};

export const PIPES = [
  "M225 170 V60 H845 V166",   // บ่อ 5 → Cooling Tower → บ่อ 1B
  "M745 170 V110 H573 V166",  // บ่อ 2 → Cooling Tower → บ่อ 3
  "M393 36 V166",             // Retort F–N → บ่อ 4
  "M729 36 V166",             // Retort A–E → บ่อ 2
  "M760 325 V395 H417 V329",  // บ่อ 2 → บ่อ 4
  "M326 245 H300",            // บ่อ 4 → บ่อ 5
  "M662 245 H636",            // บ่อ 2 → บ่อ 3
  "M830 201 H804",            // บ่อ 1B → บ่อ 2
  "M998 201 H972",            // Softener → บ่อ 1B (เข้าทางด้านขวา)
  "M998 293 H972",            // Softener → บ่อ 1A (เข้าทางด้านขวา)
  "M0 520 H36",               // ท่อน้ำเข้า → บ่อ 600Q
];

export const TAPS = ["M126 247 H156", "M274 512 H288"];

export const EQUIPS = [
  { x: 328, y: 10, w: 130, h: 26, label: "Retort F–N" },
  { x: 664, y: 10, w: 130, h: 26, label: "Retort A–E" },
  { x: 400, y: 47, w: 124, h: 26, label: "Cooling Tower" },
  { x: 600, y: 97, w: 100, h: 26, label: "Cooling Tower" },
];

/** ป้ายเซนเซอร์ที่วางข้างถัง แยกจากตัวเลขระดับน้ำเพื่อไม่ให้สับสน */
export const SENSOR_TAGS = [
  // TT-TANK5 อยู่ด้านซ้ายบ่อ 5
  { x: 12,  y: 212, tag: "TT-TANK5", label: "อุณหภูมิน้ำ · TT-TANK5",       color: "#E08A4F" },
  { x: 292, y: 485, tag: "FT-600Q", label: "อัตราไหลขาเข้า · FT-600Q",   color: "#5B9BD5" },
];

/** หน้าปัดเข็มแรงดัน — ชิดขอบขวาล่าง (กล่อง .dial กว้าง 254) */
export const DIALS = [
  { tag: "PT-AIR", x: 572, y: 425, color: "#8FB9DC" },
  { tag: "PT-STM", x: 836, y: 425, color: "#C9A227" },
];

/** การจัดกลุ่มและลำดับในมุมมองมือถือ */
export const MOBILE_GROUPS = [
  { heading: "สายน้ำหล่อเย็น (ตามทิศทางการไหล)", ids: ["1B", "2", "3", "4", "5"], chain: true },
  { heading: "บ่อแยกอิสระ", ids: ["1A", "600Q"], chain: false },
];

export const SOFTENER_SVG = `<svg viewBox="0 0 100 84" width="100" height="84" aria-hidden="true">
  <g fill="#16333D" stroke="#6FA9B4" stroke-width="2.2" stroke-linejoin="round">
    <rect x="22" y="2" width="7" height="9" rx="1.5"/>
    <rect x="41" y="2" width="7" height="9" rx="1.5"/>
    <path d="M14 20 H5 V34" fill="none"/>
    <path d="M58 20 H80 V44" fill="none"/>
    <rect x="14" y="10" width="44" height="20" rx="3"/>
    <rect x="16" y="34" width="40" height="46" rx="5"/>
    <rect x="68" y="44" width="26" height="36" rx="4"/>
  </g>
  <rect x="20" y="15" width="15" height="10" rx="2" fill="#3FB4A8"/>
  <circle cx="47" cy="17" r="2.2" fill="#6FA9B4"/>
  <circle cx="47" cy="24" r="2.2" fill="#6FA9B4"/>
  <path d="M36 48 c6 8 10 12 10 16 a10 10 0 0 1 -20 0 c0 -4 4 -8 10 -16 z" fill="#3FB4A8"/>
</svg>`;

/* ---------- ผังที่แอดมินจัดเองได้ ----------
 * model = { items: [...], pipes: [...] } พิกัดเป็น px บนแคนวาส 1120 × 684
 * items: tank (pond) · equip (label) · softener · tap/dial/bar (tag) — tap/dial/bar กำหนดแค่ความกว้าง สูงตามเนื้อหา
 * pipes: { id, style: "flow" | "dashed", pts: [[x, y], ...] } — flow = ท่อน้ำมีหัวลูกศรและน้ำไหล, dashed = เส้นประโยงป้ายเซนเซอร์
 */

export const CANVAS = { W: 1120, H: 684 };

/** แปลง path แบบ "M225 170 V60 H845 V166" (ใช้แค่ M/L/H/V) เป็นรายการจุด */
function parsePath(d) {
  const pts = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MLHV])\s*([-\d.\s]+)/g)) {
    const n = args.trim().split(/\s+/).map(Number);
    if (cmd === "H") x = n[0];
    else if (cmd === "V") y = n[0];
    else [x, y] = n;
    pts.push([x, y]);
  }
  return pts;
}

/** ผังเริ่มต้น — ตรงกับผังที่วาดมือไว้เดิม (LAYOUT, PIPES, ...) */
export function defaultDiagram(sensors, hiddenTags = new Set()) {
  const has = (tag) => sensors.some((s) => s.tag === tag) && !hiddenTags.has(tag);
  return {
    items: [
      ...Object.entries(LAYOUT).map(([pond, b]) => ({ id: `tank-${pond}`, kind: "tank", pond, x: b.x, y: b.y, w: b.w, h: b.h })),
      ...EQUIPS.map((e, i) => ({ id: `eq-${i}`, kind: "equip", label: e.label, x: e.x, y: e.y, w: e.w, h: e.h })),
      { id: "softener", kind: "softener", x: 1000, y: 187, w: 110, h: 120 },
      ...SENSOR_TAGS.filter((t) => has(t.tag)).map((t) => ({
        id: `tap-${t.tag}`, kind: "tap", tag: t.tag, label: t.label, color: t.color, x: t.x, y: t.y, w: 112,
      })),
      ...DIALS.filter((d) => has(d.tag)).map((d) => ({
        id: `dial-${d.tag}`, kind: "dial", tag: d.tag, color: d.color, x: d.x, y: d.y, w: 254,
      })),
    ],
    pipes: [
      ...PIPES.map((d, i) => ({ id: `pipe-${i}`, style: "flow", pts: parsePath(d) })),
      ...TAPS.map((d, i) => ({ id: `link-${i}`, style: "dashed", pts: parsePath(d) })),
    ],
  };
}

const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

let markerSeq = 0;

/** ตัวหนา: true = หนา, false = ปกติ, ไม่ตั้ง = ตามค่าเริ่มต้นของชิ้นนั้น */
export const weight = (flag) => (flag == null ? "" : flag ? "700" : "400");

/**
 * รูปแบบตัวเลขค่าที่อ่านได้จากสัญญาณ (ขนาด/ตัวหนา) — scale = สัดส่วนที่ชิ้นถูกย่อ/ขยายทั้งชิ้น
 * หารขนาดด้วย scale ให้ตัวเลขบนจอออกมาเท่าที่ตั้งไว้จริง
 */
export function styleValue(node, it, scale = 1) {
  if (!node) return;
  if (it.valueSize) node.style.fontSize = `${it.valueSize / scale}px`;
  node.style.fontWeight = weight(it.valueBold);
  // สีตอนค่าปกติ — ตอนหลุด LL/HH หน้า Dashboard ยังเปลี่ยนเป็นสีเตือน/สีแดงทับเสมอ (อ่านจาก data-vnormal)
  if (it.valueColor) {
    node.dataset.vnormal = it.valueColor;
    node.style.color = it.valueColor;
    node.style.fill = it.valueColor;
  }
}

/** สีตัวหนังสือของข้อความ (ชื่อ/ป้าย) */
const styleText = (node, it) => {
  if (node && it.textColor) node.style.color = it.textColor;
};

/** ความกว้างมาตรฐานของชิ้นที่ย่อ/ขยายทั้งชิ้นตามความกว้าง (px) */
export const SCALED_WIDTH = { tap: 112, dial: 254, bar: 200 };

/**
 * วาดผังลงใน area (element .canvas) — editing = โหมดแก้ไขผัง: ท่อคลิกได้ และไม่ผูกคลิกไปเลือกกราฟ
 * onSelect(tag) ถูกเรียกเมื่อคลิกถัง/ป้ายค่าในโหมดดูปกติ
 */
export function renderDiagram(area, model, { sensors, editing = false, onSelect = null }) {
  area.textContent = "";
  const sensorOf = (tag) => sensors.find((s) => s.tag === tag);
  const clickable = (node, tag) => {
    if (editing || !onSelect || !tag) return;
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.addEventListener("click", () => onSelect(tag));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(tag);
      }
    });
  };
  const box = (it, cls, extra = "") => {
    const n = document.createElement("div");
    n.className = cls;
    n.dataset.eid = it.id;
    // ป้ายค่า/หน้าปัด/เกจกำหนดแค่ความกว้าง — วาดที่ความกว้างมาตรฐานแล้วย่อ/ขยายทั้งชิ้น
    // ตัวหนังสือ ระยะขอบ และเส้นขอบจึงโตตามขนาดที่ลากไว้ในสัดส่วนเดิม
    const base = SCALED_WIDTH[it.kind];
    const size = base
      ? `width:${base}px;transform:scale(${it.w / base});transform-origin:0 0;`
      : `width:${it.w}px;${it.h ? `height:${it.h}px;` : ""}`;
    n.style.cssText = `left:${it.x}px;top:${it.y}px;${size}${extra}`;
    return n;
  };

  // ท่อ — วาดทับถัง (z-index สูงกว่า) เพื่อให้หัวลูกศรชี้เข้าปากถังได้
  const marker = `ah${++markerSeq}`;
  const svg = svgEl("svg", { class: "pipes", viewBox: `0 0 ${CANVAS.W} ${CANVAS.H}`, "aria-hidden": "true" });
  svg.innerHTML = `<defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
    <path d="M0 0 L10 5 L0 10 z" fill="var(--pipe)"/></marker></defs>`;
  // ชิ้น/ท่อที่ซ่อนไว้ (วางไว้ก่อนแต่ยังไม่แสดง) — โหมดดูปกติไม่วาดเลย โหมดแก้ไขวาดจาง ๆ ให้จัดต่อได้
  for (const p of model.pipes) {
    if (!p.pts?.length || (p.hidden && !editing)) continue;
    const d = "M" + p.pts.map(([x, y]) => `${x} ${y}`).join(" L");
    if (p.style === "dashed") {
      svg.append(svgEl("path", { d, fill: "none", stroke: "var(--mute)", "stroke-width": "1.5", "stroke-dasharray": "3 3" }));
    } else {
      svg.append(
        svgEl("path", { d, fill: "none", stroke: "#0B1A20", "stroke-width": "6", "stroke-linejoin": "round" }),
        svgEl("path", { d, fill: "none", stroke: "var(--pipe)", "stroke-width": "2", "stroke-linejoin": "round", "marker-end": `url(#${marker})` }),
        svgEl("path", {
          d, fill: "none", stroke: "#fff", "stroke-width": "2", "stroke-linejoin": "round",
          "stroke-dasharray": "3 21", opacity: ".8", style: "animation:dash 1.6s linear infinite",
        })
      );
    }
    // เส้นโปร่งใสหนา ๆ ไว้ให้คลิกโดนท่อง่ายในโหมดแก้ไข
    if (p.hidden) for (const n of [...svg.children].slice(-(p.style === "dashed" ? 1 : 3))) n.setAttribute("opacity", ".3");
    if (editing) svg.append(svgEl("path", { d, class: "pipehit", "data-pid": p.id }));
  }
  area.append(svg);

  const before = area.childElementCount;
  for (const it of model.items) {
    if (it.hidden && !editing) continue;
    if (it.kind === "tank") {
      const sm = it.h < 100;
      const n = box(it, "tank" + (sm ? " sm" : ""), `--tank:${it.color ?? POND_COLOR[it.pond] ?? "var(--line)"}`);
      const vessel = document.createElement("div");
      vessel.className = "vessel";
      vessel.setAttribute("aria-label", `บ่อ ${it.pond}`);
      vessel.innerHTML = `<div class="water" data-water="${it.pond}" style="height:0%"></div>
        <div class="pctbox"><div class="p num"><span data-pct="${it.pond}">—</span><i>%</i></div>
        ${sm ? "" : `<div class="m3 num" data-vol="${it.pond}"></div>`}</div>`;
      clickable(vessel, `LT-${it.pond}`);
      const cap = document.createElement("div");
      cap.className = "caption";
      cap.style.top = `${it.h + 8}px`;
      cap.textContent = it.label || `บ่อ ${it.pond}`;
      if (it.fontSize) cap.style.fontSize = `${it.fontSize}px`;
      cap.style.fontWeight = weight(it.bold);
      styleText(cap, it);
      styleValue(vessel.querySelector(".pctbox .p"), it);
      n.append(vessel, cap);
      area.append(n);
    } else if (it.kind === "equip") {
      // ตัวหนังสือในกล่องอุปกรณ์: ตั้งขนาดเองได้ ไม่ตั้ง = สูงครึ่งหนึ่งของกล่อง (กล่องมาตรฐานสูง 26 → 13px)
      const lines = String(it.label ?? "").split("\n").length;
      const size = it.fontSize ?? Math.max(8, it.h / (lines + 1));
      const n = box(it, "eqbox", `font-size:${size}px;${it.color ? `border-color:${it.color}` : ""}`);
      n.textContent = it.label ?? "";
      n.style.fontWeight = weight(it.bold);
      styleText(n, it);
      area.append(n);
    } else if (it.kind === "softener") {
      const n = box(it, "softener", it.color ? `border:1px solid ${it.color};border-radius:8px` : "");
      n.innerHTML = `${SOFTENER_SVG}<b></b>`;
      const b = n.querySelector("b");
      b.textContent = it.label || "Softener";
      if (it.fontSize) b.style.fontSize = `${it.fontSize}px`;
      b.style.fontWeight = weight(it.bold);
      styleText(b, it);
      area.append(n);
    } else {
      const s = sensorOf(it.tag);
      if (it.kind === "tap") {
        const n = box(it, "tap", `border-left:2px solid ${it.color ?? colorForTag(it.tag, s?.pond_id)}`);
        const small = document.createElement("small");
        small.textContent = it.label || (s ? `${s.name} · ${s.tag}` : it.tag);
        // ป้ายค่าถูกย่อ/ขยายทั้งชิ้น — หารด้วยสัดส่วนนั้นให้ตัวหนังสือบนจอออกมาเท่าที่ตั้งไว้จริง
        if (it.fontSize) small.style.fontSize = `${it.fontSize / (it.w / SCALED_WIDTH.tap)}px`;
        const tv = document.createElement("div");
        tv.className = "tv";
        tv.innerHTML = `<b class="num" data-tapval="${it.tag}">—</b><i></i>`;
        tv.querySelector("i").textContent = s?.unit ?? "";
        small.style.fontWeight = weight(it.bold);
        styleText(small, it);
        styleValue(tv.querySelector("b"), it, it.w / SCALED_WIDTH.tap);
        n.append(small, tv);
        clickable(n, it.tag);
        area.append(n);
      } else if (it.kind === "dial") {
        const color = it.color ?? colorForTag(it.tag, s?.pond_id);
        const n = box(it, "dial");
        n.dataset.dial = it.tag;
        n.dataset.color = color;
        if (!s) n.textContent = `ไม่พบจุดวัด ${it.tag}`;
        else {
          n.innerHTML = `<div class="dtitle"><span><span data-name></span><small>${s.tag}</small></span>
            <span class="dstate" data-dialstate>ปกติ</span></div>${buildDialSvg(s, color)}`;
          n.querySelector("[data-name]").textContent = s.name;
          // ตัวเลขในหน้าปัดอยู่ใน SVG (หน่วยของ viewBox ≈ px ที่ขนาดมาตรฐาน)
          styleValue(n.querySelector("[data-dialval]"), it, it.w / SCALED_WIDTH.dial);
        }
        clickable(n, it.tag);
        area.append(n);
      } else if (it.kind === "bar") {
        const n = box(it, "gauge dgauge", it.color ? `border-color:${it.color}` : "");
        if (!s) n.textContent = `ไม่พบจุดวัด ${it.tag}`;
        else {
          const min = Number(s.range_min ?? 0);
          const max = Number(s.range_max ?? 100);
          const mark = (v) => (v == null ? "" : `<i class="mark" style="left:${((Number(v) - min) / (max - min)) * 100}%"></i>`);
          n.dataset.gauge = s.tag;
          n.innerHTML = `<div class="lbl"><span data-name></span><small>${s.tag}</small></div>
            <div class="read"><b data-gval>—</b><i>${s.unit}</i></div>
            <div class="bar"><span data-gbar></span>${mark(s.ll)}${mark(s.hh)}</div>
            <div class="range"><span>LL ${s.ll ?? "—"}</span><span data-gstate>ปกติ</span><span>HH ${s.hh ?? "—"}</span></div>`;
          n.querySelector("[data-name]").textContent = s.name;
          styleValue(n.querySelector("[data-gval]"), it, it.w / SCALED_WIDTH.bar);
        }
        clickable(n, it.tag);
        area.append(n);
      }
    }
  }
  if (editing) {
    const hidden = new Set(model.items.filter((i) => i.hidden).map((i) => i.id));
    for (const n of [...area.children].slice(before)) if (hidden.has(n.dataset.eid)) n.classList.add("dhidden");
  }
}

/* ---------- เรขาคณิตของหน้าปัดเข็ม ---------- */
const CX = 115, CY = 112, R = 78;
const pt = (t, r = R) => [
  (CX - r * Math.cos(Math.PI * t)).toFixed(1),
  (CY - r * Math.sin(Math.PI * t)).toFixed(1),
];
const arc = (t0, t1, r = R) => {
  const a = pt(t0, r);
  const b = pt(t1, r);
  return `M${a[0]} ${a[1]} A${r} ${r} 0 0 1 ${b[0]} ${b[1]}`;
};

export function buildDialSvg(sensor, color) {
  const min = Number(sensor.range_min ?? 0);
  const max = Number(sensor.range_max ?? 100);
  const tl = (Number(sensor.ll) - min) / (max - min);
  const th = (Number(sensor.hh) - min) / (max - min);
  let ticks = "";
  for (let i = 0; i <= 10; i++) {
    const o = pt(i / 10, R + 3);
    const n = pt(i / 10, R - (i % 5 ? 5 : 10));
    ticks += `<line x1="${o[0]}" y1="${o[1]}" x2="${n[0]}" y2="${n[1]}"
      stroke="#2A5763" stroke-width="${i % 5 ? 1 : 1.6}"/>`;
  }
  return `<svg viewBox="0 0 230 176" width="230" height="176">
    <path d="${arc(0, 1)}" fill="none" stroke="#0A181E" stroke-width="13" stroke-linecap="round"/>
    <path d="${arc(0, tl)}" fill="none" stroke="#4A3A1E" stroke-width="13"/>
    <path d="${arc(th, 1)}" fill="none" stroke="#4A241F" stroke-width="13"/>
    ${ticks}
    <path d="${arc(0, 1)}" pathLength="1000" data-dialarc fill="none" stroke="${color}"
          stroke-width="13" stroke-linecap="round" stroke-dasharray="0 1000"
          style="transition:stroke-dasharray .8s ease,stroke .4s"/>
    <text x="14" y="${CY + 20}" class="end">LL ${sensor.ll}</text>
    <text x="216" y="${CY + 20}" text-anchor="end" class="end">HH ${sensor.hh}</text>
    <line data-dialneedle x1="${CX}" y1="${CY}" x2="${CX - 62}" y2="${CY}"
          stroke="var(--bone)" stroke-width="2.5" stroke-linecap="round"
          transform="rotate(0 ${CX} ${CY})" style="transition:transform .9s cubic-bezier(.34,1.3,.5,1)"/>
    <circle cx="${CX}" cy="${CY}" r="4.5" fill="var(--bone)"/>
    <text x="${CX}" y="164" text-anchor="middle">
      <tspan class="val" data-dialval>—</tspan><tspan class="unit"> ${sensor.unit}</tspan></text>
  </svg>`;
}

export const dialRotation = (t) => (t * 180).toFixed(1);
export const DIAL_CENTER = { CX, CY };
