import { api } from "../api.js";
import { $, $$, el, add, clear, nf, nfInt, fmtTime, statusOf, toast, modal, confirmDialog, CONDITION_LABEL } from "../util.js";
import { drawChart, colorForTag, POND_COLOR } from "../chart.js";
import {
  MOBILE_GROUPS, DIALS, buildDialSvg, dialRotation, DIAL_CENTER, renderDiagram, defaultDiagram, styleValue, weight,
} from "../diagram.js";
import { openDiagramEditor } from "../diagramEditor.js";
import { createHistory, handleUndoKeys } from "../history.js";
import { COLS, ROW_H, GAP, compact, cellAt, columnWidth, startDrag } from "../dashgrid.js";

const REFRESH_MS = 5000;
const RANGES = [
  { key: "1h", label: "1 ชม." },
  { key: "24h", label: "24 ชม." },
  { key: "7d", label: "7 วัน" },
  { key: "30d", label: "30 วัน" },
];

/**
 * บล็อกที่ลากมาวางบนตาราง Dashboard ได้ — ขนาดเป็นหน่วยช่อง (กว้างสุด 12 คอลัมน์)
 * bind = บล็อกนี้ต้องเลือกจุดวัด (tag) หรือบ่อ (pond) ก่อนวาง, single = วางได้บล็อกเดียว
 */
const WIDGETS = {
  diagram: { label: "ผังบ่อ", hint: "ผังบ่อและทิศทางการไหลทั้งหมด", w: 12, h: 14, minW: 6, minH: 8, single: true },
  tank: { label: "ถังระดับน้ำ", hint: "ระดับน้ำและปริมาตรของบ่อเดียว", w: 2, h: 6, minW: 2, minH: 4, bind: "pond" },
  bar: { label: "เกจแถบ", hint: "ค่าปัจจุบันพร้อมแถบและขีด LL/HH", w: 3, h: 4, minW: 2, minH: 3, bind: "tag" },
  dial: { label: "หน้าปัดเข็ม", hint: "หน้าปัดครึ่งวงกลมแบบเกจแรงดัน", w: 3, h: 6, minW: 2, minH: 4, bind: "tag" },
  value: { label: "ตัวเลข", hint: "ค่าปัจจุบันตัวใหญ่", w: 2, h: 3, minW: 2, minH: 2, bind: "tag" },
  chart: { label: "กราฟแนวโน้ม", hint: "กราฟย้อนหลังพร้อมปุ่มเลือกช่วงเวลา", w: 12, h: 9, minW: 4, minH: 7 },
  alarms: { label: "บันทึกการแจ้งเตือน", hint: "รายการแจ้งเตือนล่าสุดและปุ่มรับทราบ", w: 12, h: 8, minW: 4, minH: 4, single: true },
};

const newId = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const stateLabel = (r, state) =>
  r.stale ? "ขาดสัญญาณ" : state === "hi" ? "สูงเกินกำหนด" : state === "lo" ? "ต่ำกว่ากำหนด" : "ปกติ";
const stateColor = (r, state, normal) =>
  r.stale ? "var(--mute)" : state === "hi" ? "var(--alarm)" : state === "lo" ? "var(--warn)" : normal ?? "var(--bone)";

export function dashboardPage(ctx) {
  const isAdmin = ctx.can("admin");
  const root = el("div");
  let sensors = [];
  let ponds = [];
  let latest = null;
  let timer = null;
  let cardVisibility = {};
  let hiddenTags = new Set();
  let diagram = null; // { items, pipes } ของผังบ่อ — แอดมินจัดเองได้จากปุ่ม "แก้ไขผัง"

  let layout = []; // [{ id, type, x, y, w, h, tag?, pond?, series?, title? }]
  let editing = false;
  let snapshot = null; // layout ก่อนเข้าโหมดจัด layout ใช้ตอนกดยกเลิก
  let dragType = null; // ชนิดบล็อกที่กำลังลากมาจาก palette
  const nodes = new Map(); // id บล็อก → element
  let charts = [];
  let alarmLists = [];
  let diagramEl = null;
  let resizeObs = null;

  const editBtn = isAdmin ? el("button", { class: "sm", onclick: enterEdit }, "จัด layout") : null;
  const undoBtn = el("button", { class: "sm", title: "เลิกทำ (Ctrl+Z)", disabled: true, onclick: () => layoutHistory.undo() }, "↶ เลิกทำ");
  const redoBtn = el("button", { class: "sm", title: "ทำซ้ำ (Ctrl+Y หรือ Ctrl+Shift+Z)", disabled: true, onclick: () => layoutHistory.redo() }, "↷ ทำซ้ำ");
  // เลิกทำ/ทำซ้ำในโหมดจัด layout — ย้าย ปรับขนาด เพิ่ม ลบ และตั้งค่าบล็อก
  const layoutHistory = createHistory({
    get: () => layout,
    set: (v) => {
      layout = v;
      buildGrid();
      buildPalette();
    },
    onChange: () => {
      undoBtn.disabled = !layoutHistory.canUndo;
      redoBtn.disabled = !layoutHistory.canRedo;
    },
  });

  root.append(
    el(
      "div",
      { class: "page-head" },
      el("div", {}, el("h2", {}, "ผังเฝ้าระวังน้ำ 7 บ่อ"), el("p", { id: "dashSub" }, "กำลังโหลดข้อมูล…")),
      el(
        "div",
        { class: "hstat" },
        el("div", {}, el("div", { class: "k" }, "ปริมาณน้ำรวม"), el("div", { class: "v num", id: "totalVol" }, "—")),
        el("div", {}, el("div", { class: "k" }, "แจ้งเตือนค้าง"), el("div", { class: "v num", id: "alarmCount" }, "0")),
        el(
          "div",
          {},
          el("div", { class: "k" }, "สถานะสัญญาณ"),
          el("div", { class: "v", style: "font-size:14px", id: "signal" }, el("span", { class: "dot" }), "รับค่าอยู่")
        )
      ),
      editBtn
    )
  );

  const friendBanner = el("div", { class: "banner", hidden: true });
  const palette = el("div", { class: "dpalette", hidden: true });
  const grid = el("div", { class: "dgrid" });
  const ghost = el("div", { class: "wghost" });
  root.append(friendBanner, palette, grid);

  /* ---------- เต็มจอ (เฉพาะบล็อกผังบ่อ) ---------- */

  const ICON_EXPAND =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  const ICON_COMPRESS =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v3a2 2 0 0 1-2 2H4"/><path d="M15 3v3a2 2 0 0 0 2 2h3"/><path d="M9 21v-3a2 2 0 0 0-2-2H4"/><path d="M15 21v-3a2 2 0 0 1 2-2h3"/></svg>';

  // ซ่อนปุ่มนี้บนจอมือถือ (ดู .fsbtn ใน app.css) — Fullscreen API ใช้งานไม่ได้ดีพอบน iPhone Safari
  const fsBtn = el("button", { class: "sm fsbtn", title: "ขยายผังบ่อเต็มจอ", onclick: toggleFullscreen });

  // iOS Safari ไม่รองรับ Fullscreen API กับ element ทั่วไป — ใช้ class เต็มจอปลอมด้วย CSS position:fixed แทน
  let pseudoFs = false;
  const isFullscreen = () => (diagramEl && document.fullscreenElement === diagramEl) || pseudoFs;

  function updateFsBtn() {
    fsBtn.innerHTML = isFullscreen()
      ? `${ICON_COMPRESS}<span>ออกจากเต็มจอ</span>`
      : `${ICON_EXPAND}<span>ขยายเต็มจอ</span>`;
  }

  function setPseudoFullscreen(on) {
    pseudoFs = on;
    diagramEl?.classList.toggle("fs-mode", on);
    document.body.classList.toggle("fs-lock", on);
    updateFsBtn();
    fitStage();
  }

  function toggleFullscreen() {
    if (!diagramEl) return;
    if (pseudoFs) return setPseudoFullscreen(false);
    if (document.fullscreenElement === diagramEl) return document.exitFullscreen();
    // document.fullscreenEnabled เป็น false เสมอบน iPhone Safari และบางเวอร์ชัน throw แบบ synchronous
    // จึงต้องกันทั้งสองทางด้วย try/catch ไม่งั้นกดแล้วไม่มีอะไรเกิดขึ้นเลย
    if (!diagramEl.requestFullscreen || !document.fullscreenEnabled) return setPseudoFullscreen(true);
    try {
      Promise.resolve(diagramEl.requestFullscreen())
        .then(() => screen.orientation?.lock?.("landscape").catch(() => {}))
        .catch(() => setPseudoFullscreen(true));
    } catch {
      setPseudoFullscreen(true);
    }
  }

  const onFullscreenChange = () => {
    updateFsBtn();
    fitStage();
    if (!document.fullscreenElement) screen.orientation?.unlock?.();
  };

  function leaveFullscreen() {
    if (pseudoFs) setPseudoFullscreen(false);
    if (diagramEl && document.fullscreenElement === diagramEl) document.exitFullscreen();
  }

  /* ---------- บล็อกแต่ละชนิด ---------- */

  const sensorOf = (it) => sensors.find((s) => s.tag === it.tag);

  function titleOf(it) {
    if (it.title) return it.title;
    if (it.type === "tank") return `บ่อ ${it.pond ?? "—"}`;
    if (WIDGETS[it.type].bind === "tag") {
      const s = sensorOf(it);
      return s ? `${s.name} · ${s.tag}` : it.tag ?? "—";
    }
    if (it.type === "diagram") return "ผังบ่อและทิศทางการไหล";
    if (it.type === "chart") return "แนวโน้มย้อนหลัง";
    return WIDGETS[it.type].label;
  }

  const missing = (body, text) => body.append(el("div", { class: "empty" }, text));

  // คลิกถัง/ป้ายเซนเซอร์แล้วให้กราฟบล็อกแรกเปลี่ยนไปแสดงจุดนั้น
  function bindSelect(node, tag) {
    node.addEventListener("click", () => selectSeries(tag));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectSeries(tag);
      }
    });
  }

  const BUILD = {
    diagram(it, { node, body, actions }) {
      diagramEl = node;
      if (isAdmin) actions.append(el("button", { class: "sm fsbtn", title: "ย้ายถัง อุปกรณ์ เกจ และวาดเส้นท่อเอง", onclick: editDiagram }, "แก้ไขผัง"));
      actions.append(fsBtn);
      updateFsBtn();
      body.append(el("div", { class: "stage" }, el("div", { class: "canvas" })), el("div", { class: "mobile" }));
      buildDiagram();
      buildMobileView();
    },

    tank(it, { body }) {
      const p = ponds.find((x) => x.pond_id === it.pond);
      if (!p) return missing(body, `ไม่พบบ่อ ${it.pond ?? ""}`);
      const vessel = el("div", { class: "vessel", tabindex: "0", role: "button", "aria-label": `บ่อ ${p.pond_id}` });
      vessel.innerHTML = `<div class="water" data-water="${p.pond_id}" style="height:0%"></div>
        <div class="pctbox"><div class="p num"><span data-pct="${p.pond_id}">—</span><i>%</i></div>
        <div class="m3 num" data-vol="${p.pond_id}"></div></div>`;
      bindSelect(vessel, `LT-${p.pond_id}`);
      body.append(el("div", { class: "wtankbody", style: `--tank:${POND_COLOR[p.pond_id] ?? "var(--line)"}` }, vessel));
    },

    bar(it, { node, body }) {
      const s = sensorOf(it);
      if (!s) return missing(body, `ไม่พบจุดวัด ${it.tag ?? ""}`);
      const min = Number(s.range_min ?? 0);
      const max = Number(s.range_max ?? 100);
      const mark = (v) => (v == null ? "" : `<i class="mark" style="left:${((Number(v) - min) / (max - min)) * 100}%"></i>`);
      node.dataset.gauge = s.tag;
      body.innerHTML = `<div class="gauge">
        <div class="read"><b data-gval>—</b><i>${s.unit}</i></div>
        <div class="bar"><span data-gbar></span>${mark(s.ll)}${mark(s.hh)}</div>
        <div class="range"><span>LL ${s.ll ?? "—"}</span><span data-gstate>ปกติ</span><span>HH ${s.hh ?? "—"}</span></div>
        ${s.tag === "FT-600Q"
          ? `<div class="range" style="margin-top:7px"><span>ปริมาณสะสมวันนี้</span><span class="num" data-totz>—</span></div>`
          : ""}</div>`;
    },

    dial(it, { node, body, actions }) {
      const s = sensorOf(it);
      if (!s) return missing(body, `ไม่พบจุดวัด ${it.tag ?? ""}`);
      const color = DIALS.find((d) => d.tag === s.tag)?.color ?? colorForTag(s.tag, s.pond_id);
      node.dataset.dial = s.tag;
      node.dataset.color = color;
      actions.append(el("span", { class: "dstate", dataset: { dialstate: "" } }, "ปกติ"));
      const box = el("div", { class: "dialw" });
      box.innerHTML = buildDialSvg(s, color);
      body.append(box);
    },

    value(it, { body }) {
      const s = sensorOf(it);
      if (!s) return missing(body, `ไม่พบจุดวัด ${it.tag ?? ""}`);
      const val = el("div", { class: "wval", tabindex: "0", role: "button" },
        el("b", { class: "num", dataset: { tapval: s.tag, vcolor: s.tag } }, "—"), el("i", {}, s.unit));
      bindSelect(val, s.tag);
      body.append(val);
    },

    chart(it, { body, actions }) {
      const c = { range: "1h", selected: it.series || "ALL", data: null, token: null };
      if (c.selected !== "ALL" && !sensors.some((s) => s.tag === c.selected)) c.selected = "ALL";
      const now = el("span", { class: "num", style: "color:var(--bone)" });
      const seg = el("div", { class: "seg", role: "tablist" });
      const tabsA = el("div", { class: "chips", role: "tablist" });
      const tabsB = el("div", { class: "chips", role: "tablist" });
      const legend = el("div", { class: "legend" });
      const canvas = el("canvas", { class: "chart" });
      actions.append(now);
      body.append(
        el("div", {},
          seg,
          el("div", { class: "tabrow" }, el("span", { class: "tl" }, "ระดับน้ำ"), tabsA),
          el("div", { class: "tabrow" }, el("span", { class: "tl" }, "เครื่องมือวัด"), tabsB),
          legend),
        canvas
      );

      for (const r of RANGES) {
        seg.append(el("button", {
          role: "tab",
          "aria-selected": String(r.key === c.range),
          dataset: { r: r.key },
          onclick: () => {
            c.range = r.key;
            $$("button", seg).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.r === r.key)));
            c.load();
          },
        }, r.label));
      }
      const mkTab = (box, key, label) =>
        box.append(el("button", {
          role: "tab", "aria-selected": String(key === c.selected), dataset: { k: key }, onclick: () => c.select(key),
        }, label));
      mkTab(tabsA, "ALL", "ทุกบ่อ");
      for (const p of ponds) mkTab(tabsA, `LT-${p.pond_id}`, `บ่อ ${p.pond_id}`);
      for (const s of sensors.filter((x) => x.metric !== "level")) mkTab(tabsB, s.tag, s.name);
      for (const p of ponds) {
        legend.append(el("span", {}, el("i", { style: `background:${POND_COLOR[p.pond_id] ?? "#3FB4A8"}` }), `บ่อ ${p.pond_id}`));
      }

      c.select = (key) => {
        c.selected = key;
        $$("button", tabsA).concat($$("button", tabsB))
          .forEach((b) => b.setAttribute("aria-selected", String(b.dataset.k === key)));
        legend.classList.toggle("on", key === "ALL");
        c.load();
      };

      c.load = async () => {
        const tags = c.selected === "ALL" ? ponds.map((p) => `LT-${p.pond_id}`) : [c.selected];
        const token = (c.token = Symbol("chart"));
        try {
          const data = await api.get(`/api/readings/history?range=${c.range}&tag=${encodeURIComponent(tags.join(","))}`);
          if (token !== c.token) return;
          c.data = data;
          c.render();
        } catch (err) {
          toast(err.message, "err");
        }
      };

      c.render = () => {
        if (!c.data || !canvas.isConnected || !canvas.clientWidth) return;
        const tags = Object.keys(c.data.series);
        const first = sensors.find((s) => s.tag === tags[0]);
        const series = tags.map((tag) => {
          const s = sensors.find((x) => x.tag === tag);
          return { name: s?.name ?? tag, color: colorForTag(tag, s?.pond_id), data: c.data.series[tag] };
        });
        drawChart(canvas, {
          series, from: c.data.from, to: c.data.to, unit: first?.unit ?? "", decimals: first?.decimals ?? 1,
        });
        if (series.length === 1) {
          const points = series[0].data.filter((p) => p.value != null);
          const last = points[points.length - 1];
          now.textContent = last ? `${nf(last.value, first?.decimals ?? 1)} ${first?.unit ?? ""}` : "—";
        } else {
          now.textContent = "ระดับน้ำ 7 บ่อ (%)";
        }
      };

      charts.push(c);
    },

    alarms(it, { body, actions }) {
      if (ctx.can("technician")) actions.append(ackAllBtn);
      const list = el("div", { class: "alist" });
      alarmLists.push(list);
      body.append(list);
    },
  };

  const ackAllBtn = el("button", { class: "sm" }, "รับทราบทั้งหมด");
  ackAllBtn.addEventListener("click", async () => {
    ackAllBtn.disabled = true;
    try {
      const r = await api.post("/api/alarms/ack-all");
      toast(r.count ? `รับทราบ ${r.count} รายการแล้ว` : "ไม่มีรายการที่ต้องรับทราบ");
      await refreshAlarms();
    } catch (err) {
      toast(err.message, "err");
    } finally {
      ackAllBtn.disabled = false;
    }
  });

  function selectSeries(key) {
    charts[0]?.select(key);
  }

  /* ---------- ประกอบตาราง ---------- */

  function buildItem(it) {
    const node = el("div", { class: `witem w${it.type}${it.hidden ? " whidden" : ""}`, dataset: { id: it.id } });
    const actions = el("div", { class: "wact" });
    const body = el("div", { class: "wbody" });
    const title = el("span", { class: "wtitle" }, titleOf(it));
    if (it.titleSize) title.style.fontSize = `${it.titleSize}px`;
    if (it.titleBold) title.style.fontWeight = "700";
    if (it.titleColor) title.style.color = it.titleColor;
    node.append(el("div", { class: "whead" }, title, actions), body);
    BUILD[it.type](it, { node, body, actions });
    // ตัวเลขค่าที่อ่านได้ (หน้าปัดคำนวณใน styleDialValues เพราะ SVG ย่อ/ขยายตามขนาดบล็อก)
    styleValue(body.querySelector("[data-gval], .wval b, .pctbox .p"), it);

    if (isAdmin) {
      node.append(
        el("div", { class: "wtools" },
          el("button", {
            class: "sm",
            title: it.hidden ? "แสดงบล็อกนี้ให้ทุกคนเห็น" : "วางไว้ก่อนแต่ยังไม่แสดง — เห็นเฉพาะตอนจัด layout",
            onclick: () => toggleHidden(it),
          }, it.hidden ? "แสดง" : "ซ่อน"),
          el("button", { class: "sm", title: "ตั้งค่าบล็อก", onclick: () => configure(it) }, "ตั้งค่า"),
          el("button", { class: "sm danger", title: "เอาบล็อกนี้ออก", onclick: () => removeWidget(it) }, "ลบ")),
        el("div", { class: "wresize", title: "ลากเพื่อปรับขนาด" })
      );
      node.addEventListener("pointerdown", (e) => {
        if (!editing || e.button !== 0 || e.target.closest("button")) return;
        const spec = WIDGETS[it.type];
        node.classList.add("dragging");
        layoutHistory.begin();
        startDrag(e, {
          grid,
          item: it,
          items: layout,
          mode: e.target.closest(".wresize") ? "resize" : "move",
          minW: spec.minW,
          minH: spec.minH,
          topEdge: palette.getBoundingClientRect().bottom,
          apply: applyPositions,
          done: () => {
            node.classList.remove("dragging");
            reorderNodes();
            layoutHistory.end();
          },
        });
      });
    }
    nodes.set(it.id, node);
    return node;
  }

  // บล็อกที่อยู่บนจอตอนนี้ — โหมดจัด layout แสดงทุกบล็อก (รวมที่ซ่อน)
  // โหมดดูปกติตัดบล็อกที่ซ่อนออกแล้วดันบล็อกที่เหลือขึ้นมาแทน ไม่ให้เหลือช่องว่าง
  let view = [];

  function applyPositions() {
    for (const it of view) {
      const n = nodes.get(it.id);
      if (!n) continue;
      n.style.gridColumn = `${it.x + 1} / span ${it.w}`;
      n.style.gridRow = `${it.y + 1} / span ${it.h}`;
      // ความสูงสำหรับจอมือถือ ที่เรียงบล็อกเป็นคอลัมน์เดียวแทนตาราง
      n.style.setProperty("--mh", `${it.h * ROW_H + (it.h - 1) * GAP}px`);
      n.classList.toggle("wide", it.w > 4);
    }
    fitStage();
    charts.forEach((c) => c.render());
    styleDialValues();
  }

  // ขนาดตัวเลขในบล็อกหน้าปัด: SVG ถูกย่อ/ขยายให้พอดีบล็อก (viewBox 230 × 176) จึงต้องหารด้วยสัดส่วนนั้น
  // ให้ตัวเลขบนจอออกมาเท่าที่ตั้งไว้จริง
  function styleDialValues() {
    for (const it of view) {
      if (it.type !== "dial") continue;
      const svg = nodes.get(it.id)?.querySelector(".dialw svg");
      if (!svg) continue;
      const r = svg.getBoundingClientRect();
      const scale = Math.min(r.width / 230, r.height / 176) || 1;
      styleValue(svg.querySelector("[data-dialval]"), it, scale);
    }
  }

  // เรียง element ตามตำแหน่งบนตาราง เพื่อให้ลำดับบนจอมือถือ (ที่ไม่ใช้ตาราง) ตรงกับที่จัดไว้
  function reorderNodes() {
    for (const it of [...view].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const n = nodes.get(it.id);
      if (n) grid.append(n);
    }
  }

  function buildGrid() {
    leaveFullscreen();
    charts = [];
    alarmLists = [];
    diagramEl = null;
    nodes.clear();
    clear(grid);
    view = editing ? layout : compact(layout.filter((i) => !i.hidden).map((i) => ({ ...i })));
    for (const it of view) grid.append(buildItem(it));
    reorderNodes();
    applyPositions();
    charts.forEach((c) => c.select(c.selected));
    if (latest) renderLatest(latest);
    refreshAlarms().catch(() => {});
  }

  function defaultLayout() {
    const items = [];
    let y = 0;
    if (cardVisibility.diagram !== false) {
      items.push({ id: newId(), type: "diagram", x: 0, y, w: 12, h: 14 });
      y += 14;
    }
    if (cardVisibility.instruments !== false) {
      const inst = sensors.filter((s) => s.metric !== "level" && !hiddenTags.has(s.tag));
      inst.forEach((s, i) =>
        items.push({ id: newId(), type: "bar", tag: s.tag, x: (i % 4) * 3, y: y + Math.floor(i / 4) * 4, w: 3, h: 4 })
      );
      y += Math.ceil(inst.length / 4) * 4;
    }
    if (cardVisibility.chart !== false) {
      items.push({ id: newId(), type: "chart", x: 0, y, w: 12, h: 9 });
      y += 9;
    }
    if (cardVisibility.alarms !== false) items.push({ id: newId(), type: "alarms", x: 0, y, w: 12, h: 8 });
    return compact(items);
  }

  function loadLayout(saved) {
    const items = Array.isArray(saved?.items) ? saved.items : null;
    if (!items?.length) return defaultLayout();
    return compact(
      items
        .filter((i) => WIDGETS[i.type])
        .map((i) => {
          const w = clamp(Number(i.w) || 1, 1, COLS);
          return { ...i, w, h: Math.max(1, Number(i.h) || 1), x: clamp(Number(i.x) || 0, 0, COLS - w), y: Math.max(0, Number(i.y) || 0) };
        })
    );
  }

  /* ---------- ผังบ่อ ---------- */

  function buildDiagram() {
    if (!diagramEl) return;
    renderDiagram($(".canvas", diagramEl), diagram, { sensors, onSelect: selectSeries });
  }

  function editDiagram() {
    leaveFullscreen();
    openDiagramEditor({
      host: root,
      model: diagram,
      sensors,
      ponds,
      makeDefault: () => defaultDiagram(sensors, hiddenTags),
      // ตัวแก้ไขวาดผังใหม่ทุกครั้งที่ขยับ — เติมค่าล่าสุดกลับเข้าไปทันทีไม่ต้องรอรอบอัปเดต 5 วินาที
      afterRender: () => latest && renderLatest(latest),
      onSave: async (next) => {
        try {
          await api.put("/api/system/settings/dashboard.diagram", { value: next });
        } catch (err) {
          toast(err.message, "err");
          throw err;
        }
        diagram = next;
        buildDiagram();
        buildMobileView();
        fitStage();
        if (latest) renderLatest(latest);
        toast("บันทึกผังบ่อแล้ว — ทุกคนจะเห็นผังนี้");
      },
    });
  }

  function buildMobileView() {
    if (!diagramEl) return;
    const box = clear($(".mobile", diagramEl));
    // บรรทัดอุณหภูมิ/อัตราไหลในมุมมองมือถือแสดงเมื่อจุดวัดนั้นอยู่บนผัง
    const onDiagram = new Set(diagram.items.filter((i) => !i.hidden).map((i) => i.tag).filter(Boolean));
    for (const g of MOBILE_GROUPS) {
      const group = el("div", { class: "mgroup" }, el("h4", {}, g.heading));
      g.ids.forEach((id, i) => {
        const p = ponds.find((x) => x.pond_id === id);
        if (!p) return;
        if (g.chain && i > 0) group.append(el("div", { class: "mconn" }, `รับน้ำจาก ${p.src_note ?? "—"}`));
        const row = el("div", { class: "mrow" });
        row.innerHTML = `
          <div class="mtank" style="--tank:${POND_COLOR[p.pond_id]}"><div class="water" data-water="${p.pond_id}" style="height:0%"></div></div>
          <div class="minfo">
            <div class="top"><b>บ่อ ${p.pond_id}</b>
              <span class="pc num"><span data-pct="${p.pond_id}">—</span><i>%</i></span></div>
            <div class="rl">${p.role_note ?? ""} · LT-${p.pond_id}</div>
            <div class="mbar"><span data-mbar="${p.pond_id}" style="width:0%"></span></div>
            <div class="rl"><span class="num" data-vol="${p.pond_id}"></span> · ส่งไป ${p.dst_note ?? "—"}</div>
            ${p.pond_id === "5" && onDiagram.has("TT-TANK5") ? `<div class="rl">อุณหภูมิ <b class="num" data-tapval="TT-TANK5">—</b> °C</div>` : ""}
            ${p.pond_id === "600Q" && onDiagram.has("FT-600Q") ? `<div class="rl">น้ำเข้า <b class="num" data-tapval="FT-600Q">—</b> m³/h</div>` : ""}
          </div>`;
        group.append(row);
      });
      box.append(group);
    }
  }

  // ย่อ/ขยายผัง 1120×684 ให้พอดีกับกล่องของบล็อก (หรือทั้งจอตอนเต็มจอ) โดยไม่บิดสัดส่วน
  function fitStage() {
    if (!diagramEl) return;
    const stage = $(".stage", diagramEl);
    const canvas = $(".canvas", diagramEl);
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    if (!W || !H) return;
    const scale = Math.min(W / 1120, H / 684);
    canvas.style.transform = `scale(${scale})`;
    canvas.style.marginLeft = `${(W - 1120 * scale) / 2}px`;
    canvas.style.marginTop = `${(H - 684 * scale) / 2}px`;
  }

  /* ---------- อัปเดตค่า ---------- */

  function renderLatest(data) {
    latest = data;
    const byTag = new Map(data.readings.map((r) => [r.tag, r]));

    for (const p of data.ponds) {
      const r = byTag.get(`LT-${p.pond_id}`);
      const lvl = r?.value;
      const state = r?.stale ? "stale" : statusOf(lvl, r ?? {});
      const pct = lvl == null ? 0 : Math.max(0, Math.min(100, lvl));

      $$(`[data-water="${p.pond_id}"]`, root).forEach((n) => {
        n.style.height = `${pct}%`;
        n.className = `water ${state}`;
      });
      $$(`[data-pct="${p.pond_id}"]`, root).forEach((n) => (n.textContent = lvl == null ? "—" : nf(lvl, 0)));
      $$(`[data-vol="${p.pond_id}"]`, root).forEach(
        (n) => (n.textContent = lvl == null ? "—" : `${nfInt((Number(p.capacity_m3) * lvl) / 100)} Q`)
      );
      $$(`[data-mbar="${p.pond_id}"]`, root).forEach((n) => {
        n.style.width = `${pct}%`;
        n.style.background = state === "hi" ? "var(--alarm)" : state === "lo" ? "var(--warn)" : "var(--water)";
      });
    }

    for (const r of data.readings) {
      const state = r.stale ? "stale" : statusOf(r.value, r);
      $$(`[data-tapval="${r.tag}"]`, root).forEach(
        (n) => (n.textContent = r.value == null ? "—" : nf(r.value, r.decimals))
      );
      $$(`[data-vcolor="${r.tag}"]`, root).forEach((n) => (n.style.color = stateColor(r, state, n.dataset.vnormal)));

      for (const gauge of $$(`[data-gauge="${r.tag}"]`, root)) {
        const gval = $("[data-gval]", gauge);
        gval.textContent = r.value == null ? "—" : nf(r.value, r.decimals);
        gval.style.color = stateColor(r, state, gval.dataset.vnormal);
        const min = Number(r.range_min ?? 0);
        const max = Number(r.range_max ?? 100);
        const bar = $("[data-gbar]", gauge);
        bar.style.width = r.value == null ? "0%" : `${Math.max(0, Math.min(100, ((r.value - min) / (max - min)) * 100))}%`;
        bar.style.background =
          state === "hi" ? "var(--alarm)" : state === "lo" ? "var(--warn)" : colorForTag(r.tag, r.pond_id);
        const st = $("[data-gstate]", gauge);
        st.textContent = stateLabel(r, state);
        st.style.color = stateColor(r, state, "var(--mute)");
      }

      if (r.value == null) continue;
      for (const dial of $$(`[data-dial="${r.tag}"]`, root)) {
        const min = Number(r.range_min ?? 0);
        const max = Number(r.range_max ?? 100);
        const t = Math.max(0, Math.min(1, (r.value - min) / (max - min)));
        const color = state === "hi" ? "#E2594B" : state === "lo" ? "#E3A33C" : dial.dataset.color ?? "#8FB9DC";
        const arc = $("[data-dialarc]", dial);
        arc.setAttribute("stroke-dasharray", `${(t * 1000).toFixed(0)} 1000`);
        arc.setAttribute("stroke", color);
        $("[data-dialneedle]", dial).setAttribute("transform", `rotate(${dialRotation(t)} ${DIAL_CENTER.CX} ${DIAL_CENTER.CY})`);
        const val = $("[data-dialval]", dial);
        val.textContent = nf(r.value, r.decimals);
        val.style.fill = state === "hi" ? "#E2594B" : state === "lo" ? "#E3A33C" : val.dataset.vnormal ?? "var(--bone)";
        const ds = $("[data-dialstate]", dial);
        ds.textContent = stateLabel(r, state);
        ds.style.color = stateColor(r, state, "var(--mute)");
      }
    }

    $("#totalVol", root).textContent = `${nfInt(data.totalVolume)} Q`;
    $$("[data-totz]", root).forEach((n) => (n.textContent = `${nfInt(data.totalizer)} m³`));

    const count = $("#alarmCount", root);
    count.textContent = data.alarms.unacked;
    count.style.color = data.alarms.unacked ? "var(--alarm)" : "var(--bone)";

    const signal = clear($("#signal", root));
    signal.append(el("span", { class: data.connected ? "dot" : "dot off" }), data.connected ? "รับค่าอยู่" : "ขาดการเชื่อมต่อ");

    $("#dashSub", root).textContent = `อัปเดตล่าสุด ${fmtTime(data.ts)} · ${data.ponds.map((p) => p.pond_id).join(" · ")}`;
  }

  /* ---------- แจ้งเตือน ---------- */

  async function refreshAlarms() {
    if (!alarmLists.length) return;
    const { alarms } = await api.get("/api/alarms?status=all&limit=40");
    for (const box of alarmLists) {
      clear(box);
      if (!alarms.length) {
        box.append(el("div", { class: "empty" }, "ยังไม่มีการแจ้งเตือน ทุกค่าอยู่ในช่วงปกติ"));
        continue;
      }
      for (const a of alarms) box.append(alarmRow(a));
    }
  }

  function alarmRow(a) {
    const done = Boolean(a.acked_at);
    const cleared = Boolean(a.cleared_at);
    const detail = `${a.pond_id ? `บ่อ ${a.pond_id} ` : ""}${CONDITION_LABEL[a.condition] ?? a.condition}` +
      (a.trigger_value != null ? ` (${nf(a.trigger_value, a.decimals)} ${a.unit})` : "");
    const action = done
      ? el("span", { class: "t" }, `รับทราบ · ${a.acked_by_name ?? a.acked_by ?? ""}`)
      : cleared
        ? el("span", { class: "t" }, "คืนสภาพแล้ว")
        : ctx.can("technician")
          ? el("button", {
              class: "sm",
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  await api.post(`/api/alarms/${a.id}/ack`);
                  toast("รับทราบแล้ว");
                  await refreshAlarms();
                } catch (err) {
                  toast(err.message, "err");
                  e.target.disabled = false;
                }
              },
            }, "รับทราบ")
          : el("span", { class: "t" }, "รอรับทราบ");

    return el("div", { class: `arow ${done || cleared ? "acked" : ""}` },
      el("span", { class: "t" }, fmtTime(a.raised_at)),
      el("span", { class: "tg" }, a.tag),
      el("span", {}, el("i", { class: `sev ${a.severity}` }), detail),
      action);
  }

  /* ---------- แถบเตือนเรื่องการรับแจ้งเตือน (ข้อ 5.1) ---------- */

  function renderFriendBanner(me) {
    const missingSteps = [];
    if (!me.user.line_linked) missingSteps.push("ผูกบัญชี LINE กับรหัสพนักงาน");
    else if (!me.user.is_oa_friend) missingSteps.push("เพิ่ม LINE OA ของระบบเป็นเพื่อน");
    if (me.user.line_linked && !me.user.notify_enabled) missingSteps.push("เปิดรับแจ้งเตือนในหน้าตั้งค่าส่วนตัว");

    if (!missingSteps.length || !me.lineMessaging) {
      friendBanner.hidden = true;
      return;
    }
    clear(friendBanner);
    friendBanner.hidden = false;
    const needFriend = me.user.line_linked && !me.user.is_oa_friend;
    add(
      friendBanner,
      // QR เพิ่มเพื่อน OA (ข้อ 5.1) พื้นขาวเสมอเพราะไฟล์เป็น PNG พื้นโปร่งใส
      needFriend && me.oaQrUrl
        ? el("img", {
            src: me.oaQrUrl,
            alt: "QR code สำหรับเพิ่ม LINE OA ของระบบเป็นเพื่อน",
            width: 88,
            height: 88,
            style: "background:#fff;padding:6px;border-radius:8px;flex:none",
          })
        : null,
      el("div", { class: "grow" },
        el("b", {}, "ยังไม่ได้รับแจ้งเตือนผ่าน LINE"),
        el("div", { style: "margin-top:4px;color:var(--mute)" }, `ต้องทำให้ครบก่อน: ${missingSteps.join(" · ")}`)),
      me.addFriendUrl
        ? el("a", { href: me.addFriendUrl, target: "_blank", rel: "noopener" }, el("button", { class: "sm" }, "เพิ่มเพื่อน LINE OA"))
        : null,
      el("a", { href: "#/settings" }, el("button", { class: "sm" }, "ตั้งค่าส่วนตัว"))
    );
  }

  /* ---------- โหมดจัด layout (เฉพาะแอดมิน — มีผลกับทุกคนที่เข้าดู) ---------- */

  function enterEdit() {
    if (window.matchMedia("(max-width:760px)").matches) {
      toast("จัด layout ได้บนจอคอมพิวเตอร์หรือแท็บเล็ตแนวนอน", "err");
      return;
    }
    leaveFullscreen();
    snapshot = structuredClone(layout);
    layoutHistory.clear();
    editing = true;
    grid.classList.add("editing");
    editBtn.hidden = true;
    palette.hidden = false;
    buildGrid(); // ให้บล็อกที่ซ่อนไว้โผล่ขึ้นมาให้จัดต่อได้
    buildPalette();
    updateGuides();
  }

  function exitEdit() {
    editing = false;
    snapshot = null;
    grid.classList.remove("editing");
    editBtn.hidden = false;
    palette.hidden = true;
    buildGrid(); // กลับสู่โหมดดูปกติ — ตัดบล็อกที่ซ่อนออก
  }

  function cancelEdit() {
    layout = snapshot;
    exitEdit();
  }

  async function saveEdit(btn) {
    btn.disabled = true;
    try {
      await api.put("/api/system/settings/dashboard.layout", { value: { items: layout } });
      exitEdit();
      toast("บันทึก layout แล้ว — ทุกคนจะเห็น Dashboard แบบนี้");
    } catch (err) {
      toast(err.message, "err");
    } finally {
      btn.disabled = false;
    }
  }

  async function resetLayout() {
    const ok = await confirmDialog(
      "คืนค่า layout เริ่มต้น",
      "จัดบล็อกกลับเป็นแบบเริ่มต้น (ผังบ่อ เกจเครื่องมือวัด กราฟ และบันทึกการแจ้งเตือน) — ยังไม่บันทึกจนกว่าจะกด \"บันทึก layout\"",
      "คืนค่า"
    );
    if (!ok) return;
    layoutHistory.edit(() => (layout = defaultLayout()));
    buildGrid();
    buildPalette();
  }

  function buildPalette() {
    clear(palette);
    const blocks = el("div", { class: "pblocks" });
    for (const [type, spec] of Object.entries(WIDGETS)) {
      const used = spec.single && layout.some((i) => i.type === type);
      const b = el("button", {
        class: "sm pblock",
        draggable: used ? "false" : "true",
        disabled: used,
        title: used ? `${spec.hint} (วางได้บล็อกเดียว มีอยู่แล้ว)` : spec.hint,
        onclick: () => addWidget(type),
      }, `+ ${spec.label}`);
      b.addEventListener("dragstart", (e) => {
        dragType = type;
        e.dataTransfer.setData("text/plain", type);
        e.dataTransfer.effectAllowed = "copy";
      });
      b.addEventListener("dragend", () => {
        dragType = null;
        ghost.remove();
      });
      blocks.append(b);
    }
    const saveBtn = el("button", { class: "sm primary" }, "บันทึก layout");
    saveBtn.addEventListener("click", () => saveEdit(saveBtn));
    palette.append(
      el("div", { class: "ptext" },
        el("b", {}, "จัด layout"),
        " · ลากบล็อกด้านล่างไปวางบนตาราง หรือกดเพื่อเพิ่มท้ายสุด · ลากบล็อกเพื่อย้าย · ลากมุมขวาล่างเพื่อปรับขนาด · ปุ่ม \"ซ่อน\" = วางไว้ก่อนแต่ยังไม่แสดงให้ผู้ดูเห็น"),
      blocks,
      el("div", { class: "pactions" },
        undoBtn,
        redoBtn,
        el("button", { class: "sm", onclick: resetLayout }, "คืนค่าเริ่มต้น"),
        el("button", { class: "sm", onclick: cancelEdit }, "ยกเลิก"),
        saveBtn)
    );
    // palette ติดขอบบนใต้แถบเมนูตอนเลื่อนลงไปวางบล็อกด้านล่าง
    palette.style.top = `${($(".appbar")?.offsetHeight ?? 0) + 8}px`;
  }

  // เส้นตารางจาง ๆ ในโหมดจัด layout ต้องรู้ความกว้างคอลัมน์จริงเป็น px
  function updateGuides() {
    grid.style.setProperty("--colw", `${columnWidth(grid)}px`);
    grid.style.setProperty("--rowstep", `${ROW_H + GAP}px`);
  }

  async function addWidget(type, at = null) {
    const spec = WIDGETS[type];
    if (spec.single && layout.some((i) => i.type === type)) return;
    const it = { id: newId(), type, x: 0, y: 0, w: spec.w, h: spec.h };
    if (spec.bind && !(await configure(it, true))) return;
    if (at) {
      it.x = clamp(at.x, 0, COLS - it.w);
      it.y = at.y;
    } else {
      it.y = layout.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    }
    layoutHistory.edit(() => {
      layout.push(it);
      compact(layout, it.id);
      compact(layout);
    });
    buildGrid();
    buildPalette();
    nodes.get(it.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function toggleHidden(it) {
    layoutHistory.edit(() => (it.hidden = !it.hidden || undefined));
    buildGrid();
  }

  function removeWidget(it) {
    layoutHistory.edit(() => {
      layout = layout.filter((i) => i.id !== it.id);
      compact(layout);
    });
    buildGrid();
    buildPalette();
  }

  /** ตั้งค่าบล็อก — isNew = เพิ่งลากมาวาง ต้องเลือกจุดวัด/บ่อก่อน คืน true ถ้ากดบันทึก */
  async function configure(it, isNew = false) {
    const spec = WIDGETS[it.type];
    if (!isNew) layoutHistory.begin();
    const fields = [];
    let read = () => {};

    const title = el("textarea", { rows: "2", maxlength: "60", placeholder: "เว้นว่าง = ใช้ชื่อจุดวัด/ชื่อบล็อก" });
    title.value = it.title ?? "";
    const titleSize = el("input", { type: "number", step: "1", min: "8", max: "72", value: it.titleSize ?? "", placeholder: "อัตโนมัติ" });
    const check = (label, on) => {
      const cb = el("input", { type: "checkbox" });
      cb.checked = on;
      return { cb, row: el("label", { style: "display:flex;gap:8px;align-items:center;margin:0 0 12px;color:var(--bone);font-size:13.5px" }, cb, label) };
    };
    const titleBold = check("หัวบล็อกตัวหนา", it.titleBold ?? false);
    // ช่องเลือกสี + ติ๊ก "ใช้สีเริ่มต้น" (input type=color ว่างไม่ได้ จึงต้องมีช่องติ๊กแยก)
    const colorPick = (label, value) => {
      const input = el("input", { type: "color", value: value ?? "#D6E4E5", style: "width:64px;padding:2px;height:34px" });
      const useDefault = el("input", { type: "checkbox" });
      useDefault.checked = !value;
      input.addEventListener("input", () => (useDefault.checked = false));
      return {
        read: () => (useDefault.checked ? undefined : input.value),
        row: el("div", { class: "field" }, el("label", {}, label),
          el("div", { style: "display:flex;gap:12px;align-items:center" }, input,
            el("label", { style: "display:flex;gap:6px;align-items:center;margin:0;color:var(--bone);font-size:13px" }, useDefault, "ใช้สีเริ่มต้น"))),
      };
    };
    const titleColor = colorPick("สีหัวบล็อก", it.titleColor);
    const valueColor = colorPick("สีตัวเลข (ตอนค่าปกติ — หลุด LL/HH ยังเป็นสีเตือน)", it.valueColor);
    fields.push(
      el("div", { class: "field" }, el("label", {}, "ชื่อที่แสดงบนหัวบล็อก (Enter = ขึ้นบรรทัดใหม่)"), title),
      el("div", { class: "field" }, el("label", {}, "ขนาดตัวอักษรหัวบล็อก (px) — เว้นว่าง = ย่อ/ขยายตามขนาดบล็อก"), titleSize),
      titleBold.row,
      titleColor.row
    );
    // ตัวเลขค่าที่อ่านได้จากสัญญาณ
    const hasValue = ["bar", "value", "tank", "dial"].includes(it.type);
    const valueSize = el("input", { type: "number", step: "1", min: "6", max: "300", value: it.valueSize ?? "", placeholder: "อัตโนมัติ" });
    const valueBold = check("ตัวเลขตัวหนา", it.valueBold ?? true);
    if (hasValue) {
      fields.push(
        el("div", { class: "field" }, el("label", {}, "ขนาดตัวเลขค่าที่อ่านได้ (px) — เว้นว่าง = ย่อ/ขยายตามขนาดบล็อก"), valueSize),
        valueBold.row,
        valueColor.row
      );
    }

    if (spec.bind === "tag") {
      const sel = el("select", {}, ...sensors.map((s) =>
        el("option", { value: s.tag, selected: s.tag === it.tag }, `${s.name} · ${s.tag} (${s.unit})`)));
      fields.push(el("div", { class: "field" }, el("label", {}, "จุดวัด"), sel));
      read = () => (it.tag = sel.value);
    } else if (spec.bind === "pond") {
      const sel = el("select", {}, ...ponds.map((p) =>
        el("option", { value: p.pond_id, selected: p.pond_id === it.pond }, `บ่อ ${p.pond_id} · ${p.name}`)));
      fields.push(el("div", { class: "field" }, el("label", {}, "บ่อ"), sel));
      read = () => (it.pond = sel.value);
    } else if (it.type === "chart") {
      const sel = el("select", {},
        el("option", { value: "", selected: !it.series }, "ระดับน้ำทุกบ่อ"),
        ...sensors.map((s) => el("option", { value: s.tag, selected: s.tag === it.series }, `${s.name} · ${s.tag}`)));
      fields.push(el("div", { class: "field" }, el("label", {}, "เส้นที่แสดงตอนเปิดหน้า"), sel));
      read = () => (it.series = sel.value || undefined);
    }

    const ok = await modal({
      title: `${isNew ? "เพิ่ม" : "ตั้งค่า"}บล็อก · ${spec.label}`,
      confirmLabel: isNew ? "วางบล็อก" : "ตกลง",
      body: el("div", {}, ...fields),
      onConfirm: async () => {
        it.title = title.value.trim() || undefined;
        const n = Number(titleSize.value);
        it.titleSize = titleSize.value === "" || !Number.isFinite(n) ? undefined : clamp(Math.round(n), 8, 72);
        it.titleBold = titleBold.cb.checked;
        it.titleColor = titleColor.read();
        if (hasValue) {
          const v = Number(valueSize.value);
          it.valueSize = valueSize.value === "" || !Number.isFinite(v) ? undefined : clamp(Math.round(v), 6, 300);
          it.valueBold = valueBold.cb.checked;
          it.valueColor = valueColor.read();
        }
        read();
        return true;
      },
    });
    if (!isNew) {
      layoutHistory.end();
      if (ok) buildGrid();
    }
    return Boolean(ok);
  }

  const onKey = (e) => {
    // ตัวแก้ไขผังบ่อ (.dedit) มีปุ่มลัดเลิกทำของตัวเอง
    if (!editing || document.querySelector(".dedit, .modal-bg") || e.target.closest?.("input, select, textarea")) return;
    handleUndoKeys(e, layoutHistory);
  };
  document.addEventListener("keydown", onKey);

  grid.addEventListener("dragover", (e) => {
    if (!editing || !dragType) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const spec = WIDGETS[dragType];
    const c = cellAt(grid, e.clientX, e.clientY);
    ghost.style.gridColumn = `${clamp(c.x, 0, COLS - spec.w) + 1} / span ${spec.w}`;
    ghost.style.gridRow = `${c.y + 1} / span ${spec.h}`;
    if (!ghost.isConnected) grid.append(ghost);
  });
  grid.addEventListener("dragleave", (e) => {
    if (!grid.contains(e.relatedTarget)) ghost.remove();
  });
  grid.addEventListener("drop", (e) => {
    if (!editing || !dragType) return;
    e.preventDefault();
    const type = dragType;
    dragType = null;
    ghost.remove();
    addWidget(type, cellAt(grid, e.clientX, e.clientY));
  });

  /* ---------- วงจรชีวิตของหน้า ---------- */

  const onResize = () => {
    fitStage();
    charts.forEach((c) => c.render());
    if (editing) updateGuides();
  };

  async function start() {
    try {
      const [meta, data] = await Promise.all([api.get("/api/sensors"), api.get("/api/readings/latest")]);
      sensors = meta.sensors;
      ponds = data.ponds;
      cardVisibility = meta.dashboardCards ?? {};
      hiddenTags = new Set(meta.dashboardHiddenTags ?? []);
      latest = data;
      diagram = Array.isArray(meta.dashboardDiagram?.items) ? meta.dashboardDiagram : defaultDiagram(sensors, hiddenTags);
      layout = loadLayout(meta.dashboardLayout);
      buildGrid();
      renderFriendBanner(ctx.me);
    } catch (err) {
      toast(err.message, "err");
      return;
    }

    window.addEventListener("resize", onResize);
    // ความกว้างตารางเปลี่ยนได้โดยไม่มี resize event (เช่น แถบเลื่อนโผล่) — ผังและกราฟต้องวาดตามทุกครั้ง
    resizeObs = new ResizeObserver(onResize);
    resizeObs.observe(grid);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        renderLatest(await api.get("/api/readings/latest"));
        await refreshAlarms();
      } catch {
        const signal = clear($("#signal", root));
        signal.append(el("span", { class: "dot off" }), "ขาดการเชื่อมต่อ");
      }
    }, REFRESH_MS);
  }

  start();

  return {
    node: root,
    destroy() {
      if (timer) clearInterval(timer);
      window.removeEventListener("resize", onResize);
      resizeObs?.disconnect();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      leaveFullscreen();
    },
  };
}
