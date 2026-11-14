/**
 * 目标 Provider —— 转成 CLIProxyAPI auth 目录可识别的 JSON。
 *
 * 关键约束（读自 CLIProxyAPI v8 源码）：
 *  - internal/watcher/synthesizer/file.go: provider = strings.ToLower(metadata["type"])，
 *    不认识 → 在 WebUI 里显示成 "other"；
 *  - 文件必须放在 auths 目录（默认 ~/.cli-proxy-api），文件名决定 Auth.ID / 列表项；
 *  - codex 用自己的 filename.go 规则，其它 provider 只要 <provider>-<email>.json 即可；
 *  - codex 支持 {"tokens": {...}, "last_refresh": ...} 嵌套（CLI 原生格式），
 *    claude 支持 {"claudeAiOauth": {...}}（Claude Code 原生格式），
 *    直接丢进去也能解析，只是列表里看不到 email/plan 等友好信息。
 */
import type { AntigravityInfo, ClaudeInfo, CodexInfo, GeminiInfo } from "./parsers";
import {
  antigravityFileName,
  claudeFileName,
  codexFileName,
  geminiFileName,
  normalizePlanTypeForFilename,
} from "./filename";
import type { SourceFormat } from "./detect";
import { nowRfc3339, randomDeviceId } from "./utils";
import { codexExpiryFromJwt } from "./parsers";

export interface ConvertOptions {
  /** 目标 provider */
  provider: TargetId;
  /** 是否写成 CLIProxyAPI 自己的扁平结构（true）还是保留 CLI 原生结构（false） */
  canonical: boolean;
  /** 生成后默认禁用 */
  disabled: boolean;
  /** Claude 设备指纹缺失时自动补一个 */
  fillClaudeDeviceId: boolean;
}

export interface ConvertResult {
  fileName: string;
  content: string;
  meta: Record<string, string>;
  warnings: string[];
}

export type TargetId = "codex" | "claude" | "antigravity" | "gemini-cli";

export const TARGETS: { id: TargetId; label: string; hint: string; tag: string }[] = [
  { id: "codex", label: "Codex", hint: "OpenAI CLI / ChatGPT 账号", tag: "type: codex" },
  { id: "claude", label: "Claude", hint: "Claude Code / Anthropic OAuth", tag: "type: claude" },
  { id: "antigravity", label: "Antigravity", hint: "Google Cloud Code / Gemini 4", tag: "type: antigravity" },
  { id: "gemini-cli", label: "Gemini CLI", hint: "gemini-cli oauth2 token", tag: "type: gemini-cli" },
];

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/* ------------------------------------------------------------------ codex */

export async function buildCodex(info: CodexInfo, opt: ConvertOptions): Promise<ConvertResult> {
  const warnings: string[] = [];
  const email = info.email || "unknown";
  if (!info.email) warnings.push("令牌里没有 email，文件名用 unknown 占位，建议改名或补字段");
  if (!info.accountId) warnings.push("未能从 id_token / access_token 中解析 chatgpt_account_id，文件名缺少 hash 段");

  const planType = normalizePlanTypeForFilename(info.planType) ? info.planType : "free";
  const expiresAt = info.expiresAt || codexExpiryFromJwt(info.idToken) || codexExpiryFromJwt(info.accessToken);
  const lastRefresh = info.lastRefresh || nowRfc3339();

  const credential: Record<string, unknown> = {
    id_token: info.idToken,
    access_token: info.accessToken,
    refresh_token: info.refreshToken,
    account_id: info.accountId,
    last_refresh: lastRefresh,
    email: email,
    expired: expiresAt,
    plan_type: planType,
  };
  if (info.userId) credential["chatgpt_user_id"] = info.userId;

  let body: Record<string, unknown>;
  if (opt.canonical) {
    // CLIProxyAPI 的 codex 凭据是扁平结构（CodexTokenStorage 的 json tag 也是扁平的）
    body = { type: "codex", ...credential };
  } else {
    // Codex CLI 原生 ~/.codex/auth.json
    body = {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: info.idToken,
        access_token: info.accessToken,
        refresh_token: info.refreshToken,
        account_id: info.accountId,
      },
      last_refresh: lastRefresh,
      type: "codex",
    };
  }
  if (opt.disabled) body["disabled"] = true;

  return {
    fileName: await codexFileName(email, planType, info.accountId),
    content: json(body),
    meta: { email, plan: planType, account_id: info.accountId, expired: expiresAt || "-" },
    warnings,
  };
}

/* ----------------------------------------------------------------- claude */

export async function buildClaude(info: ClaudeInfo, opt: ConvertOptions): Promise<ConvertResult> {
  const warnings: string[] = [];
  const email = info.email || "unknown";
  if (!info.email) warnings.push("没有解析到 email：文件名会是 claude-<uuid hash>-unknown.json");
  if (!info.refreshToken) warnings.push("没有 refresh_token，access token 过期后将无法自动续期");
  if (!info.organizationUuid && !info.accountUuid)
    warnings.push("没有 organization/account uuid，文件名哈希段缺失（退化为 claude-<email>.json）");

  let deviceIds = info.deviceIds.filter((id) => /^[0-9a-f]{64}$/.test(id));
  if (deviceIds.length === 0 && opt.fillClaudeDeviceId) {
    deviceIds = [randomDeviceId()];
    warnings.push("已自动生成 1 个 claude_device_ids 设备指纹（CLIProxyAPI 要求 64 位 hex）");
  }

  const expired = info.expiresAt || "";
  const lastRefresh = nowRfc3339();

  let body: Record<string, unknown>;
  if (opt.canonical) {
    body = {
      access_token: info.accessToken,
      refresh_token: info.refreshToken,
      last_refresh: lastRefresh,
      email,
      type: "claude",
      expired,
      // 以下为 CLIProxyAPI 的 ClaudeTokenStorage 扩展字段
      ...(info.accountUuid ? { account_uuid: info.accountUuid } : {}),
      ...(info.organizationUuid ? { organization_uuid: info.organizationUuid } : {}),
      ...(info.organizationName ? { organization_name: info.organizationName } : {}),
      ...(deviceIds.length ? { claude_device_ids: deviceIds } : {}),
    };
  } else {
    // Claude Code 原生 ~/.claude/.credentials.json
    body = {
      claudeAiOauth: {
        accessToken: info.accessToken,
        refreshToken: info.refreshToken,
        expiresAt: info.expiresAt ? Date.parse(info.expiresAt) : 0,
        scopes: info.scopes.length ? info.scopes : ["user:inference", "user:profile"],
        ...(info.subscriptionType ? { subscriptionType: info.subscriptionType } : {}),
        ...(deviceIds.length ? { claude_device_ids: deviceIds } : {}),
      },
      type: "claude",
      email,
    };
  }
  if (opt.disabled) body["disabled"] = true;

  return {
    fileName: await claudeFileName(email, info.organizationUuid, info.accountUuid),
    content: json(body),
    meta: {
      email,
      org: info.organizationUuid || info.accountUuid || "-",
      plan: info.subscriptionType || "-",
      device_ids: String(deviceIds.length),
      expired: expired || "-",
    },
    warnings,
  };
}

/* ------------------------------------------------------------ antigravity */

export async function buildAntigravity(info: AntigravityInfo, opt: ConvertOptions): Promise<ConvertResult> {
  const warnings: string[] = [];
  const email = info.email || "unknown";
  if (!info.email) warnings.push("没有 email：文件名退化为 antigravity.json 或 antigravity-unknown.json");
  if (!info.projectId) warnings.push("没有 project_id：CLIProxyAPI 首次请求时会自行 loadCodeAssist 获取");

  const now = Date.now();
  const expiresIn = info.expiresIn > 0 ? info.expiresIn : 3599;
  const body: Record<string, unknown> = {
    type: "antigravity",
    access_token: info.accessToken,
    refresh_token: info.refreshToken,
    expires_in: expiresIn,
    timestamp: now,
    expired: info.expiresAt || new Date(now + expiresIn * 1000).toISOString(),
    ...(email !== "unknown" ? { email } : {}),
    ...(info.projectId ? { project_id: info.projectId } : {}),
  };
  if (opt.disabled) body["disabled"] = true;

  return {
    fileName: antigravityFileName(info.email),
    content: json(body),
    meta: { email, project_id: info.projectId || "-", expired: String(body["expired"]) },
    warnings,
  };
}

/* ---------------------------------------------------------------- gemini */

export async function buildGemini(info: GeminiInfo, opt: ConvertOptions): Promise<ConvertResult> {
  const warnings: string[] = [];
  const email = info.email || "unknown";
  if (!info.projectId) warnings.push("没有 project_id：CLIProxyAPI 启动时会调用 loadCodeAssist 自动补全");
  if (!info.refreshToken) warnings.push("没有 refresh_token，过期后需要重新登录");

  const body: Record<string, unknown> = {
    type: "gemini-cli",
    access_token: info.accessToken,
    refresh_token: info.refreshToken,
    ...(info.expiresAt ? { expired: info.expiresAt } : {}),
    ...(info.projectId ? { project_id: info.projectId } : {}),
    ...(info.email ? { email: info.email } : {}),
  };
  if (opt.disabled) body["disabled"] = true;

  return {
    fileName: geminiFileName(info.email, info.projectId),
    content: json(body),
    meta: { email, project_id: info.projectId || "-", expired: info.expiresAt || "-" },
    warnings,
  };
}

export function sourceFormatLabel(f: SourceFormat): string {
  switch (f) {
    case "codex":
      return "Codex / OpenAI CLI auth";
    case "claude":
      return "Claude Code 凭据";
    case "antigravity":
      return "Antigravity / Google OAuth";
    case "gemini":
      return "Gemini CLI / Google token";
    case "cliproxy":
      return "CLIProxyAPI auth 文件";
    default:
      return "未知 / other";
  }
}
