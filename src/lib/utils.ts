/** 公用小工具：base64 / JWT / 时间 / 文件名消毒 */

export function b64urlDecode(input: string): string {
  let s = input.replace(/-/g, "+").replace(/_/g, "/").trim();
  while (s.length % 4 !== 0) s += "=";
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

export function b64urlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type JwtPayload = Record<string, unknown>;

/** 宽松解析 JWT（不校验签名），失败返回 null */
export function decodeJwt(token: unknown): JwtPayload | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(parts[1]));
    return parsed && typeof parsed === "object" ? (parsed as JwtPayload) : null;
  } catch {
    return null;
  }
}

/** 深度取值：get(obj, "a.b.c") */
export function dig(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** 按候选路径取第一个非空字符串 */
export function pickString(obj: unknown, paths: string[]): string {
  for (const p of paths) {
    const v = dig(obj, p);
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** RFC3339（带毫秒，本地时区偏移），与 CLIProxyAPI 写盘格式一致 */
export function rfc3339(date: Date): string {
  const pad = (n: number, w = 2) => String(Math.abs(Math.trunc(n))).padStart(w, "0");
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const tz = `${sign}${pad(off / 60)}:${pad(off % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}${tz}`
  );
}

export function nowRfc3339(): string {
  return rfc3339(new Date());
}

export function fromUnixSeconds(sec: number): Date {
  return new Date(sec * 1000);
}

/** 文件名里只留安全字符，邮箱里的 @ 保留（与 CLIProxyAPI 的 antigravity-<email>.json 一致） */
export function sanitizeFilePart(value: string): string {
  return value
    .trim()
    .replace(/[/\\:*?"<>|\s]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
}

export async function sha256Hex(input: string, bytes = 32): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, bytes * 2);
}

/** 生成 Claude 设备指纹（64 位小写 hex，与 claude_device_ids 校验一致） */
export function randomDeviceId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
