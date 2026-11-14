/**
 * CLIProxyAPI auth 文件名规则（与上游 internal/auth 下的 filename.go 保持一致）
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
  const hash = accountId.trim() ? (await sha256Hex(accountId.trim(), 4)) : "";
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
