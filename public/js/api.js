export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    // session หมดอายุหรือถูกเพิกถอน — กลับไปหน้าเข้าสู่ระบบ
    if (!location.pathname.startsWith("/login")) location.href = "/login?error=expired";
    throw new ApiError(401, "ต้องเข้าสู่ระบบก่อน");
  }

  const type = res.headers.get("content-type") || "";
  if (!res.ok) {
    let message = `คำขอล้มเหลว (${res.status})`;
    let code;
    if (type.includes("application/json")) {
      const data = await res.json().catch(() => null);
      if (data?.error) message = data.error;
      code = data?.code;
    }
    throw new ApiError(res.status, message, code);
  }
  if (res.status === 204) return null;
  return type.includes("application/json") ? res.json() : res.text();
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b ?? {}),
  patch: (p, b) => request("PATCH", p, b ?? {}),
  put: (p, b) => request("PUT", p, b ?? {}),
  del: (p) => request("DELETE", p),
};

/** ดาวน์โหลดไฟล์ โดยให้เบราว์เซอร์จัดการชื่อไฟล์จาก Content-Disposition */
export async function download(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error || `ดาวน์โหลดไม่สำเร็จ (${res.status})`);
  }
  const disposition = res.headers.get("content-disposition") || "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match ? match[1] : "export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
