/**
 * CLIProxyAPI auth 文件名规则（与上游 internal/auth 下各 filename.go 保持一致）
 */
import { sanitizeFilePart, sha256Hex } from "./utils";

/** internal/auth/codex/filename.go: normalizePlanTypeForFilename */
export function normalizePlanTypeForFilename(planType: string): string {
  const parts = planType
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((p) => p.trim().toLowerCase());
  return parts.join("-");
}

/**
 * Codex：codex-<hash8>-<email>-<plan>.json / codex-<email>-<plan>.json / codex-<email>.json
 * hash8 = sha256(chatgpt_account_id)[:8]
 */
export async function codexFileName(email: string, planType: string, accountId: string): Promise<string> {
  const plan = normalizePlanTypeForFilename(planType);
  const hash = accountId.trim() ? await sha256Hex(accountId.trim(), 4) : "";
  const mail = sanitizeFilePart(email);
  if (hash) return plan ? `codex-${hash}-${mail}-${plan}.json` : `codex-${hash}-${mail}.json`;
  return plan ? `codex-${mail}-${plan}.json` : `codex-${mail}.json`;
}

/** Claude：claude-<sha256(org_uuid)[:8]>-<email>.json，没有组织时退化为 claude-<email>.json */
export async function claudeFileName(email: string, organizationUuid: string, accountUuid: string): Promise<string> {
  const identity = (organizationUuid || accountUuid || "").trim();
  const mail = sanitizeFilePart(email);
  if (!identity) return `claude-${mail}.json`;
  const hash = await sha256Hex(identity, 4);
  return `claude-${hash}-${mail}.json`;
}

/** Antigravity：antigravity-<email>.json */
export function antigravityFileName(email: string): string {
  const mail = sanitizeFilePart(email);
  return mail ? `antigravity-${mail}.json` : "antigravity.json";
}

/** Gemini CLI：gemini-<email>-<project>.json（project 缺失时省略） */
export function geminiFileName(email: string, projectId: string): string {
  const mail = sanitizeFilePart(email) || "account";
  const project = sanitizeFilePart(projectId);
  return project ? `gemini-${mail}-${project}.json` : `gemini-${mail}.json`;
}

/** xAI：xai-<sanitized(lower email)>-<sha256("email\0"+lower email)[:8]>.json */
export async function xaiFileName(email: string, subject: string): Promise<string> {
  const cleanEmail = email.trim();
  if (cleanEmail) {
    const normalized = cleanEmail.toLowerCase();
    const segment = xaiSegment(normalized).slice(0, 120) || "account";
    const hash = await sha256Hex(`email\u0000${normalized}`, 4);
    return `xai-${segment}-${hash}.json`;
  }
  const cleanSub = subject.trim();
  if (cleanSub) {
    const segment = xaiSegment(cleanSub).slice(0, 120) || "account";
    const hash = await sha256Hex(`subject\u0000${cleanSub}`, 4);
    return `xai-${segment}-${hash}.json`;
  }
  return `xai-${Date.now()}.json`;
}

function xaiSegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9@._-]/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Kimi：kimi-<millis>.json / kimi-ai-<millis>.json */
export function kimiFileName(provider: "kimi" | "kimi-ai"): string {
  return `${provider}-${Date.now()}.json`;
}

/** Meta：meta-<sanitized(email)>-<sha256(email)[:8]>.json，无 email 时用 sub 的 hash */
export async function metaFileName(email: string, sub: string): Promise<string> {
  const clean = email.trim();
  if (clean) {
    const segment = clean.replace(/[^A-Za-z0-9.\-_]/g, "_").slice(0, 120);
    const hash = await sha256Hex(clean, 4);
    return `meta-${segment}-${hash}.json`;
  }
  if (sub.trim()) return `meta-${await sha256Hex(sub.trim(), 4)}.json`;
  return "meta-oauth.json";
}

/** Devin：devin-<slug(email|name)>-<sha256[:8]>.json */
export async function devinFileName(email: string, name: string, subject: string): Promise<string> {
  const identity = email.trim() || name.trim() || subject.trim();
  const slug = sanitizeFilePart(identity).slice(0, 60) || "account";
  if (!identity) return "devin-oauth.json";
  return `devin-${slug}-${await sha256Hex(identity, 4)}.json`;
}
