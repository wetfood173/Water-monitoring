import { api } from "../api.js";
import { $, $$, el, clear, nf, fmtDateTime, toast, toLocalInput } from "../util.js";
import { drawChart, colorForTag } from "../chart.js";

const RANGES = [
  { key: "1h", label: "1 ชม." },
  { key: "24h", label: "24 ชม." },
  { key: "7d", label: "7 วัน" },
  { key: "30d", label: "30 วัน" },
  { key: "custom", label: "กำหนดเอง" },
];

export function historyPage(ctx) {
  const root = el("div");
  let sensors = [];
  let selectedTags = [];
  let range = "24h";
  let data = null;
  let retentionRawDays = 0; // 0 = ไม่จำกัด — อัปเดตจริงตอนโหลดข้อมูลจาก /api/sensors

  root.append(
    el(
      "div",
      { class: "page-head" },
      el("div", {}, el("h2", {}, "ประวัติย้อนหลัง"), el("p", {}, "เลือกจุดวัดและช่วงเวลาเพื่อดูแนวโน้มและค่าสรุป"))
    )
  );

  const seg = el("div", { class: "seg", role: "tablist" });
  const customBox = el("div", { style: "margin-top:12px", hidden: true });
  const fromInput = el("input", { type: "datetime-local" });
  const toInput = el("input", { type: "datetime-local" });
  const applyBtn = el("button", { class: "primary" }, "ดูข้อมูล");
  const retentionHint = el("p", { style: "font-size:12px;color:var(--mute);margin-bottom:8px", hidden: true });
  customBox.append(
    retentionHint,
    el("div", { class: "row" },
      el("div", { class: "field" }, el("label", {}, "ตั้งแต่"), fromInput),
      el("div", { class: "field" }, el("label", {}, "ถึง"), toInput),
      applyBtn)
  );
  fromInput.value = toLocalInput(new Date(Date.now() - 7 * 86400000));
  toInput.value = toLocalInput(new Date());

  // จำกัดตัวเลือกช่วงวันที่กำหนดเองไม่ให้ย้อนเกินระยะที่ข้อมูลดิบถูกเก็บไว้จริง (retention.raw_days)
  function applyRetentionBound() {
    if (!retentionRawDays) {
      retentionHint.hidden = true;
      fromInput.removeAttribute("min");
      return;
    }
    const cutoff = new Date(Date.now() - retentionRawDays * 86400000);
    fromInput.min = toLocalInput(cutoff);
    toInput.min = toLocalInput(cutoff);
    retentionHint.hidden = false;
    retentionHint.textContent = `ข้อมูลดิบเก็บย้อนหลังได้ไม่เกิน ${retentionRawDays} วัน — เลือกวันก่อนหน้านั้นไม่ได้`;
    if (new Date(fromInput.value) < cutoff) fromInput.value = toLocalInput(cutoff);
  }

  const tagChips = el("div", { class: "chips" });

  root.append(
    el(
      "div",
      { class: "card" },
      el("h3", {}, "ช่วงเวลา"),
      seg,
      customBox,
      el("div", { style: "margin-top:14px" }, el("h3", {}, "จุดวัด"), tagChips)
    )
  );

  const chartCard = el(
    "div",
    { class: "card" },
    el("h3", {}, el("span", {}, "กราฟแนวโน้ม"), el("span", { class: "num", id: "hSpan", style: "color:var(--mute)" })),
    el("div", { class: "legend on", id: "hLegend" }),
    el("canvas", { class: "chart", id: "hChart", style: "height:340px" })
  );
  root.append(chartCard);

  const statsCard = el("div", { class: "card" }, el("h3", {}, "ค่าสรุปในช่วงที่เลือก"), el("div", { class: "tablewrap", id: "hStats" }));
  root.append(statsCard);

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
            $$("button", seg).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.r === r.key)));
            customBox.hidden = r.key !== "custom";
            if (r.key !== "custom") load();
          },
        },
        r.label
      )
    );
  }
  applyBtn.addEventListener("click", load);

  function buildChips() {
    clear(tagChips);
    for (const s of sensors) {
      tagChips.append(
        el(
          "button",
          {
            "aria-selected": String(selectedTags.includes(s.tag)),
            dataset: { k: s.tag },
            onclick: (e) => {
              const i = selectedTags.indexOf(s.tag);
              if (i >= 0) {
                if (selectedTags.length === 1) return toast("ต้องเลือกอย่างน้อยหนึ่งจุดวัด", "err");
                selectedTags.splice(i, 1);
              } else {
                selectedTags.push(s.tag);
              }
              e.target.setAttribute("aria-selected", String(selectedTags.includes(s.tag)));
              load();
            },
          },
          s.pond_id && s.metric === "level" ? `บ่อ ${s.pond_id}` : s.tag
        )
      );
    }
  }

  async function load() {
    const params = new URLSearchParams({ tag: selectedTags.join(",") });
    if (range === "custom") {
      params.set("from", new Date(fromInput.value).toISOString());
      params.set("to", new Date(toInput.value).toISOString());
    } else {
      params.set("range", range);
    }
    try {
      data = await api.get(`/api/readings/history?${params}`);
      render();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  function render() {
    if (!data) return;
    const first = sensors.find((s) => s.tag === selectedTags[0]);
    const series = selectedTags.map((tag) => {
      const s = sensors.find((x) => x.tag === tag);
      return { name: s?.name ?? tag, color: colorForTag(tag, s?.pond_id), data: data.series[tag] ?? [] };
    });

    drawChart($("#hChart", root), {
      series,
      from: data.from,
      to: data.to,
      unit: first?.unit ?? "",
      decimals: first?.decimals ?? 1,
    });

    $("#hSpan", root).textContent =
      `${fmtDateTime(data.from)} – ${fmtDateTime(data.to)} · ${data.source === "hourly" ? "ค่ารายชั่วโมง" : "ค่าดิบ"}`;

    const legend = clear($("#hLegend", root));
    for (const s of series) legend.append(el("span", {}, el("i", { style: `background:${s.color}` }), s.name));

    const box = clear($("#hStats", root));
    const table = el("table");
    table.append(
      el("thead", {}, el("tr", {},
        el("th", {}, "จุดวัด"), el("th", {}, "หน่วย"),
        el("th", { class: "right" }, "ต่ำสุด"), el("th", { class: "right" }, "สูงสุด"),
        el("th", { class: "right" }, "เฉลี่ย"), el("th", { class: "right" }, "ล่าสุด"),
        el("th", { class: "right" }, "จำนวนจุด")))
    );
    const body = el("tbody");
    for (const tag of selectedTags) {
      const s = sensors.find((x) => x.tag === tag);
      const points = (data.series[tag] ?? []).filter((p) => p.value != null);
      const dp = s?.decimals ?? 1;
      if (!points.length) {
        body.append(el("tr", {}, el("td", {}, s?.name ?? tag), el("td", { colspan: "6" }, "ไม่มีข้อมูล")));
        continue;
      }
      const mins = points.map((p) => (p.min != null ? p.min : p.value));
      const maxs = points.map((p) => (p.max != null ? p.max : p.value));
      const avg = points.reduce((a, p) => a + p.value, 0) / points.length;
      body.append(
        el("tr", {},
          el("td", {}, s?.name ?? tag),
          el("td", {}, s?.unit ?? ""),
          el("td", { class: "right num" }, nf(Math.min(...mins), dp)),
          el("td", { class: "right num" }, nf(Math.max(...maxs), dp)),
          el("td", { class: "right num" }, nf(avg, dp)),
          el("td", { class: "right num" }, nf(points[points.length - 1].value, dp)),
          el("td", { class: "right num" }, points.length))
      );
    }
    table.append(body);
    box.append(table);
  }

  const onResize = () => render();

  (async () => {
    try {
      const meta = await api.get("/api/sensors");
      sensors = meta.sensors;
      selectedTags = sensors.filter((s) => s.metric === "level").map((s) => s.tag);
      retentionRawDays = Number(meta.retentionRawDays ?? 0);
      applyRetentionBound();
      buildChips();
      await load();
      window.addEventListener("resize", onResize);
    } catch (err) {
      toast(err.message, "err");
    }
  })();

  return {
    node: root,
    destroy() {
      window.removeEventListener("resize", onResize);
    },
  };
}
