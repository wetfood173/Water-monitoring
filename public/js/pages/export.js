import { api, download } from "../api.js";
import { $, el, clear, fmtDateTime, toast, toLocalInput, nfInt } from "../util.js";

const DATASETS = [
  { key: "readings", label: "ค่าที่วัดได้", note: "ทุกจุดวัดตามช่วงเวลาที่เลือก เลือกเฉพาะบางจุดวัดได้", minRole: "engineer" },
  { key: "alarms", label: "ประวัติแจ้งเตือน", note: "เวลาเกิด เวลาคืนสภาพ ค่าที่ทำให้เกิด ผู้รับทราบ หมายเหตุ", minRole: "engineer" },
  { key: "daily", label: "สรุปรายวัน", note: "ค่าต่ำสุด สูงสุด เฉลี่ย และเวลาที่หลุดช่วงของแต่ละจุดวัด", minRole: "engineer" },
  { key: "employees", label: "รายชื่อพนักงาน", note: "เฉพาะผู้ดูแลระบบ · ไม่ขึ้นกับช่วงเวลา", minRole: "admin" },
];

export function exportPage(ctx) {
  const root = el("div");
  let sensors = [];
  let dataset = "readings";
  let pickedTags = [];

  root.append(
    el("div", { class: "page-head" },
      el("div", {},
        el("h2", {}, "ส่งออกข้อมูล (.csv)"),
        el("p", {}, "ไฟล์เป็น UTF-8 with BOM เปิดใน Excel ภาษาไทยได้ทันที · ช่วงเวลาสูงสุด 90 วันต่อครั้ง")))
  );

  const dsBox = el("div", { class: "chips", style: "margin-bottom:14px" });
  const fromInput = el("input", { type: "datetime-local" });
  const toInput = el("input", { type: "datetime-local" });
  fromInput.value = toLocalInput(new Date(Date.now() - 7 * 86400000));
  toInput.value = toLocalInput(new Date());

  const tagBox = el("div", { class: "chips" });
  const tagWrap = el("div", { style: "margin-top:14px" },
    el("label", {}, "จุดวัด (ไม่เลือก = ทุกจุดวัด)"), tagBox);

  const rangeWrap = el("div", { class: "row" },
    el("div", { class: "field" }, el("label", {}, "ตั้งแต่"), fromInput),
    el("div", { class: "field" }, el("label", {}, "ถึง"), toInput));

  const note = el("p", { style: "font-size:13px;color:var(--mute);margin-bottom:14px" });
  const dlBtn = el("button", { class: "primary" }, "ดาวน์โหลด .csv");

  root.append(
    el("div", { class: "card" },
      el("h3", {}, "ชุดข้อมูล"),
      dsBox, note, rangeWrap, tagWrap,
      el("div", { style: "margin-top:16px" }, dlBtn))
  );

  root.append(el("div", { class: "card" }, el("h3", {}, "ประวัติการส่งออก"), el("div", { class: "tablewrap", id: "exLog" })));

  function pickDataset(key) {
    dataset = key;
    [...dsBox.children].forEach((b) => b.setAttribute("aria-selected", String(b.dataset.k === key)));
    const d = DATASETS.find((x) => x.key === key);
    note.textContent = d.note;
    const needsRange = key !== "employees";
    rangeWrap.hidden = !needsRange;
    tagWrap.hidden = key !== "readings";
  }

  for (const d of DATASETS) {
    if (!ctx.can(d.minRole)) continue;
    dsBox.append(el("button", { dataset: { k: d.key }, "aria-selected": String(d.key === dataset), onclick: () => pickDataset(d.key) }, d.label));
  }

  dlBtn.addEventListener("click", async () => {
    dlBtn.disabled = true;
    try {
      const params = new URLSearchParams();
      if (dataset !== "employees") {
        params.set("from", new Date(fromInput.value).toISOString());
        params.set("to", new Date(toInput.value).toISOString());
      }
      if (dataset === "readings" && pickedTags.length) params.set("tag", pickedTags.join(","));
      await download(`/api/export/${dataset}.csv?${params}`);
      toast("ดาวน์โหลดเรียบร้อย");
      loadLog();
    } catch (err) {
      toast(err.message, "err");
    } finally {
      dlBtn.disabled = false;
    }
  });

  async function loadLog() {
    try {
      const { log } = await api.get("/api/export/log");
      const box = clear($("#exLog", root));
      if (!log.length) {
        box.append(el("div", { class: "empty" }, "ยังไม่มีประวัติการส่งออก"));
        return;
      }
      const table = el("table");
      table.append(el("thead", {}, el("tr", {},
        el("th", {}, "เวลา"), el("th", {}, "ผู้ส่งออก"), el("th", {}, "ชุดข้อมูล"),
        el("th", {}, "ช่วงเวลา"), el("th", { class: "right" }, "จำนวนแถว"))));
      const body = el("tbody");
      for (const x of log) {
        body.append(el("tr", {},
          el("td", { class: "num" }, fmtDateTime(x.created_at)),
          el("td", {}, `${x.full_name} · ${x.emp_code}`),
          el("td", {}, DATASETS.find((d) => d.key === x.dataset)?.label ?? x.dataset),
          el("td", { class: "num" }, x.range_from ? `${fmtDateTime(x.range_from)} – ${fmtDateTime(x.range_to)}` : "—"),
          el("td", { class: "right num" }, nfInt(x.row_count))));
      }
      table.append(body);
      box.append(table);
    } catch (err) {
      toast(err.message, "err");
    }
  }

  (async () => {
    try {
      const meta = await api.get("/api/sensors");
      sensors = meta.sensors;
      for (const s of sensors) {
        tagBox.append(
          el("button", {
            dataset: { k: s.tag },
            "aria-selected": "false",
            onclick: (e) => {
              const i = pickedTags.indexOf(s.tag);
              if (i >= 0) pickedTags.splice(i, 1);
              else pickedTags.push(s.tag);
              e.target.setAttribute("aria-selected", String(pickedTags.includes(s.tag)));
            },
          }, s.tag)
        );
      }
      pickDataset(dataset);
      await loadLog();
    } catch (err) {
      toast(err.message, "err");
    }
  })();

  return { node: root };
}
