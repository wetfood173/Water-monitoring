/**
 * ตัวแก้ไขผังบ่อแบบเต็มจอ (เฉพาะแอดมิน) — ย้าย/ปรับขนาดทุกชิ้น เพิ่ม/ลบชิ้น และวาดหรือดัดเส้นท่อเอง
 * ทำงานกับสำเนาของ model เสมอ กดบันทึกแล้วจึงส่งกลับผ่าน onSave
 */
import { el, clear, confirmDialog } from "./util.js";
import { CANVAS, renderDiagram } from "./diagram.js";
import { createHistory, handleUndoKeys } from "./history.js";

const KINDS = {
  tank: { label: "ถัง", w: 134, h: 155, minW: 40, minH: 40 },
  equip: { label: "อุปกรณ์", w: 130, h: 26, minW: 40, minH: 20 },
  softener: { label: "Softener", w: 110, h: 120, minW: 60, minH: 60 },
  tap: { label: "ป้ายค่า", w: 112, minW: 80, bind: true },
  dial: { label: "หน้าปัดเข็ม", w: 254, minW: 150, bind: true },
  bar: { label: "เกจแถบ", w: 200, minW: 120, bind: true },
};

const newId = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(Number(n));

export function openDiagramEditor({ host, model, sensors, ponds, makeDefault, afterRender, onSave }) {
  let m = structuredClone(model);
  let mode = "select"; // select | flow | dashed
  let sel = null; // { type: "item" | "pipe", id }
  let snap = true;
  let drawing = null; // จุดของท่อที่กำลังวาด [[x, y], ...]
  let hover = null; // จุดที่เมาส์ชี้อยู่ขณะวาด (ใช้วาดเส้นตัวอย่าง)
  let scale = 1;
  let previewLine = null;
  const GRID = 10;

  const snapV = (v, free = false) => (snap && !free ? Math.round(v / GRID) * GRID : Math.round(v));
  const itemOf = (id) => m.items.find((i) => i.id === id);
  const pipeOf = (id) => m.pipes.find((p) => p.id === id);

  const history = createHistory({
    get: () => m,
    set: (v) => {
      m = v;
      drawing = null;
      hover = null;
      // ชิ้นที่เลือกไว้อาจหายไปหลังเลิกทำ/ทำซ้ำ
      if (sel && !(sel.type === "item" ? itemOf(sel.id) : pipeOf(sel.id))) sel = null;
      render();
    },
    onChange: () => {
      undoBtn.disabled = !history.canUndo;
      redoBtn.disabled = !history.canRedo;
    },
  });
  /** แก้ model หนึ่งขั้น (เลิกทำได้) แล้ววาดใหม่ */
  const edit = (fn) => {
    history.edit(fn);
    render();
  };

  /* ---------- โครงหน้าจอ ---------- */

  const canvas = el("div", { class: "canvas" });
  const stage = el("div", { class: "destage" }, canvas);
  const props = el("div", { class: "deprops" });
  const hint = el("div", { class: "dehint" });
  const modeBtns = {};
  const mkMode = (key, label) =>
    (modeBtns[key] = el("button", { class: "sm", onclick: () => setMode(key) }, label));
  const snapBox = el("input", { type: "checkbox" });
  snapBox.checked = snap;
  snapBox.addEventListener("change", () => (snap = snapBox.checked));
  const saveBtn = el("button", { class: "sm primary", onclick: save }, "บันทึกผัง");
  const undoBtn = el("button", { class: "sm", title: "เลิกทำ (Ctrl+Z)", disabled: true, onclick: () => history.undo() }, "↶ เลิกทำ");
  const redoBtn = el("button", { class: "sm", title: "ทำซ้ำ (Ctrl+Y หรือ Ctrl+Shift+Z)", disabled: true, onclick: () => history.redo() }, "↷ ทำซ้ำ");

  const overlay = el("div", { class: "dedit" },
    el("div", { class: "detool" },
      el("b", {}, "แก้ไขผังบ่อ"),
      el("div", { class: "deundo" }, undoBtn, redoBtn),
      el("div", { class: "seg" }, mkMode("select", "เลือก / ย้าย"), mkMode("flow", "วาดท่อน้ำ"), mkMode("dashed", "วาดเส้นประ")),
      el("div", { class: "deadd" },
        ...Object.entries(KINDS).map(([k, spec]) => el("button", { class: "sm", onclick: () => addItem(k) }, `+ ${spec.label}`))),
      el("label", { class: "desnap" }, snapBox, "จับกริด 10px"),
      el("div", { class: "deact" },
        el("button", { class: "sm", onclick: reset }, "คืนค่าเริ่มต้น"),
        el("button", { class: "sm", onclick: close }, "ยกเลิก"),
        saveBtn)),
    el("div", { class: "demain" }, stage, props),
    hint);
  host.append(overlay);
  document.body.classList.add("fs-lock");

  function fit() {
    const W = stage.clientWidth - 24;
    const H = stage.clientHeight - 24;
    if (W <= 0 || H <= 0) return;
    scale = Math.min(W / CANVAS.W, H / CANVAS.H);
    canvas.style.transform = `scale(${scale})`;
    canvas.style.marginLeft = `${12 + (W - CANVAS.W * scale) / 2}px`;
    canvas.style.marginTop = `${12 + (H - CANVAS.H * scale) / 2}px`;
  }
  const ro = new ResizeObserver(fit);
  ro.observe(stage);

  const toCanvas = (ev) => {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale };
  };

  /* ---------- วาดหน้าจอ ---------- */

  function render() {
    renderDiagram(canvas, m, { sensors, editing: true });

    if (sel?.type === "item") {
      const node = canvas.querySelector(`[data-eid="${CSS.escape(sel.id)}"]`);
      if (node) {
        node.classList.add("dsel");
        node.append(el("div", { class: "dhandle", title: "ลากเพื่อปรับขนาด" }));
      }
    }
    if (sel?.type === "pipe") {
      const p = pipeOf(sel.id);
      canvas.querySelector(`[data-pid="${CSS.escape(sel.id)}"]`)?.classList.add("on");
      p?.pts.forEach(([x, y], i) =>
        canvas.append(el("div", { class: "dvert", style: `left:${x}px;top:${y}px`, dataset: { idx: i }, title: "ลากเพื่อดัดท่อ · ดับเบิลคลิกเพื่อลบจุด" })));
    }

    // เส้นตัวอย่างขณะวาดท่อ
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "depreview");
    svg.setAttribute("viewBox", `0 0 ${CANVAS.W} ${CANVAS.H}`);
    previewLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    svg.append(previewLine);
    canvas.append(svg);
    updatePreview();
    for (const [x, y] of drawing ?? []) canvas.append(el("div", { class: "dvert draw", style: `left:${x}px;top:${y}px` }));

    afterRender?.();
    renderProps();
  }

  function updatePreview() {
    if (!previewLine) return;
    const pts = drawing ? [...drawing, ...(hover ? [hover] : [])] : [];
    previewLine.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
    previewLine.setAttribute("class", mode === "dashed" ? "dashed" : "");
  }

  function setMode(next) {
    if (drawing) finishDrawing();
    mode = next;
    if (mode !== "select") sel = null;
    for (const [k, b] of Object.entries(modeBtns)) b.setAttribute("aria-selected", String(k === mode));
    stage.classList.toggle("drawing", mode !== "select");
    hint.textContent = mode === "select"
      ? "คลิกเพื่อเลือก · ลากเพื่อย้าย · ลากมุมขวาล่างเพื่อปรับขนาด · ลากจุดบนท่อเพื่อดัดท่อ · ดับเบิลคลิกบนท่อเพื่อเพิ่มจุด / บนจุดเพื่อลบจุด · Delete ลบชิ้นที่เลือก · ปุ่มลูกศรขยับทีละ 1px (Shift = 10px) · Shift ค้างขณะลาก = ไม่จับกริด"
      : "คลิกเพื่อวางจุดของท่อ (หักมุมฉากให้เอง — กด Shift ค้างเพื่อวาดเส้นเฉียง) · ดับเบิลคลิกหรือ Enter เพื่อจบเส้น · Backspace ลบจุดล่าสุด · Esc ยกเลิกเส้นนี้";
    render();
  }

  /* ---------- แผงตั้งค่าชิ้นที่เลือก ---------- */

  function field(label, input) {
    return el("div", { class: "field" }, el("label", {}, label), input);
  }

  /** ช่องเลือกสี + ปุ่มกลับไปใช้สีเริ่มต้น (เลิกทำได้) — onSet(undefined) = ใช้สีเริ่มต้น */
  function colorField(label, value, fallback, onSet) {
    const c = el("input", { type: "color", value: value ?? fallback });
    c.addEventListener("change", () => edit(() => onSet(c.value)));
    const reset = el("button", { class: "sm", type: "button", disabled: !value, onclick: () => edit(() => onSet(undefined)) }, "ค่าเริ่มต้น");
    return field(label, el("div", { class: "row", style: "align-items:center;gap:8px;flex-wrap:nowrap" }, c, reset));
  }

  /** ซ่อน = วางไว้ก่อนแต่ยังไม่แสดงบนหน้า Dashboard */
  const hideBox = (obj) =>
    checkbox("ซ่อน (วางไว้ก่อน ยังไม่แสดงให้ผู้ดูเห็น)", obj.hidden, (on) => (obj.hidden = on || undefined));

  /** ช่องติ๊ก (เลิกทำได้) — onToggle(on) เป็นตัวแก้ค่าใน model */
  function checkbox(label, checked, onToggle) {
    const cb = el("input", { type: "checkbox" });
    cb.checked = Boolean(checked);
    cb.addEventListener("change", () => edit(() => onToggle(cb.checked)));
    return el("label", { class: "decheck" }, cb, label);
  }

  function numInput(obj, key, { min = -2000, max = 4000 } = {}) {
    const i = el("input", { type: "number", step: "1", value: round(obj[key]) });
    i.addEventListener("change", () => {
      const n = Number(i.value);
      if (!Number.isFinite(n)) return;
      edit(() => (obj[key] = clamp(round(n), min, max)));
    });
    return i;
  }

  function renderProps() {
    clear(props);
    if (!sel) {
      props.append(
        el("h4", {}, "ยังไม่ได้เลือกชิ้นใด"),
        el("p", {}, "คลิกถัง อุปกรณ์ ป้ายค่า หรือเส้นท่อบนผังเพื่อแก้ไข · กดปุ่ม + ด้านบนเพื่อเพิ่มชิ้นใหม่ · เลือกโหมด \"วาดท่อน้ำ\" เพื่อลากเส้นท่อใหม่"),
        el("p", {}, `บนผังมี ${m.items.length} ชิ้น · ท่อ ${m.pipes.length} เส้น`),
        el("p", {}, `ซ่อนอยู่ ${m.items.filter((i) => i.hidden).length + m.pipes.filter((p) => p.hidden).length} รายการ (แสดงจาง ๆ เฉพาะในหน้านี้ ผู้ดูทั่วไปไม่เห็น)`)
      );
      return;
    }

    if (sel.type === "pipe") {
      const p = pipeOf(sel.id);
      if (!p) return;
      const style = el("select", {},
        el("option", { value: "flow", selected: p.style !== "dashed" }, "ท่อน้ำ (มีลูกศรและน้ำไหล)"),
        el("option", { value: "dashed", selected: p.style === "dashed" }, "เส้นประ (โยงป้ายเซนเซอร์)"));
      style.addEventListener("change", () => edit(() => (p.style = style.value)));
      props.append(
        el("h4", {}, p.style === "dashed" ? "เส้นประ" : "ท่อน้ำ"),
        field("รูปแบบเส้น", style),
        hideBox(p),
        el("p", {}, `${p.pts.length} จุด · ลูกศรชี้ไปทางจุดสุดท้าย`),
        el("div", { class: "row" },
          el("button", { class: "sm", onclick: () => edit(() => p.pts.reverse()) }, "กลับทิศทาง"),
          el("button", { class: "sm", onclick: () => duplicate() }, "คัดลอก"),
          el("button", { class: "sm danger", onclick: removeSelected }, "ลบท่อ"))
      );
      return;
    }

    const it = itemOf(sel.id);
    if (!it) return;
    const spec = KINDS[it.kind];
    props.append(el("h4", {}, spec.label), hideBox(it));

    if (it.kind === "tank") {
      const s = el("select", {}, ...ponds.map((p) => el("option", { value: p.pond_id, selected: p.pond_id === it.pond }, `บ่อ ${p.pond_id} · ${p.name}`)));
      s.addEventListener("change", () => edit(() => (it.pond = s.value)));
      props.append(field("บ่อ", s));
    }
    if (spec.bind) {
      const s = el("select", {}, ...sensors.map((x) => el("option", { value: x.tag, selected: x.tag === it.tag }, `${x.name} · ${x.tag}`)));
      s.addEventListener("change", () => edit(() => (it.tag = s.value)));
      props.append(field("จุดวัด", s));
    }
    // ข้อความหลายบรรทัด (กด Enter เพื่อขึ้นบรรทัดใหม่) และขนาดตัวอักษรที่ตั้งเองได้
    const TEXT = {
      tank: { label: "ชื่อใต้ถัง", placeholder: `บ่อ ${it.pond}`, bold: true },
      equip: { label: "ข้อความ", placeholder: "", bold: false },
      softener: { label: "ข้อความ", placeholder: "Softener", bold: true },
      tap: { label: "ข้อความบนป้าย", placeholder: "เว้นว่าง = ใช้ชื่อจุดวัด", bold: false },
    }[it.kind];
    if (TEXT) {
      const t = el("textarea", { rows: "2", maxlength: "60", placeholder: TEXT.placeholder });
      t.value = it.label ?? "";
      t.addEventListener("change", () => edit(() => (it.label = t.value.replace(/\s+$/, "") || undefined)));
      const size = el("input", { type: "number", step: "1", min: "6", max: "120", value: it.fontSize ?? "", placeholder: "อัตโนมัติ" });
      size.addEventListener("change", () => {
        const n = Number(size.value);
        edit(() => (it.fontSize = size.value === "" || !Number.isFinite(n) ? undefined : clamp(round(n), 6, 120)));
      });
      props.append(
        field(`${TEXT.label} (Enter = ขึ้นบรรทัดใหม่)`, t),
        field("ขนาดตัวอักษร (px) — เว้นว่าง = ย่อ/ขยายตามขนาดชิ้น", size),
        checkbox("ตัวหนา", it.bold ?? TEXT.bold, (on) => (it.bold = on)),
        colorField("สีตัวหนังสือ", it.textColor, "#D6E4E5", (v) => (it.textColor = v))
      );
    }
    // ตัวเลขค่าที่อ่านได้จากสัญญาณ (ระดับน้ำ %, ค่าบนป้าย/หน้าปัด/เกจ)
    if (["tank", "tap", "dial", "bar"].includes(it.kind)) {
      const vsize = el("input", { type: "number", step: "1", min: "6", max: "300", value: it.valueSize ?? "", placeholder: "อัตโนมัติ" });
      vsize.addEventListener("change", () => {
        const n = Number(vsize.value);
        edit(() => (it.valueSize = vsize.value === "" || !Number.isFinite(n) ? undefined : clamp(round(n), 6, 300)));
      });
      props.append(
        el("div", { class: "desub" }, "ตัวเลขค่าที่อ่านได้"),
        field("ขนาดตัวเลข (px) — เว้นว่าง = ย่อ/ขยายตามขนาดชิ้น", vsize),
        checkbox("ตัวเลขตัวหนา", it.valueBold ?? true, (on) => (it.valueBold = on)),
        colorField("สีตัวเลข (ตอนค่าปกติ — หลุด LL/HH ยังเป็นสีเตือน)", it.valueColor, "#D6E4E5", (v) => (it.valueColor = v))
      );
    }
    {
      const c = el("input", { type: "color", value: it.color ?? "#8FB9DC" });
      c.addEventListener("change", () => edit(() => (it.color = c.value)));
      const reset = el("button", {
        class: "sm", type: "button",
        onclick: () => edit(() => { it.color = undefined; }),
      }, "ใช้ค่าเริ่มต้น");
      props.append(field("สี", el("div", { class: "row", style: "align-items:center;gap:8px" }, c, reset)));
    }

    props.append(
      el("div", { class: "row" }, field("X", numInput(it, "x")), field("Y", numInput(it, "y"))),
      el("div", { class: "row" },
        field("กว้าง", numInput(it, "w", { min: spec.minW, max: CANVAS.W })),
        spec.h ? field("สูง", numInput(it, "h", { min: spec.minH, max: CANVAS.H })) : null),
      el("div", { class: "row", style: "margin-top:10px" },
        el("button", { class: "sm", onclick: () => duplicate() }, "คัดลอก"),
        el("button", { class: "sm danger", onclick: removeSelected }, "ลบชิ้นนี้"))
    );
  }

  /* ---------- เพิ่ม / ลบ / ทำซ้ำ ---------- */

  function addItem(kind) {
    const spec = KINDS[kind];
    const it = { id: newId(kind), kind, w: spec.w, x: 0, y: 0 };
    if (spec.h) it.h = spec.h;
    if (kind === "tank") {
      const placed = new Set(m.items.filter((i) => i.kind === "tank").map((i) => i.pond));
      it.pond = (ponds.find((p) => !placed.has(p.pond_id)) ?? ponds[0])?.pond_id;
    }
    if (kind === "equip") it.label = "อุปกรณ์";
    if (spec.bind) {
      const placed = new Set(m.items.filter((i) => i.kind === kind).map((i) => i.tag));
      it.tag = (sensors.find((s) => !placed.has(s.tag)) ?? sensors[0])?.tag;
    }
    it.x = snapV((CANVAS.W - it.w) / 2);
    it.y = snapV((CANVAS.H - (it.h ?? 80)) / 2);
    history.edit(() => m.items.push(it));
    mode = "select";
    sel = { type: "item", id: it.id };
    setMode("select");
  }

  function removeSelected() {
    if (!sel) return;
    const { type, id } = sel;
    history.edit(() => {
      if (type === "item") m.items = m.items.filter((i) => i.id !== id);
      else m.pipes = m.pipes.filter((p) => p.id !== id);
    });
    sel = null;
    render();
  }

  function duplicate() {
    if (!sel) return;
    if (sel.type === "item") {
      const copy = { ...structuredClone(itemOf(sel.id)), id: newId("copy") };
      copy.x += 20;
      copy.y += 20;
      history.edit(() => m.items.push(copy));
      sel = { type: "item", id: copy.id };
    } else {
      const copy = { ...structuredClone(pipeOf(sel.id)), id: newId("pipe") };
      copy.pts = copy.pts.map(([x, y]) => [x + 20, y + 20]);
      history.edit(() => m.pipes.push(copy));
      sel = { type: "pipe", id: copy.id };
    }
    render();
  }

  /* ---------- วาดท่อ ---------- */

  function constrain(p, free) {
    const q = [snapV(p.x, free), snapV(p.y, free)];
    const prev = drawing?.[drawing.length - 1];
    if (prev && !free) {
      // หักมุมฉากตามแนวที่ลากไกลกว่า เหมือนท่อจริงในผังเดิม
      if (Math.abs(q[0] - prev[0]) >= Math.abs(q[1] - prev[1])) q[1] = prev[1];
      else q[0] = prev[0];
    }
    return q;
  }

  function finishDrawing() {
    const pts = (drawing ?? []).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
    drawing = null;
    hover = null;
    if (pts.length >= 2) history.edit(() => m.pipes.push({ id: newId("pipe"), style: mode === "dashed" ? "dashed" : "flow", pts }));
    render();
  }

  /* ---------- ลากเมาส์ ---------- */

  function drag(e, onMove) {
    e.preventDefault();
    history.begin(); // ลากหนึ่งครั้ง = หนึ่งขั้นของประวัติ (คลิกเฉย ๆ ไม่นับ)
    const start = toCanvas(e);
    const move = (ev) => {
      const p = toCanvas(ev);
      onMove(p.x - start.x, p.y - start.y, ev.shiftKey);
      render();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      history.end();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (mode !== "select") {
      e.preventDefault();
      drawing ??= [];
      drawing.push(constrain(toCanvas(e), e.shiftKey));
      render();
      return;
    }

    const vert = e.target.closest(".dvert");
    if (vert && sel?.type === "pipe") {
      const p = pipeOf(sel.id);
      const i = Number(vert.dataset.idx);
      const [ox, oy] = p.pts[i];
      return drag(e, (dx, dy, free) => (p.pts[i] = [snapV(ox + dx, free), snapV(oy + dy, free)]));
    }

    if (e.target.closest(".dhandle") && sel?.type === "item") {
      const it = itemOf(sel.id);
      const spec = KINDS[it.kind];
      const o = { w: it.w, h: it.h };
      return drag(e, (dx, dy, free) => {
        it.w = clamp(snapV(o.w + dx, free), spec.minW, CANVAS.W);
        if (spec.h) it.h = clamp(snapV(o.h + dy, free), spec.minH, CANVAS.H);
      });
    }

    const pid = e.target.getAttribute?.("data-pid");
    // วาดใหม่เฉพาะตอนเปลี่ยนชิ้นที่เลือก — ถ้าวาดใหม่ทุกคลิก element ใต้เมาส์จะถูกแทนที่
    // แล้วดับเบิลคลิก (เพิ่ม/ลบจุดบนท่อ) จะไม่ถึงเป้าหมาย
    if (pid) {
      const changed = sel?.id !== pid;
      sel = { type: "pipe", id: pid };
      const p = pipeOf(pid);
      const orig = p.pts.map((pt) => [...pt]);
      if (changed) render();
      return drag(e, (dx, dy, free) => {
        const sx = snapV(dx, free);
        const sy = snapV(dy, free);
        p.pts = orig.map(([x, y]) => [x + sx, y + sy]);
      });
    }

    const node = e.target.closest("[data-eid]");
    if (node) {
      const it = itemOf(node.dataset.eid);
      const changed = sel?.id !== it.id;
      sel = { type: "item", id: it.id };
      const o = { x: it.x, y: it.y };
      if (changed) render();
      return drag(e, (dx, dy, free) => {
        it.x = clamp(snapV(o.x + dx, free), -it.w + 20, CANVAS.W - 20);
        it.y = clamp(snapV(o.y + dy, free), -20, CANVAS.H - 20);
      });
    }

    if (sel) {
      sel = null;
      render();
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (mode === "select" || !drawing) return;
    hover = constrain(toCanvas(e), e.shiftKey);
    updatePreview();
  });

  stage.addEventListener("dblclick", (e) => {
    if (mode !== "select") {
      finishDrawing();
      return;
    }
    const vert = e.target.closest(".dvert");
    if (vert && sel?.type === "pipe") {
      const p = pipeOf(sel.id);
      if (p.pts.length > 2) edit(() => p.pts.splice(Number(vert.dataset.idx), 1));
      return;
    }
    const pid = e.target.getAttribute?.("data-pid");
    if (pid) {
      // แทรกจุดใหม่บนช่วงท่อที่ใกล้ตำแหน่งดับเบิลคลิกที่สุด
      const p = pipeOf(pid);
      const c = toCanvas(e);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < p.pts.length - 1; i++) {
        const d = distToSegment(c, p.pts[i], p.pts[i + 1]);
        if (d < bestD) [best, bestD] = [i, d];
      }
      sel = { type: "pipe", id: pid };
      edit(() => p.pts.splice(best + 1, 0, [snapV(c.x), snapV(c.y)]));
    }
  });

  const onKey = (e) => {
    if (e.target.closest?.("input, select, textarea") || document.querySelector(".modal-bg")) return;
    if (!drawing && handleUndoKeys(e, history)) return;
    if (drawing) {
      if (e.key === "Enter") finishDrawing();
      else if (e.key === "Escape") { drawing = null; hover = null; render(); }
      else if (e.key === "Backspace") { drawing.pop(); if (!drawing.length) drawing = null; render(); }
      else return;
      e.preventDefault();
      return;
    }
    if (!sel) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      removeSelected();
    } else if (e.key === "Escape") {
      sel = null;
      render();
    } else if (e.key.startsWith("Arrow")) {
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      edit(() => {
        if (sel.type === "item") {
          const it = itemOf(sel.id);
          it.x += dx;
          it.y += dy;
        } else {
          const p = pipeOf(sel.id);
          p.pts = p.pts.map(([x, y]) => [x + dx, y + dy]);
        }
      });
    } else return;
    e.preventDefault();
  };
  document.addEventListener("keydown", onKey);

  /* ---------- บันทึก / ปิด ---------- */

  async function reset() {
    const ok = await confirmDialog("คืนค่าผังเริ่มต้น", "จัดถัง อุปกรณ์ และท่อกลับเป็นผังเดิม — ยังไม่บันทึกจนกว่าจะกด \"บันทึกผัง\"", "คืนค่า");
    if (!ok) return;
    sel = null;
    drawing = null;
    edit(() => (m = structuredClone(makeDefault())));
  }

  async function save() {
    if (drawing) finishDrawing();
    saveBtn.disabled = true;
    try {
      await onSave(m);
      close();
    } catch {
      // onSave แสดงข้อความผิดพลาดเองแล้ว เปิดตัวแก้ไขค้างไว้ให้แก้ต่อได้
    } finally {
      saveBtn.disabled = false;
    }
  }

  function close() {
    ro.disconnect();
    document.removeEventListener("keydown", onKey);
    document.body.classList.remove("fs-lock");
    overlay.remove();
  }

  setMode("select");
  fit();
  return { close };
}

function distToSegment(c, [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? clamp(((c.x - x1) * dx + (c.y - y1) * dy) / len, 0, 1) : 0;
  return Math.hypot(c.x - (x1 + t * dx), c.y - (y1 + t * dy));
}
