import { api, download } from "../api.js";
import { $, el, clear, fmtDateTime, toast, modal, confirmDialog, ROLE_LABEL } from "../util.js";

const ROLES = ["staff", "technician", "engineer", "admin"];

export function employeesPage(ctx) {
  const root = el("div");
  const filters = { q: "", role: "", department: "", status: "", linked: "" };
  let departments = [];

  const addBtn = el("button", { class: "primary", onclick: () => editEmployee(null) }, "เพิ่มพนักงาน");
  const importBtn = el("button", { onclick: importCsv }, "นำเข้า CSV");
  const exportBtn = el("button", {
    onclick: async () => {
      try {
        await download("/api/export/employees.csv");
        toast("ดาวน์โหลดรายชื่อแล้ว");
      } catch (err) {
        toast(err.message, "err");
      }
    },
  }, "ส่งออก CSV");

  root.append(
    el("div", { class: "page-head" },
      el("div", {},
        el("h2", {}, "จัดการพนักงาน"),
        el("p", {}, "ปิดใช้งานแทนการลบ เพื่อรักษาประวัติการรับทราบแจ้งเตือนที่อ้างถึงคนนั้น")),
      el("div", { class: "row", style: "gap:8px" }, exportBtn, importBtn, addBtn))
  );

  const qInput = el("input", { placeholder: "รหัสหรือชื่อ", oninput: debounce((e) => ((filters.q = e.target.value), load()), 300) });
  const roleSel = el("select", { onchange: (e) => ((filters.role = e.target.value), load()) },
    el("option", { value: "" }, "ทุกสิทธิ์"), ...ROLES.map((r) => el("option", { value: r }, ROLE_LABEL[r])));
  const deptSel = el("select", { onchange: (e) => ((filters.department = e.target.value), load()) }, el("option", { value: "" }, "ทุกหน่วยงาน"));
  const statusSel = el("select", { onchange: (e) => ((filters.status = e.target.value), load()) },
    el("option", { value: "" }, "ทุกสถานะ"), el("option", { value: "active" }, "ใช้งานอยู่"), el("option", { value: "inactive" }, "ปิดใช้งาน"));
  const linkedSel = el("select", { onchange: (e) => ((filters.linked = e.target.value), load()) },
    el("option", { value: "" }, "ผูก LINE ทั้งหมด"), el("option", { value: "yes" }, "ผูกแล้ว"), el("option", { value: "no" }, "ยังไม่ผูก"));

  root.append(
    el("div", { class: "card" },
      el("div", { class: "row" },
        el("div", { class: "field" }, el("label", {}, "ค้นหา"), qInput),
        el("div", { class: "field" }, el("label", {}, "สิทธิ์"), roleSel),
        el("div", { class: "field" }, el("label", {}, "หน่วยงาน"), deptSel),
        el("div", { class: "field" }, el("label", {}, "สถานะ"), statusSel),
        el("div", { class: "field" }, el("label", {}, "การผูก LINE"), linkedSel)))
  );

  const countLabel = el("span", { style: "color:var(--mute)" });
  root.append(el("div", { class: "card" }, el("h3", {}, el("span", {}, "รายชื่อพนักงาน"), countLabel),
    el("div", { class: "tablewrap", id: "empTable" }, el("div", { class: "empty" }, "กำลังโหลด…"))));

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  async function editEmployee(emp) {
    const code = el("input", { value: emp?.emp_code ?? "", maxlength: "7", inputmode: "numeric", disabled: Boolean(emp) });
    const name = el("input", { value: emp?.full_name ?? "" });
    const position = el("input", { value: emp?.position ?? "" });
    const dept = el("input", { value: emp?.department ?? "", placeholder: "WF06" });
    const role = el("select", {}, ...ROLES.map((r) => el("option", { value: r, selected: (emp?.role ?? "staff") === r }, ROLE_LABEL[r])));
    const isAdmin = el("input", { type: "checkbox" });
    isAdmin.checked = Boolean(emp?.is_admin);
    const isActive = el("input", { type: "checkbox" });
    isActive.checked = emp ? emp.is_active : true;

    const ok = await modal({
      title: emp ? `แก้ไข ${emp.full_name}` : "เพิ่มพนักงานใหม่",
      confirmLabel: emp ? "บันทึกการแก้ไข" : "เพิ่มพนักงาน",
      body: el("div", {},
        el("div", { class: "row" },
          el("div", { class: "field" }, el("label", {}, "รหัสพนักงาน 7 หลัก"), code),
          el("div", { class: "field" }, el("label", {}, "หน่วยงาน"), dept)),
        el("div", { class: "field", style: "margin-top:12px" }, el("label", {}, "ชื่อ-นามสกุล"), name),
        el("div", { class: "field" }, el("label", {}, "ตำแหน่ง"), position),
        el("div", { class: "field" }, el("label", {}, "ระดับสิทธิ์"), role),
        el("label", { style: "display:flex;gap:8px;align-items:center;margin-top:10px;color:var(--bone)" },
          isAdmin, "อนุญาตให้ใช้รหัส Admin เข้าโหมดจัดการระบบได้"),
        el("label", { style: "display:flex;gap:8px;align-items:center;margin-top:8px;color:var(--bone)" },
          isActive, "เปิดใช้งานบัญชี")),
      onConfirm: async () => {
        const payload = {
          full_name: name.value.trim(),
          position: position.value.trim() || null,
          department: dept.value.trim() || null,
          role: role.value,
          is_admin: isAdmin.checked,
          is_active: isActive.checked,
        };
        if (emp) return api.patch(`/api/employees/${emp.emp_code}`, payload);
        return api.post("/api/employees", { ...payload, emp_code: code.value.trim() });
      },
    });
    if (ok) {
      toast(emp ? "บันทึกการแก้ไขแล้ว" : "เพิ่มพนักงานแล้ว");
      load();
    }
  }

  async function unlink(emp) {
    const ok = await confirmDialog(
      "ยกเลิกการผูก LINE",
      `ยกเลิกการผูกบัญชี LINE ของ ${emp.full_name} (${emp.emp_code}) เพื่อให้ผูกใหม่ได้ · ระบบจะออกจากระบบให้ทันที`,
      "ยกเลิกการผูก"
    );
    if (!ok) return;
    try {
      await api.del(`/api/employees/${emp.emp_code}/line-link`);
      toast("ยกเลิกการผูกแล้ว");
      load();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  async function importCsv() {
    const file = el("input", { type: "file", accept: ".csv,text/csv" });
    const preview = el("div", { style: "font-size:12.5px;color:var(--mute);margin-top:10px" });
    let rows = [];

    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        rows = parseCsv(await f.text());
        preview.textContent = `อ่านได้ ${rows.length} แถว · คอลัมน์ที่ต้องมี: emp_code, full_name, role`;
      } catch (err) {
        rows = [];
        preview.textContent = err.message;
      }
    });

    const result = await modal({
      title: "นำเข้ารายชื่อจาก CSV",
      confirmLabel: "นำเข้า",
      body: el("div", {},
        el("p", { style: "font-size:13.5px;margin-bottom:12px" },
          "ไฟล์ต้องมีหัวคอลัมน์ emp_code, full_name, role และอาจมี position, department, is_admin ระบบจะเพิ่มคนใหม่และอัปเดตคนเดิม ไม่ลบใคร"),
        el("div", { class: "field" }, el("label", {}, "ไฟล์ CSV"), file),
        preview),
      onConfirm: async () => {
        if (!rows.length) throw new Error("ยังไม่ได้เลือกไฟล์ หรือไฟล์ไม่มีข้อมูล");
        return api.post("/api/employees/import", { rows });
      },
    });
    if (result) {
      toast(`เพิ่ม ${result.created} · อัปเดต ${result.updated}${result.errors.length ? ` · ผิดพลาด ${result.errors.length}` : ""}`,
        result.errors.length ? "err" : "ok", 6000);
      load();
    }
  }

  function parseCsv(text) {
    const clean = text.replace(/^﻿/, "").trim();
    const lines = clean.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error("ไฟล์ต้องมีหัวคอลัมน์และข้อมูลอย่างน้อยหนึ่งแถว");
    const split = (line) => {
      const out = [];
      let cur = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted) {
          if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') quoted = false;
          else cur += c;
        } else if (c === '"') quoted = true;
        else if (c === ",") { out.push(cur); cur = ""; }
        else cur += c;
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };
    const headers = split(lines[0]).map((h) => h.toLowerCase());
    for (const need of ["emp_code", "full_name", "role"]) {
      if (!headers.includes(need)) throw new Error(`ไฟล์ขาดคอลัมน์ ${need}`);
    }
    return lines.slice(1).map((line) => {
      const cells = split(line);
      const row = {};
      headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
      if ("is_admin" in row) row.is_admin = /^(1|true|yes|y)$/i.test(row.is_admin);
      return row;
    });
  }

  async function load() {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    try {
      const data = await api.get(`/api/employees?${params}`);
      if (data.departments.length !== departments.length) {
        departments = data.departments;
        const cur = deptSel.value;
        clear(deptSel);
        deptSel.append(el("option", { value: "" }, "ทุกหน่วยงาน"), ...departments.map((d) => el("option", { value: d }, d)));
        deptSel.value = cur;
      }
      countLabel.textContent = `${data.employees.length} คน`;

      const box = clear($("#empTable", root));
      if (!data.employees.length) {
        box.append(el("div", { class: "empty" }, "ไม่พบพนักงานตามเงื่อนไข"));
        return;
      }
      const table = el("table");
      table.append(el("thead", {}, el("tr", {},
        el("th", {}, "รหัส"), el("th", {}, "ชื่อ"), el("th", {}, "ตำแหน่ง"), el("th", {}, "หน่วยงาน"),
        el("th", {}, "สิทธิ์"), el("th", {}, "LINE"), el("th", {}, "สถานะ"), el("th", {}, "เข้าใช้ล่าสุด"), el("th", {}, ""))));
      const body = el("tbody");
      for (const e of data.employees) {
        const lineCell = e.line_user_id
          ? el("div", {},
              el("span", { class: `pill ${e.is_oa_friend ? "ok" : ""}` }, e.is_oa_friend ? "เป็นเพื่อน OA" : "ผูกแล้ว รอเพิ่มเพื่อน"),
              el("div", { style: "color:var(--mute);font-size:11.5px;margin-top:2px" },
                `${e.line_display_name ?? "—"}${e.notify_enabled === false ? " · ปิดแจ้งเตือน" : ""}`))
          : el("span", { class: "pill" }, "ยังไม่ผูก");

        body.append(el("tr", {},
          el("td", { class: "num" }, e.emp_code),
          el("td", { class: "wrap" }, e.full_name, e.is_admin ? el("span", { class: "pill", style: "margin-left:6px;border-color:var(--warn);color:var(--warn)" }, "ใช้รหัส Admin ได้") : null),
          el("td", { class: "wrap" }, e.position ?? "—"),
          el("td", {}, e.department ?? "—"),
          el("td", {}, ROLE_LABEL[e.role] ?? e.role),
          el("td", { class: "wrap" }, lineCell),
          el("td", {}, e.is_active ? el("span", { class: "pill ok" }, "ใช้งานอยู่") : el("span", { class: "pill critical" }, "ปิดใช้งาน")),
          el("td", { class: "num" }, fmtDateTime(e.last_login_at)),
          el("td", {},
            el("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" },
              el("button", { class: "sm", onclick: () => editEmployee(e) }, "แก้ไข"),
              e.line_user_id ? el("button", { class: "sm danger", onclick: () => unlink(e) }, "ยกเลิกผูก") : null))));
      }
      table.append(body);
      box.append(table);
    } catch (err) {
      toast(err.message, "err");
    }
  }

  load();
  return { node: root };
}
