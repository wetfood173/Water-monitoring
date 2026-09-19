import { api } from "../api.js";
import { $, $$, el, add, clear, nf, nfInt, fmtTime, statusOf, toast, modal, CONDITION_LABEL } from "../util.js";
import { drawChart, colorForTag, POND_COLOR } from "../chart.js";
import {
  LAYOUT, SENSOR_TAGS, DIALS, MOBILE_GROUPS, SOFTENER_SVG,
  buildPipesSvg, buildDialSvg, dialRotation, DIAL_CENTER,
} from "../diagram.js";

const REFRESH_MS = 5000;
const RANGES = [
  { key: "1h", label: "1 ชม." },
  { key: "24h", label: "24 ชม." },
  { key: "7d", label: "7 วัน" },
  { key: "30d", label: "30 วัน" },
];

// การ์ดที่แอดมินเลือกซ่อน/แสดงได้ — เก็บเป็นค่าตั้งระบบ (dashboard.visible_cards) มีผลกับทุกคนที่เข้าดู
const CARD_LABELS = {
  diagram: "ผังบ่อและทิศทางการไหล",
  instruments: "เครื่องมือวัดกระบวนการ",
  chart: "แนวโน้มย้อนหลัง",
  alarms: "บันทึกการแจ้งเตือน",
};

export function dashboardPage(ctx) {
  const root = el("div");
  let sensors = [];
  let ponds = [];
  let latest = null;
  let range = "1h";
  let selected = "ALL";
  let timer = null;
  let chartAbort = null;
  let cardVisibility = { diagram: true, instruments: true, chart: true, alarms: true };
  let hiddenTags = new Set();

  root.append(
    el(
      "div",
      { class: "page-head" },
      el(
        "div",
        {},
        el("h2", {}, "ผังเฝ้าระวังน้ำ 7 บ่อ"),
        el("p", { id: "dashSub" }, "กำลังโหลดข้อมูล…")
      ),
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
      ctx.can("admin")
        ? el("button", { class: "sm", onclick: openCardSettings }, "จัดการการ์ด")
        : null
    )
  );

  const friendBanner = el("div", { class: "banner", hidden: true });
  root.append(friendBanner);

  function cardCloseBtn(key) {
    if (!ctx.can("admin")) return null;
    return el(
      "button",
      { class: "sm", title: 'ซ่อนการ์ดนี้ (เปิดกลับได้จาก "จัดการการ์ด")', onclick: () => hideCard(key) },
      "ซ่อน"
    );
  }

  const strip = el(
    "section",
    { class: "strip" },
    el(
      "div",
      { style: "display:flex;justify-content:space-between;align-items:center;gap:10px" },
      el("h2", { style: "margin-bottom:0" }, "ผังบ่อและทิศทางการไหล"),
      cardCloseBtn("diagram")
    ),
    el("div", { class: "stage", id: "stage" }, el("div", { class: "canvas", id: "canvasArea" })),
    el("div", { class: "mobile", id: "mobileView" })
  );
  root.append(strip);

  const instCard = el(
    "div",
    { class: "card" },
    el("h3", {}, el("span", {}, "เครื่องมือวัดกระบวนการ"), cardCloseBtn("instruments")),
    el("div", { class: "inst", id: "inst" })
  );
  root.append(instCard);

  const chartCard = el(
    "div",
    { class: "card" },
    el(
      "h3",
      {},
      el("span", {}, "แนวโน้มย้อนหลัง"),
      el(
        "div",
        { style: "display:flex;align-items:center;gap:10px" },
        el("span", { class: "num", id: "chartNow", style: "color:var(--bone)" }),
        cardCloseBtn("chart")
      )
    ),
    el("div", { class: "seg", id: "rangeSeg", role: "tablist" }),
    el("div", { class: "tabrow" }, el("span", { class: "tl" }, "ระดับน้ำ"), el("div", { class: "chips", id: "tabsA", role: "tablist" })),
    el("div", { class: "tabrow" }, el("span", { class: "tl" }, "เครื่องมือวัด"), el("div", { class: "chips", id: "tabsB", role: "tablist" })),
    el("div", { class: "legend", id: "legend" }),
    el("canvas", { class: "chart", id: "chart" })
  );
  root.append(chartCard);

  const ackAllBtn = el("button", { class: "sm" }, "รับทราบทั้งหมด");
  const alarmCard = el(
    "div",
    { class: "card" },
    el(
      "h3",
      {},
      el("span", {}, "บันทึกการแจ้งเตือน"),
      el(
        "div",
        { style: "display:flex;align-items:center;gap:10px" },
        ctx.can("technician") ? ackAllBtn : null,
        cardCloseBtn("alarms")
      )
    ),
    el("div", { class: "alist", id: "alist" })
  );
  root.append(alarmCard);

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

  /* ---------- สร้างผัง ---------- */

  function buildDiagram() {
    const area = $("#canvasArea", root);
    clear(area);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "pipes");
    svg.setAttribute("viewBox", "0 0 1120 684");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = buildPipesSvg();
    area.append(svg);

    for (const p of ponds) {
      const box = LAYOUT[p.pond_id];
      if (!box) continue;
      const tag = `LT-${p.pond_id}`;
      const tank = el("div", {
        class: "tank" + (box.sm ? " sm" : ""),
        style: `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`,
      });
      const vessel = el("div", {
        class: "vessel",
        tabindex: "0",
        role: "button",
        "aria-label": `บ่อ ${p.pond_id}`,
      });
      vessel.innerHTML = `<div class="water" data-water="${p.pond_id}" style="height:0%"></div>
        <div class="pctbox"><div class="p num"><span data-pct="${p.pond_id}">—</span><i>%</i></div>
        ${box.sm ? "" : `<div class="m3 num" data-vol="${p.pond_id}"></div>`}</div>`;
      const go = () => selectSeries(tag);
      vessel.addEventListener("click", go);
      vessel.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
      tank.append(vessel, el("div", { class: "caption", style: `top:${box.h + 8}px` }, `บ่อ ${p.pond_id}`));
      area.append(tank);
    }

    for (const t of SENSOR_TAGS) {
      if (hiddenTags.has(t.tag)) continue;
      const s = sensors.find((x) => x.tag === t.tag);
      if (!s) continue;
      const node = el("div", {
        class: "tap",
        style: `left:${t.x}px;top:${t.y}px;border-left:2px solid ${t.color}`,
        tabindex: "0",
        role: "button",
      });
      node.innerHTML = `<small>${t.label}</small>
        <div class="tv"><b class="num" data-tapval="${t.tag}">—</b><i>${s.unit}</i></div>`;
      node.addEventListener("click", () => selectSeries(t.tag));
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectSeries(t.tag);
        }
      });
      add(node, tagCloseBtn(t.tag));
      area.append(node);
    }

    // Softener อยู่ด้านขวาของกอง 1B/1A จ่ายน้ำเข้าทั้งสองบ่อ
    const soft = el("div", { class: "softener", style: "left:1000px;top:187px;width:110px;height:120px" });
    soft.innerHTML = `${SOFTENER_SVG}<b>Softener</b>`;
    area.append(soft);

    for (const d of DIALS) {
      if (hiddenTags.has(d.tag)) continue;
      const s = sensors.find((x) => x.tag === d.tag);
      if (!s) continue;
      const node = el("div", { class: "dial", style: `left:${d.x}px;top:${d.y}px`, dataset: { dial: d.tag } });
      node.innerHTML = `<div class="dtitle"><span>${s.name}<small>${s.tag}</small></span>
        <span class="dstate" data-dialstate>ปกติ</span></div>${buildDialSvg(s, d.color)}`;
      add(node, tagCloseBtn(d.tag));
      area.append(node);
    }

    fitStage();
  }

  function buildMobileView() {
    const box = $("#mobileView", root);
    clear(box);
    for (const g of MOBILE_GROUPS) {
      const group = el("div", { class: "mgroup" }, el("h4", {}, g.heading));
      g.ids.forEach((id, i) => {
        const p = ponds.find((x) => x.pond_id === id);
        if (!p) return;
        if (g.chain && i > 0) group.append(el("div", { class: "mconn" }, `รับน้ำจาก ${p.src_note ?? "—"}`));
        const row = el("div", { class: "mrow" });
        row.innerHTML = `
          <div class="mtank"><div class="water" data-water="${p.pond_id}" style="height:0%"></div></div>
          <div class="minfo">
            <div class="top"><b>บ่อ ${p.pond_id}</b>
              <span class="pc num"><span data-pct="${p.pond_id}">—</span><i>%</i></span></div>
            <div class="rl">${p.role_note ?? ""} · LT-${p.pond_id}</div>
            <div class="mbar"><span data-mbar="${p.pond_id}" style="width:0%"></span></div>
            <div class="rl"><span class="num" data-vol="${p.pond_id}"></span> · ส่งไป ${p.dst_note ?? "—"}</div>
            ${p.pond_id === "5" && !hiddenTags.has("TT-05") ? `<div class="rl">อุณหภูมิ <b class="num" data-tapval="TT-05">—</b> °C</div>` : ""}
            ${p.pond_id === "600Q" && !hiddenTags.has("FT-600Q") ? `<div class="rl">น้ำเข้า <b class="num" data-tapval="FT-600Q">—</b> m³/h</div>` : ""}
          </div>`;
        group.append(row);
      });
      box.append(group);
    }
  }

  function buildInstruments() {
    const box = $("#inst", root);
    clear(box);
    for (const s of sensors.filter((x) => x.metric !== "level" && !hiddenTags.has(x.tag))) {
      const min = Number(s.range_min ?? 0);
      const max = Number(s.range_max ?? 100);
      const card = el("div", { class: "gauge", style: "position:relative", dataset: { gauge: s.tag } });
      card.innerHTML = `<div class="lbl">${s.name}<small>${s.tag}</small></div>
        <div class="read"><b data-gval>—</b><i>${s.unit}</i></div>
        <div class="bar"><span data-gbar></span>
          <i class="mark" style="left:${((Number(s.ll) - min) / (max - min)) * 100}%"></i>
          <i class="mark" style="left:${((Number(s.hh) - min) / (max - min)) * 100}%"></i></div>
        <div class="range"><span>LL ${s.ll}</span><span data-gstate>ปกติ</span><span>HH ${s.hh}</span></div>
        ${s.tag === "FT-600Q"
          ? `<div class="range" style="margin-top:7px"><span>ปริมาณสะสมวันนี้</span><span class="num" id="totz">—</span></div>`
          : ""}`;
      add(card, tagCloseBtn(s.tag));
      box.append(card);
    }
  }

  function fitStage() {
    const stage = $("#stage", root);
    const canvas = $("#canvasArea", root);
    if (!stage || !canvas) return;
    const scale = Math.min(1, stage.clientWidth / 1120);
    canvas.style.transform = `scale(${scale})`;
    stage.style.height = `${684 * scale}px`;
    // จอกว้างกว่าผัง (เช่น 1920px) — scale ค้างที่ 1 แล้วเหลือที่ว่างด้านขวา ต้องเลื่อนผังมาไว้กึ่งกลางเอง
    // เพราะ transform-origin เป็น top left ทำให้ margin:auto ธรรมดาไม่พอ
    canvas.style.marginLeft = `${Math.max(0, (stage.clientWidth - 1120 * scale) / 2)}px`;
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
      $$(`[data-tapval="${r.tag}"]`, root).forEach(
        (n) => (n.textContent = r.value == null ? "—" : nf(r.value, r.decimals))
      );

      const gauge = $(`[data-gauge="${r.tag}"]`, root);
      if (gauge) {
        const state = r.stale ? "stale" : statusOf(r.value, r);
        const color = state === "hi" ? "var(--alarm)" : state === "lo" ? "var(--warn)" : "var(--bone)";
        const label = r.stale ? "ขาดสัญญาณ" : state === "hi" ? "สูงเกินกำหนด" : state === "lo" ? "ต่ำกว่ากำหนด" : "ปกติ";
        $("[data-gval]", gauge).textContent = r.value == null ? "—" : nf(r.value, r.decimals);
        $("[data-gval]", gauge).style.color = r.stale ? "var(--mute)" : color;
        const min = Number(r.range_min ?? 0);
        const max = Number(r.range_max ?? 100);
        const bar = $("[data-gbar]", gauge);
        bar.style.width = r.value == null ? "0%" : `${Math.max(0, Math.min(100, ((r.value - min) / (max - min)) * 100))}%`;
        bar.style.background =
          state === "hi" ? "var(--alarm)" : state === "lo" ? "var(--warn)" : colorForTag(r.tag, r.pond_id);
        const st = $("[data-gstate]", gauge);
        st.textContent = label;
        st.style.color = r.stale ? "var(--mute)" : state === "hi" ? "var(--alarm)" : state === "lo" ? "var(--warn)" : "var(--mute)";
      }

      const dial = $(`[data-dial="${r.tag}"]`, root);
      if (dial && r.value != null) {
        const min = Number(r.range_min ?? 0);
        const max = Number(r.range_max ?? 100);
        const t = Math.max(0, Math.min(1, (r.value - min) / (max - min)));
        const state = r.stale ? "" : statusOf(r.value, r);
        const color =
          state === "hi" ? "#E2594B" : state === "lo" ? "#E3A33C" : DIALS.find((d) => d.tag === r.tag)?.color ?? "#8FB9DC";
        const arc = $("[data-dialarc]", dial);
        arc.setAttribute("stroke-dasharray", `${(t * 1000).toFixed(0)} 1000`);
        arc.setAttribute("stroke", color);
        $("[data-dialneedle]", dial).setAttribute(
          "transform",
          `rotate(${dialRotation(t)} ${DIAL_CENTER.CX} ${DIAL_CENTER.CY})`
        );
        const val = $("[data-dialval]", dial);
        val.textContent = nf(r.value, r.decimals);
        val.style.fill = state === "hi" ? "#E2594B" : state === "lo" ? "#E3A33C" : "var(--bone)";
        const ds = $("[data-dialstate]", dial);
        ds.textContent = r.stale ? "ขาดสัญญาณ" : state === "hi" ? "สูงเกินกำหนด" : state === "lo" ? "ต่ำกว่ากำหนด" : "ปกติ";
        ds.style.color = state === "hi" ? "var(--alarm)" : state === "lo" ? "var(--warn)" : "var(--mute)";
      }
    }

    $("#totalVol", root).textContent = `${nfInt(data.totalVolume)} Q`;
    const totz = $("#totz", root);
    if (totz) totz.textContent = `${nfInt(data.totalizer)} m³`;

    const count = $("#alarmCount", root);
    count.textContent = data.alarms.unacked;
    count.style.color = data.alarms.unacked ? "var(--alarm)" : "var(--bone)";

    const signal = $("#signal", root);
    clear(signal);
    signal.append(el("span", { class: data.connected ? "dot" : "dot off" }), data.connected ? "รับค่าอยู่" : "ขาดการเชื่อมต่อ");

    $("#dashSub", root).textContent = `อัปเดตล่าสุด ${fmtTime(data.ts)} · ${data.ponds.map((p) => p.pond_id).join(" · ")}`;
  }

  /* ---------- แจ้งเตือน ---------- */

  async function refreshAlarms() {
    const { alarms } = await api.get("/api/alarms?status=all&limit=40");
    const box = $("#alist", root);
    clear(box);
    if (!alarms.length) {
      box.append(el("div", { class: "empty" }, "ยังไม่มีการแจ้งเตือน ทุกค่าอยู่ในช่วงปกติ"));
      return;
    }
    for (const a of alarms) {
      const done = Boolean(a.acked_at);
      const cleared = Boolean(a.cleared_at);
      const detail = `${a.pond_id ? `บ่อ ${a.pond_id} ` : ""}${CONDITION_LABEL[a.condition] ?? a.condition}` +
        (a.trigger_value != null ? ` (${nf(a.trigger_value, a.decimals)} ${a.unit})` : "");
      const action = done
        ? el("span", { class: "t" }, `รับทราบ · ${a.acked_by_name ?? a.acked_by ?? ""}`)
        : cleared
          ? el("span", { class: "t" }, "คืนสภาพแล้ว")
          : ctx.can("technician")
          ? el(
              "button",
              {
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
              },
              "รับทราบ"
            )
          : el("span", { class: "t" }, "รอรับทราบ");

      box.append(
        el(
          "div",
          { class: `arow ${done || cleared ? "acked" : ""}` },
          el("span", { class: "t" }, fmtTime(a.raised_at)),
          el("span", { class: "tg" }, a.tag),
          el("span", {}, el("i", { class: `sev ${a.severity}` }), detail),
          action
        )
      );
    }
  }

  /* ---------- กราฟ ---------- */

  function buildChartControls() {
    const seg = $("#rangeSeg", root);
    clear(seg);
    for (const r of RANGES) {
      seg.append(
        el(
          "button",
          {
            role: "tab",
            "aria-selected": String(r.key === range),
            dataset: { r: r.key },
            onclick: () => {
              range = r.key;
              $$("#rangeSeg button", root).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.r === r.key)));
              loadChart();
            },
          },
          r.label
        )
      );
    }

    const tabsA = clear($("#tabsA", root));
    const tabsB = clear($("#tabsB", root));
    const mkTab = (box, key, label) =>
      box.append(
        el(
          "button",
          { role: "tab", "aria-selected": String(key === selected), dataset: { k: key }, onclick: () => selectSeries(key) },
          label
        )
      );
    mkTab(tabsA, "ALL", "ทุกบ่อ");
    for (const p of ponds) mkTab(tabsA, `LT-${p.pond_id}`, `บ่อ ${p.pond_id}`);
    for (const s of sensors.filter((x) => x.metric !== "level")) mkTab(tabsB, s.tag, s.name);

    const legend = clear($("#legend", root));
    for (const p of ponds) {
      legend.append(
        el("span", {}, el("i", { style: `background:${POND_COLOR[p.pond_id] ?? "#3FB4A8"}` }), `บ่อ ${p.pond_id}`)
      );
    }
  }

  function selectSeries(key) {
    selected = key;
    $$("#tabsA button, #tabsB button", root).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.k === key)));
    $("#legend", root).classList.toggle("on", key === "ALL");
    loadChart();
  }

  let chartData = null;
  async function loadChart() {
    const tags = selected === "ALL" ? ponds.map((p) => `LT-${p.pond_id}`) : [selected];
    chartAbort = Symbol("chart");
    const token = chartAbort;
    try {
      const data = await api.get(`/api/readings/history?range=${range}&tag=${encodeURIComponent(tags.join(","))}`);
      if (token !== chartAbort) return;
      chartData = data;
      renderChart();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  function renderChart() {
    if (!chartData) return;
    const canvas = $("#chart", root);
    const tags = Object.keys(chartData.series);
    const first = sensors.find((s) => s.tag === tags[0]);
    const series = tags.map((tag) => {
      const s = sensors.find((x) => x.tag === tag);
      return { name: s?.name ?? tag, color: colorForTag(tag, s?.pond_id), data: chartData.series[tag] };
    });
    drawChart(canvas, {
      series,
      from: chartData.from,
      to: chartData.to,
      unit: first?.unit ?? "",
      decimals: first?.decimals ?? 1,
    });

    const label = $("#chartNow", root);
    if (series.length === 1) {
      const points = series[0].data.filter((p) => p.value != null);
      const last = points[points.length - 1];
      label.textContent = last ? `${nf(last.value, first?.decimals ?? 1)} ${first?.unit ?? ""}` : "—";
    } else {
      label.textContent = "ระดับน้ำ 7 บ่อ (%)";
    }
  }

  /* ---------- แถบเตือนเรื่องการรับแจ้งเตือน (ข้อ 5.1) ---------- */

  function renderFriendBanner(me) {
    const missing = [];
    if (!me.user.line_linked) missing.push("ผูกบัญชี LINE กับรหัสพนักงาน");
    else if (!me.user.is_oa_friend) missing.push("เพิ่ม LINE OA ของระบบเป็นเพื่อน");
    if (me.user.line_linked && !me.user.notify_enabled) missing.push("เปิดรับแจ้งเตือนในหน้าตั้งค่าส่วนตัว");

    if (!missing.length || !me.lineMessaging) {
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
      el(
        "div",
        { class: "grow" },
        el("b", {}, "ยังไม่ได้รับแจ้งเตือนผ่าน LINE"),
        el("div", { style: "margin-top:4px;color:var(--mute)" }, `ต้องทำให้ครบก่อน: ${missing.join(" · ")}`)
      ),
      me.addFriendUrl
        ? el("a", { href: me.addFriendUrl, target: "_blank", rel: "noopener" }, el("button", { class: "sm" }, "เพิ่มเพื่อน LINE OA"))
        : null,
      el("a", { href: "#/settings" }, el("button", { class: "sm" }, "ตั้งค่าส่วนตัว"))
    );
  }

  /* ---------- ซ่อน/แสดงการ์ดและเครื่องมือวัดรายจุด (เฉพาะแอดมิน — มีผลกับทุกคนที่เข้าดู) ---------- */

  function applyCardVisibility() {
    strip.hidden = cardVisibility.diagram === false;
    instCard.hidden = cardVisibility.instruments === false;
    chartCard.hidden = cardVisibility.chart === false;
    alarmCard.hidden = cardVisibility.alarms === false;
  }

  async function saveCardVisibility(next) {
    await api.put("/api/system/settings/dashboard.visible_cards", { value: next });
    cardVisibility = next;
    applyCardVisibility();
  }

  async function hideCard(key) {
    try {
      await saveCardVisibility({ ...cardVisibility, [key]: false });
      toast(`ซ่อนการ์ด "${CARD_LABELS[key]}" แล้ว — เปิดกลับได้จาก "จัดการการ์ด"`);
    } catch (err) {
      toast(err.message, "err");
    }
  }

  // จุดวัดที่ซ่อนรายตัว (แสดงในหน้าผัง/เครื่องมือวัด — ไม่รวมระดับน้ำในบ่อ ซึ่งเป็นค่าหลักของหน้านี้)
  function rebuildSensorViews() {
    buildDiagram();
    buildMobileView();
    buildInstruments();
    if (latest) renderLatest(latest);
  }

  async function saveHiddenTags(nextTags) {
    const uniq = [...new Set(nextTags)];
    await api.put("/api/system/settings/dashboard.hidden_tags", { value: uniq });
    hiddenTags = new Set(uniq);
    rebuildSensorViews();
  }

  async function hideTag(tag) {
    try {
      const s = sensors.find((x) => x.tag === tag);
      await saveHiddenTags([...hiddenTags, tag]);
      toast(`ซ่อน "${s?.name ?? tag}" แล้ว — เปิดกลับได้จาก "จัดการการ์ด"`);
    } catch (err) {
      toast(err.message, "err");
    }
  }

  // ปุ่มซ่อนลอยมุมขวาบน — ใช้กับ .tap/.dial/.gauge ที่มี position:relative หรือ absolute อยู่แล้ว
  function tagCloseBtn(tag) {
    if (!ctx.can("admin")) return null;
    return el(
      "button",
      {
        class: "sm",
        style: "position:absolute;top:6px;right:6px;padding:2px 9px;font-size:10.5px",
        title: 'ซ่อนเครื่องมือวัดนี้ (เปิดกลับได้จาก "จัดการการ์ด")',
        onclick: (e) => {
          e.stopPropagation();
          hideTag(tag);
        },
      },
      "ซ่อน"
    );
  }

  async function openCardSettings() {
    const cardChecks = {};
    const cardRows = Object.entries(CARD_LABELS).map(([key, label]) => {
      const cb = el("input", { type: "checkbox" });
      cb.checked = cardVisibility[key] !== false;
      cardChecks[key] = cb;
      return el(
        "label",
        { style: "display:flex;gap:8px;align-items:center;padding:7px 0;color:var(--bone);font-size:13.5px" },
        cb,
        label
      );
    });

    const tagChecks = {};
    const instruments = sensors.filter((s) => s.metric !== "level");
    const tagRows = instruments.map((s) => {
      const cb = el("input", { type: "checkbox" });
      cb.checked = !hiddenTags.has(s.tag);
      tagChecks[s.tag] = cb;
      return el(
        "label",
        { style: "display:flex;gap:8px;align-items:center;padding:6px 0;color:var(--bone);font-size:13.5px" },
        cb,
        `${s.name} · ${s.tag}`
      );
    });

    const ok = await modal({
      title: "เลือกสิ่งที่จะแสดงบน Dashboard",
      confirmLabel: "บันทึก",
      body: el(
        "div",
        {},
        el("p", { style: "font-size:12.5px;color:var(--mute);margin-bottom:10px" }, "มีผลกับทุกคนที่เข้าดูหน้านี้"),
        el("div", { style: "font-size:12.5px;color:var(--mute);margin:12px 0 4px;text-transform:uppercase;letter-spacing:.04em" }, "การ์ด"),
        ...cardRows,
        instruments.length
          ? el(
              "div",
              {},
              el(
                "div",
                { style: "font-size:12.5px;color:var(--mute);margin:16px 0 4px;text-transform:uppercase;letter-spacing:.04em" },
                "เครื่องมือวัดเฉพาะจุด (ในผังและการ์ดเครื่องมือวัด)"
              ),
              ...tagRows
            )
          : null
      ),
      onConfirm: async () => {
        const nextCards = {};
        for (const key of Object.keys(CARD_LABELS)) nextCards[key] = cardChecks[key].checked;
        const nextHidden = instruments.filter((s) => !tagChecks[s.tag].checked).map((s) => s.tag);
        await saveCardVisibility(nextCards);
        await saveHiddenTags(nextHidden);
        return true;
      },
    });
    if (ok) toast("บันทึกการแสดงผลแล้ว");
  }

  /* ---------- วงจรชีวิตของหน้า ---------- */

  const onResize = () => {
    fitStage();
    renderChart();
  };

  async function start() {
    try {
      const [meta, data] = await Promise.all([api.get("/api/sensors"), api.get("/api/readings/latest")]);
      sensors = meta.sensors;
      ponds = data.ponds;
      cardVisibility = { ...cardVisibility, ...meta.dashboardCards };
      hiddenTags = new Set(meta.dashboardHiddenTags ?? []);
      applyCardVisibility();
      buildDiagram();
      buildMobileView();
      buildInstruments();
      buildChartControls();
      selectSeries("ALL");
      renderLatest(data);
      renderFriendBanner(ctx.me);
      await refreshAlarms();
    } catch (err) {
      toast(err.message, "err");
      return;
    }

    window.addEventListener("resize", onResize);
    timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        renderLatest(await api.get("/api/readings/latest"));
        await refreshAlarms();
      } catch {
        const signal = $("#signal", root);
        clear(signal);
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
    },
  };
}
