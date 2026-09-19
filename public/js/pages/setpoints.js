import { api } from "../api.js";
import { $, el, add, clear, nf, fmtDateTime, toast, modal, confirmDialog } from "../util.js";

const DATA_TYPES = [
  { v: "uint16", t: "uint16 — 1 register ไม่มีเครื่องหมาย" },
  { v: "int16", t: "int16 — 1 register มีเครื่องหมาย" },
  { v: "uint32", t: "uint32 — 2 register" },
  { v: "int32", t: "int32 — 2 register" },
  { v: "float32", t: "float32 — 2 register ทศนิยม" },
];

export function setpointsPage(ctx) {
  const root = el("div");
  let sensors = [];
  let ponds = [];
  let plcs = [];

  root.append(
    el("div", { class: "page-head" },
      el("div", {},
        el("h2", {}, "จุดวัดและ setpoint"),
        el("p", {}, "ค่า LL/HH เวลาหน่วง และ address ที่ใช้อ่านจาก PLC · ทุกการเปลี่ยนแปลงบันทึกลง audit log")))
  );

  root.append(
    el("div", { class: "banner" },
      el("div", { class: "grow" },
        el("b", {}, "ค่าตั้งต้นยังเป็นค่าสมมติ"),
        el("div", { style: "margin-top:4px;color:var(--mute)" },
          "ค่า LL/HH และระดับวิกฤตทั้งหมดคัดลอกมาจาก prototype ต้องแทนด้วยค่าจริงจากหน้างานก่อนใช้งานจริง")))
  );

  const plcCard = el("div", { class: "card" },
    el("h3", {},
      el("span", {}, "PLC"),
      el("button", { class: "sm", style: "float:right", onclick: () => editPlc(null) }, "+ เพิ่ม PLC")),
    el("p", { style: "font-size:12.5px;color:var(--mute);margin:-6px 0 10px" },
      "จุดวัดแต่ละอันเลือกได้ว่าจะอ่านผ่าน PLC ตัวไหน — เพิ่มได้เรื่อย ๆ เมื่อหน้างานมี PLC เพิ่ม"),
    el("div", { class: "tablewrap", id: "plcTable" }));
  root.append(plcCard);

  const modbusCard = el("div", { class: "card" }, el("h3", {}, "การเชื่อมต่อ PLC (Modbus TCP)"), el("div", { id: "mbStatus" }));
  root.append(modbusCard);

  root.append(
    el("div", { class: "card" },
      el("h3", {}, "ความจุบ่อ (ปริมาตรน้ำเต็มถัง)"),
      el("p", { style: "font-size:12.5px;color:var(--mute);margin:-6px 0 10px" },
        "ใช้คำนวณปริมาตรน้ำจริง = ความจุ × ระดับน้ำ (%) — แก้ให้ตรงกับขนาดถัง/บ่อจริงแต่ละใบก่อนดูค่าปริมาตรบนแดชบอร์ด"),
      el("div", { class: "tablewrap", id: "pondTable" }))
  );

  root.append(el("div", { class: "card" }, el("h3", {}, "จุดวัดทั้งหมด"), el("div", { class: "tablewrap", id: "spTable" })));

  /* ---------- แก้ความจุบ่อ ---------- */

  async function editCapacity(p) {
    const capacity = el("input", { type: "number", step: "any", min: "0.01", value: p.capacity_m3 ?? "" });

    const ok = await modal({
      title: `ความจุบ่อ · ${p.name}`,
      confirmLabel: "บันทึก",
      body: el("div", {},
        el("p", { style: "font-size:13px;color:var(--mute);margin-bottom:14px" },
          `รหัสบ่อ ${p.pond_id} — ค่านี้คูณกับ % ระดับน้ำเพื่อแสดงปริมาตรจริง`),
        el("div", { class: "field" }, el("label", {}, "ความจุเต็มถัง"), capacity)),
      onConfirm: async () => {
        const n = Number(capacity.value);
        if (!Number.isFinite(n) || n <= 0) throw new Error("ความจุต้องเป็นตัวเลขมากกว่า 0");
        return api.put(`/api/ponds/${encodeURIComponent(p.pond_id)}/capacity`, { capacity_m3: n });
      },
    });
    if (ok) {
      toast(`บันทึกความจุของ ${p.name} แล้ว`);
      load();
    }
  }

  /* ---------- เพิ่ม/แก้ PLC ---------- */

  async function editPlc(p) {
    const isNew = !p;
    const name = el("input", { type: "text", value: p?.name ?? "", placeholder: "เช่น PLC-1 อาคาร A" });
    const host = el("input", { type: "text", value: p?.host ?? "", placeholder: "เช่น 192.168.0.3" });
    const port = el("input", { type: "number", step: "1", min: "1", max: "65535", value: p?.port ?? 502 });
    const pollSec = el("input", { type: "number", step: "1", min: "1", max: "3600", value: p?.poll_sec ?? 1 });
    const active = el("input", { type: "checkbox" });
    active.checked = p ? Boolean(p.is_active) : true;

    const ok = await modal({
      title: isNew ? "เพิ่ม PLC" : `แก้ไข PLC · ${p.name}`,
      confirmLabel: "บันทึก",
      body: el("div", {},
        el("div", { class: "field" }, el("label", {}, "ชื่อ PLC"), name),
        el("div", { class: "row", style: "margin-top:12px" },
          el("div", { class: "field" }, el("label", {}, "IP / hostname"), host),
          el("div", { class: "field" }, el("label", {}, "Port"), port)),
        el("div", { class: "field", style: "margin-top:12px" },
          el("label", {}, "ดึงค่าทุกกี่วินาที"), pollSec),
        !isNew
          ? el("label", { style: "display:flex;gap:8px;align-items:center;margin-top:12px;color:var(--bone);font-size:13px" },
              active, "เปิดใช้งาน (ปิดไว้ = หยุดอ่านค่าจากจุดวัดทั้งหมดที่ผูกกับ PLC นี้ชั่วคราว)")
          : null),
      onConfirm: async () => {
        const body = { name: name.value.trim(), host: host.value.trim(), port: Number(port.value), poll_sec: Number(pollSec.value) };
        if (!isNew) body.is_active = active.checked;
        return isNew ? api.post("/api/plcs", body) : api.put(`/api/plcs/${p.id}`, body);
      },
    });
    if (ok) {
      toast(isNew ? `เพิ่ม PLC "${ok.plc.name}" แล้ว` : `บันทึก PLC "${ok.plc.name}" แล้ว`);
      load();
    }
  }

  async function deletePlc(p) {
    const ok = await confirmDialog(
      "ลบ PLC",
      `ลบ "${p.name}" (${p.host}:${p.port}) ออกจากระบบ — ลบได้เฉพาะตอนไม่มีจุดวัดผูกอยู่เท่านั้น`,
      "ลบ"
    );
    if (!ok) return;
    try {
      await api.del(`/api/plcs/${p.id}`);
      toast(`ลบ PLC "${p.name}" แล้ว`);
      load();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  /* ---------- แก้ setpoint ---------- */

  async function editSetpoints(s) {
    const mk = (label, value, attrs = {}) => {
      const input = el("input", { type: "number", step: "any", value: value ?? "", ...attrs });
      return { input, field: el("div", { class: "field" }, el("label", {}, label), input) };
    };
    const ll = mk(`LL (${s.unit})`, s.ll);
    const hh = mk(`HH (${s.unit})`, s.hh);
    const llc = mk(`LL วิกฤต (${s.unit}) — เว้นว่างได้`, s.ll_critical);
    const hhc = mk(`HH วิกฤต (${s.unit}) — เว้นว่างได้`, s.hh_critical);
    const deb = mk("หน่วงเวลา (วินาที)", s.debounce_sec, { step: "1", min: "0", max: "3600" });

    const ok = await modal({
      title: `setpoint · ${s.name}`,
      confirmLabel: "บันทึก",
      body: el("div", {},
        el("p", { style: "font-size:13px;color:var(--mute);margin-bottom:14px" },
          `${s.tag} · พิสัยเครื่องมือวัด ${nf(s.range_min, 0)} – ${nf(s.range_max, 0)} ${s.unit}`),
        el("div", { class: "row" }, ll.field, hh.field),
        el("div", { class: "row", style: "margin-top:12px" }, llc.field, hhc.field),
        el("div", { style: "margin-top:12px" }, deb.field),
        el("p", { style: "font-size:12px;color:var(--mute);margin-top:10px" },
          "ค่าต้องหลุดช่วงต่อเนื่องครบเวลาหน่วงจึงจะสร้างการแจ้งเตือน ป้องกันข้อความถล่มจากค่าที่แกว่งชั่วขณะ")),
      onConfirm: async () =>
        api.put(`/api/sensors/${encodeURIComponent(s.tag)}/setpoints`, {
          ll: ll.input.value === "" ? null : Number(ll.input.value),
          hh: hh.input.value === "" ? null : Number(hh.input.value),
          ll_critical: llc.input.value === "" ? null : Number(llc.input.value),
          hh_critical: hhc.input.value === "" ? null : Number(hhc.input.value),
          debounce_sec: Number(deb.input.value),
        }),
    });
    if (ok) {
      toast(`บันทึก setpoint ของ ${s.tag} แล้ว`);
      load();
    }
  }

  /* ---------- แก้การตั้งค่า Modbus ---------- */

  async function editModbus(s) {
    const sourceSelect = el("select", {},
      el("option", { value: "modbus", selected: (s.data_source ?? "modbus") === "modbus" }, "PLC (Modbus TCP)"),
      el("option", { value: "mongodb", selected: s.data_source === "mongodb" }, "MongoDB Atlas (real-time)"));
    const plcSelect = el("select", {},
      el("option", { value: "", selected: s.plc_id == null }, "— ยังไม่เลือก PLC —"),
      ...plcs.map((p) => el("option", { value: p.id, selected: s.plc_id === p.id }, `${p.name} (${p.host}:${p.port})`)));
    const address = el("input", { type: "number", step: "1", min: "0", max: "65535", value: s.modbus_address ?? "", placeholder: "เว้นว่าง = ไม่อ่านจุดนี้" });
    const unitId = el("input", { type: "number", step: "1", min: "0", max: "255", value: s.modbus_unit_id ?? 1 });
    const fc = el("select", {},
      el("option", { value: "3", selected: (s.modbus_fc ?? 3) === 3 }, "FC 3: Read Holding Registers"),
      el("option", { value: "4", selected: s.modbus_fc === 4 }, "FC 4: Read Input Registers"));
    const dataType = el("select", {},
      ...DATA_TYPES.map((d) => el("option", { value: d.v, selected: (s.modbus_data_type ?? "uint16") === d.v }, d.t)));
    const scale = el("input", { type: "number", step: "any", value: s.modbus_scale ?? 1 });
    const offset = el("input", { type: "number", step: "any", value: s.modbus_offset ?? 0 });
    const wordSwap = el("input", { type: "checkbox" });
    wordSwap.checked = Boolean(s.modbus_word_swap);

    const preview = el("div", { style: "font-size:12.5px;color:var(--mute);margin-top:10px;min-height:20px" });
    const testBtn = el("button", { class: "sm", type: "button" }, "ทดสอบอ่านค่า");
    testBtn.addEventListener("click", async () => {
      if (plcSelect.value === "") return toast("เลือก PLC ก่อน", "err");
      if (address.value === "") return toast("กรอก address ก่อน", "err");
      testBtn.disabled = true;
      preview.textContent = "กำลังอ่าน…";
      try {
        const r = await api.post("/api/modbus/test-read", {
          plc_id: Number(plcSelect.value),
          address: Number(address.value),
          unit_id: Number(unitId.value),
          fc: Number(fc.value),
          data_type: dataType.value,
          word_swap: wordSwap.checked,
          scale: Number(scale.value),
          offset: Number(offset.value),
        });
        preview.textContent =
          `ค่าดิบ ${r.raw} → หลังคูณ scale ได้ ${nf(r.scaled, s.decimals ?? 1)} ${s.unit}` +
          ` · register ที่อ่านได้ [${r.registers.join(", ")}]`;
      } catch (err) {
        preview.textContent = `อ่านไม่สำเร็จ: ${err.message}`;
      } finally {
        testBtn.disabled = false;
      }
    });

    const modbusFields = el("div", {},
      el("div", { class: "field" }, el("label", {}, "PLC"), plcSelect),
      el("div", { class: "row", style: "margin-top:12px" },
        el("div", { class: "field" }, el("label", {}, "Address"), address),
        el("div", { class: "field" }, el("label", {}, "Unit-Id"), unitId)),
      el("div", { class: "field", style: "margin-top:12px" }, el("label", {}, "Function code"), fc),
      el("div", { class: "field" }, el("label", {}, "ชนิดข้อมูล"), dataType),
      el("label", { style: "display:flex;gap:8px;align-items:center;margin-top:10px;color:var(--bone);font-size:13px" },
        wordSwap, "สลับลำดับ word (ใช้กับค่า 32 บิตที่ PLC เรียงกลับด้าน)"),
      el("div", { style: "margin-top:14px;border-top:1px solid var(--line);padding-top:12px" },
        testBtn, preview));

    // scale/offset ใช้แปลงค่าดิบเป็นค่าจริงเหมือนกันทั้งสองแหล่งข้อมูล (โปรดดูข้อความอธิบายด้านบน modal)
    // จึงแยกออกมาจาก modbusFields เพื่อให้แก้ได้แม้สลับไปใช้ MongoDB Atlas แล้ว
    const scaleFields = el("div", { class: "row", style: "margin-top:12px" },
      el("div", { class: "field" }, el("label", {}, "Scale (คูณ)"), scale),
      el("div", { class: "field" }, el("label", {}, "Offset (บวก)"), offset));

    const mongoDb = el("input", { type: "text", value: s.mongo_db ?? "", placeholder: "เช่น Tank600Q" });
    const mongoColl = el("input", { type: "text", value: s.mongo_collection ?? "", placeholder: "เช่น Level Water" });
    const mongoPollSec = el("input", { type: "number", step: "1", min: "1", max: "3600", value: s.mongo_poll_sec ?? 5 });
    const mongoPreview = el("div", { style: "font-size:12.5px;color:var(--mute);margin-top:10px;min-height:20px" });
    const mongoTestBtn = el("button", { class: "sm", type: "button" }, "ทดสอบการเชื่อมต่อ");
    mongoTestBtn.addEventListener("click", async () => {
      if (!mongoDb.value.trim() || !mongoColl.value.trim()) return toast("กรอก database และ collection ก่อน", "err");
      mongoTestBtn.disabled = true;
      mongoPreview.textContent = "กำลังเชื่อมต่อ…";
      try {
        const r = await api.post("/api/mongo/test-read", { db: mongoDb.value.trim(), collection: mongoColl.value.trim() });
        if (r.sample) {
          const scaled = r.sample.value * Number(scale.value) + Number(offset.value);
          mongoPreview.textContent =
            `เชื่อมต่อสำเร็จ · มี ${r.count} document · ค่าดิบ ${r.sample.value} → หลังคูณ scale ได้ ${nf(scaled, s.decimals ?? 1)} ${s.unit}`;
        } else {
          mongoPreview.textContent = `เชื่อมต่อสำเร็จ แต่ collection นี้ยังไม่มี document เลย (พบ ${r.count} รายการ)`;
        }
      } catch (err) {
        mongoPreview.textContent = `เชื่อมต่อไม่สำเร็จ: ${err.message}`;
      } finally {
        mongoTestBtn.disabled = false;
      }
    });

    const mongoFields = el("div", {},
      el("div", { class: "row" },
        el("div", { class: "field" }, el("label", {}, "Database"), mongoDb),
        el("div", { class: "field" }, el("label", {}, "Collection"), mongoColl)),
      el("div", { class: "field", style: "margin-top:12px;max-width:160px" },
        el("label", {}, "ดึงข้อมูลทุก (วินาที)"), mongoPollSec),
      el("p", { style: "font-size:12.5px;color:var(--mute);margin-top:8px" },
        "จุดวัดนี้จะรับค่าล่าสุดจาก MongoDB Atlas ตามความถี่ที่ตั้งไว้ด้านบน แทน PLC — ไม่ต้องตั้ง address ใด ๆ"),
      el("div", { style: "margin-top:14px;border-top:1px solid var(--line);padding-top:12px" },
        mongoTestBtn, mongoPreview));

    const syncSourceView = () => {
      const isMongo = sourceSelect.value === "mongodb";
      modbusFields.hidden = isMongo;
      mongoFields.hidden = !isMongo;
    };
    sourceSelect.addEventListener("change", syncSourceView);
    syncSourceView();

    const result = await modal({
      title: `แหล่งข้อมูล · ${s.name}`,
      confirmLabel: "บันทึก",
      body: el("div", {},
        el("p", { style: "font-size:13px;color:var(--mute);margin-bottom:14px" },
          `${s.tag} · ค่าจริง = ค่าดิบจาก register × scale + offset · หน่วย ${s.unit}`),
        el("div", { class: "field" }, el("label", {}, "แหล่งข้อมูล"), sourceSelect),
        el("div", { style: "margin-top:12px" }, modbusFields, mongoFields, scaleFields)),
      onConfirm: async () => {
        const body = {
          data_source: sourceSelect.value,
          modbus_scale: Number(scale.value),
          modbus_offset: Number(offset.value),
        };
        if (sourceSelect.value === "modbus") {
          Object.assign(body, {
            plc_id: plcSelect.value === "" ? null : Number(plcSelect.value),
            modbus_address: address.value === "" ? null : Number(address.value),
            modbus_unit_id: Number(unitId.value),
            modbus_fc: Number(fc.value),
            modbus_data_type: dataType.value,
            modbus_word_swap: wordSwap.checked,
          });
        } else {
          Object.assign(body, {
            mongo_db: mongoDb.value.trim() || null,
            mongo_collection: mongoColl.value.trim() || null,
            mongo_poll_sec: Number(mongoPollSec.value),
          });
        }
        return api.put(`/api/sensors/${encodeURIComponent(s.tag)}/modbus`, body);
      },
    });
    if (result) {
      toast(result.warning ?? `บันทึกแหล่งข้อมูลของ ${s.tag} แล้ว`, result.warning ? "err" : "ok");
      load();
    }
  }

  /* ---------- แสดงผล ---------- */

  function renderModbusStatus(status, blocks) {
    const box = clear($("#mbStatus", root));

    if (!status.enabled) {
      box.append(
        el("div", { style: "font-size:13.5px" },
          el("span", { class: "dot off" }),
          "ยังไม่ได้เปิดการอ่านผ่าน Modbus"),
        el("p", { style: "font-size:12.5px;color:var(--mute);margin-top:8px" },
          "ตั้ง MODBUS_ENABLED=true ในไฟล์ .env แล้วรีสตาร์ตเซิร์ฟเวอร์ " +
          "ส่วน IP ของแต่ละ PLC และ address ของแต่ละจุดวัดตั้งจากตารางด้านบน/ล่างได้เลยโดยไม่ต้องรีสตาร์ต")
      );
      return;
    }

    const line = (label, ok, text) =>
      el("div", { style: "display:flex;gap:10px;align-items:center;padding:5px 0;font-size:13.5px" },
        el("span", { class: ok ? "dot" : "dot off" }),
        el("span", { style: "color:var(--mute);min-width:150px" }, label),
        el("span", {}, text));

    if (!status.plcs?.length) {
      box.append(el("p", { style: "font-size:13px;color:var(--mute)" }, "ยังไม่มี PLC — เพิ่มจากตารางด้านบน"));
      return;
    }

    for (const p of status.plcs) {
      add(box,
        line(p.name, p.connected, `${p.host}:${p.port} · ${p.connected ? "เชื่อมต่ออยู่" : "ยังต่อไม่ได้"} · ดึงทุก ${p.pollSec ?? 1} วิ`),
        line("อ่านค่าล่าสุด", Boolean(p.lastOkAt), p.lastOkAt ? fmtDateTime(p.lastOkAt) : "ยังไม่เคยอ่านสำเร็จ"),
        line("จุดวัดที่ตั้ง address แล้ว", p.mappedTags > 0, `${p.mappedTags} จุด · รวมเป็น ${p.blocks} คำสั่งอ่าน`),
        p.lastError ? line("ข้อผิดพลาดล่าสุด", false, p.lastError) : null
      );
    }

    if (blocks?.length) {
      const table = el("table", { style: "margin-top:12px" });
      table.append(el("thead", {}, el("tr", {},
        el("th", {}, "PLC"), el("th", {}, "Unit-Id"), el("th", {}, "FC"), el("th", {}, "Address"),
        el("th", { class: "right" }, "จำนวน register"), el("th", {}, "จุดวัดในคำสั่งเดียวกัน"))));
      const body = el("tbody");
      for (const b of blocks) {
        body.append(el("tr", {},
          el("td", {}, b.plcName),
          el("td", { class: "num" }, b.unitId),
          el("td", { class: "num" }, `FC ${b.fc}`),
          el("td", { class: "num" }, b.address),
          el("td", { class: "right num" }, b.quantity),
          el("td", { class: "wrap" }, b.tags.join(", "))));
      }
      table.append(body);
      box.append(el("div", { class: "tablewrap" }, table));
    }
  }

  function renderPlcs() {
    const box = clear($("#plcTable", root));
    if (!plcs.length) {
      box.append(el("p", { style: "font-size:13px;color:var(--mute)" }, "ยังไม่มี PLC — กด \"+ เพิ่ม PLC\" ด้านบน"));
      return;
    }
    const table = el("table");
    table.append(el("thead", {}, el("tr", {},
      el("th", {}, "ชื่อ"), el("th", {}, "IP : Port"), el("th", {}, "ดึงค่าทุก"), el("th", {}, "สถานะ"),
      el("th", { class: "right" }, "จุดวัดที่ผูกอยู่"), el("th", {}, ""))));
    const body = el("tbody");
    for (const p of plcs) {
      const count = sensors.filter((s) => s.plc_id === p.id).length;
      body.append(el("tr", {},
        el("td", {}, p.name),
        el("td", { class: "mono" }, `${p.host}:${p.port}`),
        el("td", {}, `${p.poll_sec ?? 1} วิ`),
        el("td", {}, p.is_active
          ? el("span", { class: "pill ok" }, "เปิดใช้งาน")
          : el("span", { class: "pill warning" }, "ปิดไว้")),
        el("td", { class: "right num" }, count),
        el("td", {},
          el("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" },
            el("button", { class: "sm", onclick: () => editPlc(p) }, "แก้ไข"),
            el("button", { class: "sm danger", onclick: () => deletePlc(p) }, "ลบ")))));
    }
    table.append(body);
    box.append(table);
  }

  function renderPonds() {
    const box = clear($("#pondTable", root));
    if (!ponds.length) {
      box.append(el("p", { style: "font-size:13px;color:var(--mute)" }, "ไม่พบข้อมูลบ่อ"));
      return;
    }
    const table = el("table");
    table.append(el("thead", {}, el("tr", {},
      el("th", {}, "รหัสบ่อ"), el("th", {}, "ชื่อ"),
      el("th", { class: "right" }, "ความจุ (หน่วยเดียวกับที่แสดงบนแดชบอร์ด)"), el("th", {}, ""))));
    const body = el("tbody");
    for (const p of ponds) {
      body.append(el("tr", {},
        el("td", { class: "mono" }, p.pond_id),
        el("td", {}, p.name),
        el("td", { class: "right num" }, nf(p.capacity_m3, 0)),
        el("td", {}, el("button", { class: "sm", onclick: () => editCapacity(p) }, "แก้ไข"))));
    }
    table.append(body);
    box.append(table);
  }

  function renderSensors() {
    const box = clear($("#spTable", root));
    const table = el("table");
    table.append(el("thead", {}, el("tr", {},
      el("th", {}, "จุดวัด"), el("th", {}, "บ่อ"), el("th", {}, "หน่วย"),
      el("th", { class: "right" }, "พิสัย"),
      el("th", { class: "right" }, "LL วิกฤต"), el("th", { class: "right" }, "LL"),
      el("th", { class: "right" }, "HH"), el("th", { class: "right" }, "HH วิกฤต"),
      el("th", { class: "right" }, "หน่วง"),
      el("th", {}, "แหล่งข้อมูล"), el("th", {}, ""))));
    const body = el("tbody");

    for (const s of sensors) {
      const dp = s.decimals ?? 1;
      const mb = s.data_source === "mongodb"
        ? (s.mongo_db && s.mongo_collection
            ? el("div", {},
                el("span", { class: "pill ok" }, "MongoDB Atlas"),
                el("div", { style: "color:var(--mute);font-size:11.5px;margin-top:2px" },
                  `${s.mongo_db}.${s.mongo_collection} · ดึงทุก ${s.mongo_poll_sec ?? 5} วิ`))
            : el("span", { class: "pill warning" }, "ยังไม่ตั้ง DB/Collection"))
        : s.plc_id == null || s.modbus_address == null
        ? el("span", { class: "pill warning" }, s.plc_id == null ? "ยังไม่เลือก PLC" : "ยังไม่ตั้ง address")
        : el("div", {},
            el("div", { style: "font-size:11.5px;color:var(--mute)" }, `${s.plc_name} (${s.plc_host}:${s.plc_port})`),
            el("span", { class: "num" }, `${s.modbus_address}`),
            el("div", { style: "color:var(--mute);font-size:11.5px;margin-top:2px" },
              `unit ${s.modbus_unit_id} · FC${s.modbus_fc} · ${s.modbus_data_type}` +
              (Number(s.modbus_scale) !== 1 || Number(s.modbus_offset) !== 0
                ? ` · ×${s.modbus_scale}${Number(s.modbus_offset) ? ` ${s.modbus_offset > 0 ? "+" : ""}${s.modbus_offset}` : ""}`
                : "")));

      body.append(el("tr", {},
        el("td", {}, el("b", {}, s.tag), el("div", { style: "color:var(--mute);font-size:11.5px" }, s.name)),
        el("td", {}, s.pond_id ?? "—"),
        el("td", {}, s.unit),
        el("td", { class: "right num" }, `${nf(s.range_min, 0)}–${nf(s.range_max, 0)}`),
        el("td", { class: "right num" }, s.ll_critical == null ? "—" : nf(s.ll_critical, dp)),
        el("td", { class: "right num", style: "color:var(--warn)" }, nf(s.ll, dp)),
        el("td", { class: "right num", style: "color:var(--warn)" }, nf(s.hh, dp)),
        el("td", { class: "right num" }, s.hh_critical == null ? "—" : nf(s.hh_critical, dp)),
        el("td", { class: "right num" }, `${s.debounce_sec} วิ`),
        el("td", { class: "wrap" }, mb),
        el("td", {},
          el("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" },
            el("button", { class: "sm", onclick: () => editSetpoints(s) }, "setpoint"),
            el("button", { class: "sm", onclick: () => editModbus(s) }, "แหล่งข้อมูล")))));
    }
    table.append(body);
    box.append(table);
  }

  async function load() {
    try {
      const [meta, mb] = await Promise.all([
        api.get("/api/sensors"),
        api.get("/api/modbus/status").catch(() => null),
      ]);
      sensors = meta.sensors;
      ponds = meta.ponds ?? [];
      plcs = meta.plcs ?? [];
      renderPlcs();
      renderSensors();
      renderPonds();
      if (mb) renderModbusStatus(mb.status, mb.blocks);
    } catch (err) {
      toast(err.message, "err");
    }
  }

  load();
  const timer = setInterval(() => {
    if (!document.hidden && !document.querySelector(".modal-bg")) {
      api.get("/api/modbus/status")
        .then((mb) => renderModbusStatus(mb.status, mb.blocks))
        .catch(() => {});
    }
  }, 5000);

  return { node: root, destroy: () => clearInterval(timer) };
}
