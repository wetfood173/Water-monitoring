/**
 * ประวัติการแก้ไขสำหรับ เลิกทำ / ทำซ้ำ (undo / redo) — เก็บเป็นสำเนา JSON ของทั้ง state
 * ใช้ begin() ก่อนแก้ และ end() หลังแก้ ถ้า state ไม่เปลี่ยนจริงจะไม่บันทึกเป็นขั้นใหม่
 * (เช่น คลิกเลือกชิ้นเฉย ๆ โดยไม่ได้ลาก)
 */
export function createHistory({ get, set, onChange, limit = 100 }) {
  let undoStack = [];
  let redoStack = [];
  let pending = null;
  const snap = () => JSON.stringify(get());

  const h = {
    begin() {
      pending ??= snap();
    },
    end() {
      if (pending !== null && pending !== snap()) {
        undoStack.push(pending);
        if (undoStack.length > limit) undoStack.shift();
        redoStack = [];
      }
      pending = null;
      onChange?.();
    },
    /** แก้ state ด้วย fn เป็นหนึ่งขั้นของประวัติ */
    edit(fn) {
      h.begin();
      fn();
      h.end();
    },
    undo() {
      if (!undoStack.length) return false;
      redoStack.push(snap());
      set(JSON.parse(undoStack.pop()));
      onChange?.();
      return true;
    },
    redo() {
      if (!redoStack.length) return false;
      undoStack.push(snap());
      set(JSON.parse(redoStack.pop()));
      onChange?.();
      return true;
    },
    clear() {
      undoStack = [];
      redoStack = [];
      pending = null;
      onChange?.();
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
  };
  return h;
}

/** Ctrl/⌘+Z = เลิกทำ · Ctrl/⌘+Y หรือ Ctrl/⌘+Shift+Z = ทำซ้ำ — คืน true ถ้าเป็นปุ่มลัดเหล่านี้ */
export function handleUndoKeys(e, history) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) history.undo();
  else if (k === "y" || (k === "z" && e.shiftKey)) history.redo();
  else return false;
  e.preventDefault();
  return true;
}
