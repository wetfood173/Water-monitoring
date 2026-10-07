/**
 * ตาราง layout ของหน้า Dashboard — 12 คอลัมน์ แถวสูงคงที่ (คล้าย dashboard ของ Node-RED)
 * บล็อกแต่ละอันเก็บตำแหน่งเป็นหน่วยช่อง { x, y, w, h } ไม่ใช่ pixel เพื่อให้ย่อ/ขยายตามจอได้
 * บล็อกจะถูกดันขึ้นด้านบนเสมอ (ไม่มีช่องว่างลอย) และดันบล็อกที่ทับกันลงด้านล่าง
 */

export const COLS = 12;
export const ROW_H = 40;
export const GAP = 12;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const collides = (a, b) =>
  a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * จัดบล็อกใหม่ให้ไม่ทับกันและชิดด้านบน — แก้ค่าใน items โดยตรง
 * pinnedId = บล็อกที่กำลังลาก/เพิ่งวาง ให้อยู่ที่เดิมแล้วดันบล็อกอื่นหลบแทน
 */
export function compact(items, pinnedId = null) {
  const pinned = items.find((i) => i.id === pinnedId);
  const placed = pinned ? [pinned] : [];
  const rest = items.filter((i) => i !== pinned).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const it of rest) {
    it.x = clamp(it.x, 0, COLS - it.w);
    it.y = 0;
    while (placed.some((p) => collides(it, p))) it.y++;
    placed.push(it);
  }
  return items;
}

/** ความกว้าง/สูงของหนึ่งช่องรวมช่องไฟ (px) ตามขนาดตารางตอนนี้ */
function steps(grid) {
  const colW = (grid.clientWidth - GAP * (COLS - 1)) / COLS;
  return { colW, colStep: colW + GAP, rowStep: ROW_H + GAP };
}

export const columnWidth = (grid) => steps(grid).colW;

/** แปลงพิกัดเมาส์เป็นช่องบนตาราง */
export function cellAt(grid, clientX, clientY) {
  const r = grid.getBoundingClientRect();
  const { colStep, rowStep } = steps(grid);
  return {
    x: clamp(Math.floor((clientX - r.left) / colStep), 0, COLS - 1),
    y: Math.max(0, Math.floor((clientY - r.top) / rowStep)),
  };
}

/**
 * เริ่มลากย้าย (mode "move") หรือปรับขนาด (mode "resize") บล็อก item
 * apply() ถูกเรียกทุกครั้งที่ตำแหน่งเปลี่ยน, done() เมื่อปล่อยเมาส์
 */
export function startDrag(e, { grid, item, items, mode, minW = 1, minH = 1, topEdge = 0, apply, done }) {
  e.preventDefault();
  const { colStep, rowStep } = steps(grid);
  const sx = e.clientX;
  const sy = e.clientY + window.scrollY;
  const start = { x: item.x, y: item.y, w: item.w, h: item.h };
  // จำตำแหน่งบล็อกอื่นตอนเริ่มลากไว้ ทุกครั้งที่ขยับให้คำนวณจากจุดเริ่มต้น
  // ไม่งั้นบล็อกที่ถูกดันลงไปแล้วจะไม่กลับขึ้นมาเมื่อลากผ่านไป
  const origin = new Map(items.map((i) => [i, { x: i.x, y: i.y }]));
  let last = "";
  let lastEv = e;

  const move = (ev) => {
    lastEv = ev;
    // คิดระยะแนวตั้งจากพิกัดบนหน้า (รวมระยะที่เลื่อนจอ) เพราะจอเลื่อนเองได้ระหว่างลาก
    const dc = Math.round((ev.clientX - sx) / colStep);
    const dr = Math.round((ev.clientY + window.scrollY - sy) / rowStep);
    if (mode === "move") {
      item.x = clamp(start.x + dc, 0, COLS - start.w);
      item.y = Math.max(0, start.y + dr);
    } else {
      item.w = clamp(start.w + dc, minW, COLS - start.x);
      item.h = Math.max(minH, start.h + dr);
    }
    const key = `${item.x},${item.y},${item.w},${item.h}`;
    if (key === last) return;
    last = key;
    for (const [i, p] of origin) if (i !== item) Object.assign(i, p);
    compact(items, item.id);
    apply();
  };

  // ลากเข้าใกล้ขอบบน/ล่างของจอแล้วเลื่อนหน้าให้เอง จะได้ย้ายบล็อกไปไกลกว่าหนึ่งหน้าจอได้
  const EDGE = 60;
  const scroller = setInterval(() => {
    const y = lastEv.clientY;
    const top = topEdge + EDGE; // topEdge = ขอบล่างของแถบที่ติดอยู่ด้านบน (เมนู + palette)
    const speed = y < top ? -Math.min(EDGE, top - y) / 3 : y > window.innerHeight - EDGE ? (y - (window.innerHeight - EDGE)) / 3 : 0;
    if (!speed) return;
    window.scrollBy(0, speed);
    move(lastEv);
  }, 16);

  const up = () => {
    clearInterval(scroller);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    compact(items);
    apply();
    done?.();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}
