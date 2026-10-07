/**
 * กราฟเส้นบน canvas — วาดจากชุดข้อมูลจริงที่มี timestamp
 * รับหลายเส้นพร้อมกัน แกน X ซอยตามช่วงเวลาที่ครอบคลุมจริง
 */

const TZ = { timeZone: "Asia/Bangkok" };

function niceTickStep(spanMs) {
  const steps = [
    60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000,
    3600_000, 2 * 3600_000, 4 * 3600_000, 6 * 3600_000, 12 * 3600_000,
    86_400_000, 2 * 86_400_000, 5 * 86_400_000, 10 * 86_400_000,
  ];
  for (const s of steps) if (spanMs / s <= 8) return s;
  return 30 * 86_400_000;
}

export function drawChart(canvas, opts) {
  const { series, from, to, unit = "", decimals = 1, showArea = null } = opts;
  canvas._lastOpts = opts;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight || 240;
  canvas.width = W * ratio;
  canvas.height = H * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const t0 = new Date(from).getTime();
  const t1 = new Date(to).getTime();
  const pad = { l: 46, r: 10, t: 12, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const base = H - pad.b;

  const points = series.flatMap((s) => s.data).filter((p) => p.value != null);
  if (!points.length) {
    ctx.fillStyle = "#7C9BA2";
    ctx.font = '13px "Noto Sans Thai",sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("ยังไม่มีข้อมูลในช่วงเวลานี้", W / 2, H / 2);
    canvas._chartState = null;
    return;
  }

  let mn = Math.min(...points.map((p) => p.value));
  let mx = Math.max(...points.map((p) => p.value));
  const spread = mx - mn || Math.max(1, Math.abs(mx) * 0.1);
  mn -= spread * 0.2;
  mx += spread * 0.2;
  if (unit === "%") {
    mn = Math.max(0, mn);
    mx = Math.min(100, mx);
  } else {
    mn = Math.max(0, mn);
  }

  const X = (ts) => pad.l + ((new Date(ts).getTime() - t0) / (t1 - t0)) * plotW;
  const Y = (v) => pad.t + (1 - (v - mn) / (mx - mn)) * plotH;

  ctx.font = '12px "Barlow Semi Condensed",sans-serif';
  ctx.lineWidth = 1;

  // แกน X
  const spanMs = t1 - t0;
  const step = niceTickStep(spanMs);
  const useDate = step >= 86_400_000;
  const first = Math.ceil(t0 / step) * step;
  const every = W < 440 ? 2 : 1;
  let i = 0;
  for (let t = first; t <= t1; t += step) {
    const x = X(t);
    ctx.strokeStyle = "#224A56";
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, base + 4);
    ctx.stroke();
    if (i % every === 0) {
      const d = new Date(t);
      const label = useDate
        ? d.toLocaleDateString("th-TH", { ...TZ, day: "numeric", month: "numeric" })
        : d.toLocaleTimeString("th-TH", { ...TZ, hour: "2-digit", minute: "2-digit" });
      ctx.fillStyle = "#7C9BA2";
      ctx.textAlign = x - pad.l < 16 ? "left" : x > W - pad.r - 16 ? "right" : "center";
      ctx.fillText(label, x, H - 6);
    }
    i++;
  }

  // แกน Y
  ctx.textAlign = "right";
  for (let k = 0; k <= 4; k++) {
    const y = pad.t + (k * plotH) / 4;
    ctx.strokeStyle = "#1B3B45";
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(W - pad.r, y);
    ctx.stroke();
    ctx.fillStyle = "#7C9BA2";
    ctx.fillText((mx - ((mx - mn) * k) / 4).toFixed(decimals === 0 ? 0 : 1), pad.l - 8, y + 4);
  }

  const single = series.length === 1;
  for (const s of series) {
    const data = s.data.filter((p) => p.value != null);
    if (!data.length) continue;

    if (single && showArea !== false) {
      const grad = ctx.createLinearGradient(0, pad.t, 0, base);
      grad.addColorStop(0, s.color + "55");
      grad.addColorStop(1, s.color + "00");
      ctx.beginPath();
      ctx.moveTo(X(data[0].ts), base);
      for (const p of data) ctx.lineTo(X(p.ts), Y(p.value));
      ctx.lineTo(X(data[data.length - 1].ts), base);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.beginPath();
    data.forEach((p, idx) => (idx ? ctx.lineTo(X(p.ts), Y(p.value)) : ctx.moveTo(X(p.ts), Y(p.value))));
    ctx.strokeStyle = s.color;
    ctx.lineWidth = single ? 1.8 : 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    const last = data[data.length - 1];
    ctx.beginPath();
    ctx.arc(X(last.ts), Y(last.value), single ? 3.5 : 2.6, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
  }

  // เก็บสถานะไว้แปลง pixel <-> เวลา/ค่า ย้อนกลับตอน hover
  canvas._chartState = { series, X, Y, t0, t1, pad, W, H, base, unit, decimals };
  if (canvas._hoverX != null) drawHoverOverlay(ctx, canvas._chartState, canvas._hoverX);
  bindHover(canvas);
}

function nearestPoint(data, ts) {
  let best = null;
  let bestDist = Infinity;
  for (const p of data) {
    if (p.value == null) continue;
    const d = Math.abs(new Date(p.ts).getTime() - ts);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/** วาดเส้นชี้ตำแหน่ง + จุดไฮไลต์ + กล่องค่า ณ เวลาที่ชี้ ทับบนกราฟที่วาดไว้แล้ว */
function drawHoverOverlay(ctx, st, mouseX) {
  const { series, X, Y, t0, t1, pad, W, H, base, unit, decimals } = st;
  const plotW = W - pad.l - pad.r;
  if (mouseX < pad.l || mouseX > W - pad.r) return;
  const ts = t0 + ((mouseX - pad.l) / plotW) * (t1 - t0);

  const hits = [];
  for (const s of series) {
    const data = s.data.filter((p) => p.value != null);
    const p = nearestPoint(data, ts);
    if (p) hits.push({ s, p });
  }
  if (!hits.length) return;

  const anchorX = X(hits[0].p.ts);

  ctx.save();
  ctx.strokeStyle = "#7C9BA2";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(anchorX, pad.t);
  ctx.lineTo(anchorX, base);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const { s, p } of hits) {
    ctx.beginPath();
    ctx.arc(X(p.ts), Y(p.value), 4, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#0B1F24";
    ctx.stroke();
  }

  const timeLabel = new Date(hits[0].p.ts).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const dp = decimals === 0 ? 0 : decimals;
  const lines = [
    timeLabel,
    ...hits.map(({ s, p }) => `${series.length > 1 ? s.name + ": " : ""}${p.value.toFixed(dp)}${unit ? " " + unit : ""}`),
  ];

  ctx.font = '11px "Barlow Semi Condensed",sans-serif';
  const lineH = 14;
  const boxW = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 16;
  const boxH = lines.length * lineH + 10;

  let boxX = anchorX + 10;
  if (boxX + boxW > W - pad.r) boxX = anchorX - boxW - 10;
  boxX = Math.max(pad.l, boxX);
  const boxY = pad.t + 4;

  ctx.fillStyle = "rgba(11,31,36,0.92)";
  ctx.strokeStyle = "#2E5C6E";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, boxH, 5);
  else ctx.rect(boxX, boxY, boxW, boxH);
  ctx.fill();
  ctx.stroke();

  lines.forEach((t, i) => {
    ctx.fillStyle = i === 0 ? "#9FC9CF" : "#EAF6F8";
    ctx.textAlign = "left";
    ctx.fillText(t, boxX + 8, boxY + 14 + i * lineH);
  });
  ctx.restore();
}

function bindHover(canvas) {
  if (canvas._hoverBound) return;
  canvas._hoverBound = true;

  const setFromClient = (clientX) => {
    const rect = canvas.getBoundingClientRect();
    canvas._hoverX = clientX - rect.left;
    if (canvas._lastOpts) drawChart(canvas, canvas._lastOpts);
  };
  const clear = () => {
    canvas._hoverX = null;
    if (canvas._lastOpts) drawChart(canvas, canvas._lastOpts);
  };

  canvas.addEventListener("mousemove", (e) => setFromClient(e.clientX));
  canvas.addEventListener("mouseleave", clear);
  canvas.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches[0]) {
        setFromClient(e.touches[0].clientX);
        e.preventDefault();
      }
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches[0]) {
        setFromClient(e.touches[0].clientX);
        e.preventDefault();
      }
    },
    { passive: false }
  );
  canvas.addEventListener("touchend", clear);
}

export const POND_COLOR = {
  "5": "#3FB4A8", "4": "#5B9BD5", "3": "#C9A227", "2": "#E08A4F",
  "1B": "#A78BD0", "1A": "#D96FA8", "600Q": "#7ED0C2",
};

export const SENSOR_COLOR = {
  "TT-TANK5": "#E08A4F",
  "FT-600Q": "#5B9BD5",
  "PT-AIR": "#8FB9DC",
  "PT-STM": "#C9A227",
};

export const colorForTag = (tag, pondId) =>
  SENSOR_COLOR[tag] || POND_COLOR[pondId] || "#3FB4A8";
