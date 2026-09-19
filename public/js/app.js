import { api } from "./api.js";
import { $, el, add, clear, toast, modal, ROLE_LABEL } from "./util.js";

import { dashboardPage } from "./pages/dashboard.js";
import { historyPage } from "./pages/history.js";
import { alarmsPage } from "./pages/alarms.js";
import { exportPage } from "./pages/export.js";
import { setpointsPage } from "./pages/setpoints.js";
import { employeesPage } from "./pages/employees.js";
import { systemPage } from "./pages/system.js";
import { settingsPage } from "./pages/settings.js";

const ROLE_RANK = { staff: 1, technician: 2, engineer: 3, admin: 4 };

const ROUTES = [
  { path: "/", label: "หน้าหลัก", minRole: "staff", page: dashboardPage },
  { path: "/history", label: "ประวัติย้อนหลัง", minRole: "staff", page: historyPage },
  { path: "/alarms", label: "แจ้งเตือน", minRole: "staff", page: alarmsPage },
  { path: "/export", label: "Export", minRole: "engineer", page: exportPage },
  { path: "/setpoints", label: "จุดวัดและ setpoint", minRole: "engineer", page: setpointsPage },
  { path: "/employees", label: "จัดการพนักงาน", minRole: "admin", page: employeesPage },
  { path: "/system", label: "ตั้งค่าระบบ", minRole: "admin", page: systemPage },
  { path: "/settings", label: "ตั้งค่าส่วนตัว", minRole: "staff", page: settingsPage },
];

let me = null;
let current = null;

const ctx = {
  get me() {
    return me;
  },
  can(minRole) {
    return ROLE_RANK[me?.user?.effectiveRole ?? "staff"] >= ROLE_RANK[minRole];
  },
  async refreshMe() {
    me = await api.get("/api/me");
    renderChrome();
    return me;
  },
  navigate(path) {
    location.hash = `#${path}`;
  },
};

/* ---------- โหมดผู้ดูแลระบบ ---------- */

async function promptAdminCode() {
  const input = el("input", { type: "password", autocomplete: "off", placeholder: "รหัส Admin" });
  const body = el(
    "div",
    {},
    el("p", { style: "font-size:13.5px;color:var(--mute);margin-bottom:12px" },
      "กรอกรหัส Admin เพื่อเข้าโหมดจัดการระบบ สิทธิ์จะหมดอายุอัตโนมัติเมื่อไม่มีการใช้งาน 30 นาที"),
    el("div", { class: "field" }, el("label", { for: "adminCode" }, "รหัส Admin"), input)
  );
  input.id = "adminCode";

  const ok = await modal({
    title: "เข้าสู่โหมดจัดการระบบ",
    body,
    confirmLabel: "ยืนยัน",
    onConfirm: async () => {
      await api.post("/auth/admin-code", { code: input.value });
      return true;
    },
  });
  if (ok) {
    await ctx.refreshMe();
    toast("เข้าสู่โหมดผู้ดูแลระบบแล้ว");
  }
}

async function exitAdmin() {
  await api.post("/auth/admin-code/exit");
  await ctx.refreshMe();
  toast("ออกจากโหมดผู้ดูแลระบบแล้ว");
  if (["/employees", "/system"].includes(location.hash.slice(1).split("?")[0])) location.hash = "#/";
}

/* ---------- แถบหัวและเมนู ---------- */

function renderChrome() {
  const nav = clear($("#mainNav"));
  const path = currentPath();
  for (const r of ROUTES) {
    if (!ctx.can(r.minRole)) continue;
    const a = el("a", { href: `#${r.path}`, class: r.path === path ? "on" : "" }, r.label);
    nav.append(a);
  }

  const who = clear($("#whoBox"));
  const u = me.user;
  add(
    who,
    el("span", {}, el("b", {}, u.full_name), ` · ${u.emp_code}`),
    el(
      "span",
      { class: `rolechip ${u.adminActive ? "admin" : ""}` },
      u.adminActive ? "โหมดผู้ดูแลระบบ" : ROLE_LABEL[u.role] ?? u.role
    ),
    u.adminActive
      ? el("button", { class: "sm", onclick: exitAdmin }, "ออกจากโหมด")
      : u.is_admin || u.role === "admin"
        ? el("button", { class: "sm", onclick: promptAdminCode }, "จัดการระบบ")
        : null,
    el(
      "button",
      {
        class: "sm",
        onclick: async () => {
          await api.post("/auth/logout").catch(() => {});
          location.href = "/login";
        },
      },
      "ออกจากระบบ"
    )
  );
}

/* ---------- router ---------- */

const currentPath = () => (location.hash.slice(1) || "/").split("?")[0];

async function renderRoute() {
  const path = currentPath();
  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];

  // สิทธิ์ admin หมดอายุได้ระหว่างเปิดหน้าค้างไว้ จึงต้องถามสถานะจริงก่อนตัดสินใจแสดงผล
  try {
    me = await api.get("/api/me");
    if (!me.authenticated) {
      location.href = me.pendingLink ? "/link" : "/login";
      return;
    }
  } catch {
    return;
  }

  if (!ctx.can(route.minRole)) {
    showAccessDenied(route);
    return;
  }

  current?.destroy?.();
  current = route.page(ctx);
  const view = clear($("#view"));
  view.append(current.node);
  window.scrollTo(0, 0);
  renderChrome();
}

function showAccessDenied(route) {
  current?.destroy?.();
  current = null;
  const needsAdmin = route.minRole === "admin";
  const view = clear($("#view"));
  view.append(
    el(
      "div",
      { class: "card" },
      el("h3", {}, "ไม่มีสิทธิ์เข้าถึง"),
      el(
        "p",
        { style: "font-size:14px" },
        `หน้า "${route.label}" ต้องมีสิทธิ์ระดับ ${ROLE_LABEL[route.minRole]} ขึ้นไป สิทธิ์ปัจจุบันของคุณคือ ${
          ROLE_LABEL[me.user.effectiveRole] ?? me.user.effectiveRole
        }`
      ),
      needsAdmin && (me.user.is_admin || me.user.role === "admin")
        ? el("div", { style: "margin-top:14px" }, el("button", { class: "primary", onclick: promptAdminCode }, "ยืนยันรหัส Admin"))
        : null
    )
  );
  renderChrome();
}

/* ---------- เริ่มทำงาน ---------- */

async function boot() {
  try {
    me = await api.get("/api/me");
  } catch {
    location.href = "/login";
    return;
  }
  if (me.pendingLink) {
    location.href = "/link";
    return;
  }
  if (!me.authenticated) {
    location.href = "/login";
    return;
  }

  // เปิดจากปุ่ม "รับทราบการแจ้งเตือน" ใน LINE (LIFF ส่ง ?alarm=<id> มาเป็น query ไม่ใช่ hash)
  const fromLine = new URLSearchParams(location.search).get("alarm");
  // replaceState แทนการเซ็ต location.hash เพื่อไม่ให้ hashchange ยิงซ้ำแล้ว render สองรอบ
  if (fromLine && /^\d+$/.test(fromLine)) {
    history.replaceState(null, "", `${location.pathname}#/alarms?id=${fromLine}`);
  }

  window.addEventListener("hashchange", renderRoute);
  renderRoute();

  const clock = $("#footClock");
  const tickClock = () => (clock.textContent = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }));
  tickClock();
  setInterval(tickClock, 1000);
}

boot();
