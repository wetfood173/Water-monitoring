/**
 * ผังบ่อและทิศทางการไหล — พิกัดคงที่บนแคนวาส 1120 × 684
 * ย้ายบ่อหรือเปลี่ยนเส้นทางน้ำให้แก้ที่ LAYOUT และ PIPES
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
  // TT-05 อยู่ด้านซ้ายบ่อ 5
  { x: 12,  y: 212, tag: "TT-05",   label: "อุณหภูมิน้ำ · TT-05",        color: "#E08A4F" },
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

/** SVG ของเส้นท่อ กล่องอุปกรณ์ และเส้นประเชื่อมป้ายเซนเซอร์ */
export function buildPipesSvg() {
  let out = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
    <path d="M0 0 L10 5 L0 10 z" fill="var(--pipe)"/></marker></defs>`;
  for (const d of PIPES) {
    out += `<path d="${d}" fill="none" stroke="#0B1A20" stroke-width="6" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="var(--pipe)" stroke-width="2" stroke-linejoin="round" marker-end="url(#ah)"/>
      <path d="${d}" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"
            stroke-dasharray="3 21" opacity=".8" style="animation:dash 1.6s linear infinite"/>`;
  }
  for (const d of TAPS) {
    out += `<path d="${d}" fill="none" stroke="var(--mute)" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  }
  for (const e of EQUIPS) {
    out += `<rect class="eqbox" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="4"/>
      <text class="eqtxt" x="${e.x + e.w / 2}" y="${e.y + e.h / 2 + 4.5}" text-anchor="middle">${e.label}</text>`;
  }
  return out;
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
