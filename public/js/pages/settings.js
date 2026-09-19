import { api } from "../api.js";
import { el, clear, fmtDateTime, toast, ROLE_LABEL } from "../util.js";

export function settingsPage(ctx) {
  const root = el("div");

  root.append(
    el("div", { class: "page-head" },
      el("div", {},
        el("h2", {}, "ตั้งค่าส่วนตัว"),
        el("p", {}, "ข้อมูลบัญชีของคุณและการรับแจ้งเตือนผ่าน LINE")))
  );

  const profileCard = el("div", { class: "card" }, el("h3", {}, "บัญชีของคุณ"), el("div", { class: "tablewrap" }));
  const notifyCard = el("div", { class: "card" }, el("h3", {}, "การรับแจ้งเตือนผ่าน LINE"));
  root.append(profileCard, notifyCard);

  /** ปุ่มให้ผู้ใช้สั่งตรวจสถานะเพื่อนใหม่ เผื่อ webhook follow ยังส่งมาไม่ถึงเซิร์ฟเวอร์ */
  function checkFriendButton() {
    const btn = el("button", { class: "sm" }, "ตรวจสถานะอีกครั้ง");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "กำลังตรวจ…";
      try {
        const r = await api.post("/api/me/check-friend");
        toast(r.is_oa_friend ? "เป็นเพื่อนกับ LINE OA แล้ว" : "ยังไม่พบว่าเพิ่มเป็นเพื่อน ลองเพิ่มแล้วกดใหม่", r.is_oa_friend ? "ok" : "err");
        render(await ctx.refreshMe());
      } catch (err) {
        toast(err.message, "err");
        btn.disabled = false;
        btn.textContent = "ตรวจสถานะอีกครั้ง";
      }
    });
    return btn;
  }

  function render(me) {
    const u = me.user;
    const table = el("table", {},
      el("tbody", {},
        row("ชื่อ-นามสกุล", u.full_name),
        row("รหัสพนักงาน", u.emp_code),
        row("ตำแหน่ง", u.position ?? "—"),
        row("หน่วยงาน", u.department ?? "—"),
        row("ระดับสิทธิ์", ROLE_LABEL[u.role] ?? u.role),
        row("ใช้รหัส Admin ได้", u.is_admin || u.role === "admin" ? "ใช่" : "ไม่"),
        row("บัญชี LINE ที่ผูก", u.line_linked ? u.display_name ?? "ผูกแล้ว" : "ยังไม่ผูก"),
        row("เซสชันหมดอายุ", me.sessionExpiresAt
          ? `${fmtDateTime(me.sessionExpiresAt)} (เลื่อนออกไปทุกครั้งที่ใช้งาน)`
          : "—"))
    );
    clear(profileCard.lastChild).append(table);

    clear(notifyCard);
    notifyCard.append(el("h3", {}, "การรับแจ้งเตือนผ่าน LINE"));

    if (!me.lineMessaging) {
      notifyCard.append(el("div", { class: "banner" },
        el("div", { class: "grow" }, "ยังไม่ได้ตั้งค่า LINE Messaging API บนเซิร์ฟเวอร์นี้ ระบบจะบันทึกว่าใครควรได้รับแจ้งเตือน แต่ยังไม่ส่งข้อความจริง")));
    }

    const steps = [
      { done: u.line_linked, text: "ผูกบัญชี LINE กับรหัสพนักงาน" },
      { done: u.is_oa_friend, text: "เพิ่ม LINE OA ของระบบเป็นเพื่อน" },
      { done: u.notify_enabled, text: "เปิดรับแจ้งเตือนในหน้านี้" },
    ];
    const list = el("div", { style: "margin-bottom:16px" });
    for (const s of steps) {
      list.append(el("div", { style: "display:flex;gap:10px;align-items:center;padding:5px 0;font-size:13.5px" },
        el("span", { class: s.done ? "dot" : "dot off" }),
        el("span", {}, s.text),
        el("span", { class: `pill ${s.done ? "ok" : "warning"}`, style: "margin-left:auto" }, s.done ? "ครบแล้ว" : "ยังไม่ครบ")));
    }
    notifyCard.append(list);

    if (!u.is_oa_friend && (me.oaQrUrl || me.addFriendUrl)) {
      notifyCard.append(
        el("div", { class: "banner", style: "margin-bottom:14px;align-items:flex-start" },
          // QR ต้องอยู่บนพื้นขาวเสมอ ไฟล์เป็น PNG พื้นโปร่งใส ถ้าวางบนธีมมืดจะสแกนไม่ติด
          me.oaQrUrl
            ? el("img", {
                src: me.oaQrUrl,
                alt: "QR code สำหรับเพิ่ม LINE OA ของระบบเป็นเพื่อน",
                width: 132,
                height: 132,
                style: "background:#fff;padding:8px;border-radius:10px;flex:none",
              })
            : null,
          el("div", { class: "grow" },
            el("div", {}, "สแกน QR ด้วยแอป LINE หรือกดปุ่มเพื่อเพิ่ม LINE OA ของระบบเป็นเพื่อน สถานะจะอัปเดตอัตโนมัติหลังเพิ่มเพื่อนสำเร็จ"),
            el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px" },
              me.addFriendUrl
                ? el("a", { href: me.addFriendUrl, target: "_blank", rel: "noopener" },
                    el("button", { class: "sm primary" }, "เพิ่มเพื่อน LINE OA"))
                : null,
              u.line_linked && me.lineMessaging ? checkFriendButton() : null)))
      );
    }

    const toggle = el("input", { type: "checkbox", disabled: !u.line_linked });
    toggle.checked = Boolean(u.notify_enabled);
    toggle.addEventListener("change", async () => {
      toggle.disabled = true;
      try {
        await api.patch("/api/me/notify", { notify_enabled: toggle.checked });
        toast(toggle.checked ? "เปิดรับแจ้งเตือนแล้ว" : "ปิดรับแจ้งเตือนแล้ว");
        render(await ctx.refreshMe());
      } catch (err) {
        toast(err.message, "err");
        toggle.checked = !toggle.checked;
      } finally {
        toggle.disabled = !u.line_linked;
      }
    });

    notifyCard.append(
      el("label", { style: "display:flex;gap:10px;align-items:center;color:var(--bone);font-size:14px" },
        toggle,
        u.line_linked ? "รับแจ้งเตือนผ่าน LINE" : "รับแจ้งเตือนผ่าน LINE (ต้องผูกบัญชี LINE ก่อน)")
    );
  }

  const row = (k, v) =>
    el("tr", {}, el("td", { style: "color:var(--mute);width:38%" }, k), el("td", { class: "wrap" }, String(v)));

  render(ctx.me);
  ctx.refreshMe().then(render).catch(() => {});

  return { node: root };
}
