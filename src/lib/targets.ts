/**
 * 目标 Provider —— 转成 CLIProxyAPI auth 目录可识别的 JSON。
 *
 * 关键约束（读自 CLIProxyAPI v8 源码）：
 *  - internal/watcher/synthesizer/file.go: provider = strings.ToLower(metadata["type"])，
 *    不认识 → 在 WebUI 里显示成 "other"；
 *  - 文件必须放在 auths 目录（默认 ~/.cli-proxy-api），文件名决定 Auth.ID / 列表项；
 *  - codex / claude 有自己的 filename.go 规则，其它 provider 只要 <provider>-<email>.json 即可。
 */
import type {
  AntigravityInfo,
  ClaudeInfo,
  CodexInfo,
  GeminiInfo,
  GenericOAuthInfo,
} from "./parsers";
import { bakeAntigravityAccessToken } from "./parsers";
import {
  antigravityFileName,
  claudeFileName,
  codexFileName,
  devinFileName,
  geminiFileName,
  kimiFileName,
  metaFileName,
  normalizePlanTypeForFilename,
  xaiFileName,
} from "./filename";
import type { SourceFormat } from "./detect";
import { nowRfc3339, randomDeviceId } from "./utils";
import { codexExpiryFromJwt } from "./parsers";
import type { LocalText } from "./convert";

export interface ConvertOptions {
  /** 目标 provider（单文件转换时用） */
  provider: TargetId;
  /** 是否写成 CLIProxyAPI 自己的扁平结构（true）还是保留 CLI 原生结构（false） */
  canonical: boolean;
  /** 生成后默认禁用 */
  disabled: boolean;
  /** Claude 设备指纹缺失时自动补一个 */
  fillClaudeDeviceId: boolean;
  /** Antigravity：把 Google 真令牌烘成 v1/<JWT>.<sig>（兼容只认 JWT 的网关） */
  antigravityJwt: boolean;
}

export interface ConvertResult {
  fileName: string;
  content: string;
  meta: Record<string, string>;
  warnings: LocalText[];
}

export type TargetId =
  | "codex"
  | "claude"
  | "antigravity"
  | "gemini-cli"
  | "xai"
  | "kimi"
  | "kimi-ai"
  | "meta"
  | "devin";

export interface TargetMeta {
  id: TargetId;
  label: string;
  hint: string;
  tag: string;
}

/** 展示顺序：常用 → 少见 */
export const TARGETS: TargetMeta[] = [
  { id: "codex", label: "Codex", hint: "OpenAI CLI / ChatGPT 账号", tag: "type: codex" },
  { id: "claude", label: "Claude", hint: "Claude Code / Anthropic OAuth", tag: "type: claude" },
  { id: "antigravity", label: "Antigravity", hint: "Google Cloud Code / Gemini 4", tag: "type: antigravity" },
  { id: "gemini-cli", label: "Gemini CLI", hint: "gemini-cli oauth2 token", tag: "type: gemini-cli" },
  { id: "xai", label: "xAI Grok", hint: "grok CLI / xai OAuth", tag: "type: xai" },
  { id: "kimi", label: "Kimi", hint: "kimi.com coding 套餐", tag: "type: kimi" },
  { id: "kimi-ai", label: "Kimi.ai", hint: "kimi.ai 国际域", tag: "type: kimi-ai" },
  { id: "meta", label: "Meta Muse", hint: "Meta Model API / Muse Code", tag: "type: meta" },
  { id: "devin", label: "Devin", hint: "Devin CLI 账号", tag: "type: devin" },
];

export const TARGET_IDS = TARGETS.map((t) => t.id);

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/** 非数字型 provider 的默认 base_url（取自上游 constant） */
const DEFAULT_BASE_URL: Partial<Record<TargetId, string>> = {
  "gemini-cli": "https://daily-cloudcode-pa.googleapis.com",
  xai: "https://api.x.ai/v1",
  kimi: "https://api.kimi.com/coding",
  "kimi-ai": "https://api.kimi.ai/coding",
  meta: "https://api.meta.ai/v1",
  devin: "https://api.devin.ai",
};

/* ------------------------------------------------------------------ codex */

export async function buildCodex(info: CodexInfo, opt: ConvertOptions): Promise<ConvertResult> {
  const warnings: LocalText[] = [];
  const email = info.email || "unknown";
  if (!info.email) warnings.push({ zh: "令牌里没有 email，文件名用 unknown 占位，建议改名或补字段", en: "No email in the token; the filename falls back to unknown." });
  if (!info.accountId)
    warnings.push({
      zh: "未能从 id_token / access_token 中解析 chatgpt_account_id，文件名缺少 hash 段",
      en: "Could not derive chatgpt_account_id from the tokens; filename has no hash segment.",
    });

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
  const warnings: LocalText[] = [];
  const email = info.email || "unknown";
  if (!info.email)
    warnings.push({ zh: "没有解析到 email：文件名会是 claude-<uuid hash>-unknown.json", en: "No email found: filename becomes claude-<uuid hash>-unknown.json" });
  if (!info.refreshToken)
    warnings.push({ zh: "没有 refresh_token，access token 过期后将无法自动续期", en: "No refresh_token: the access token cannot be renewed once it expires." });
  if (!info.organizationUuid && !info.accountUuid)
    warnings.push({
      zh: "没有 organization/account uuid，文件名哈希段缺失（退化为 claude-<email>.json）",
      en: "No organization/account uuid: filename falls back to claude-<email>.json",
    });

  let deviceIds = info.deviceIds.filter((id) => /^[0-9a-f]{64}$/.test(id));
  if (deviceIds.length === 0 && opt.fillClaudeDeviceId) {
    deviceIds = [randomDeviceId()];
    warnings.push({
      zh: "已自动生成 1 个 claude_device_ids 设备指纹（CLIProxyAPI 要求 64 位 hex）",
      en: "Generated one claude_device_ids fingerprint (CLIProxyAPI requires 64 hex chars).",
    });
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
  const warnings: LocalText[] = [];
  const email = info.email || "";
  if (!email)
    warnings.push({
      zh: "文件里没有 email（Google id_token 也没带），文件名会退化为 antigravity-unknown.json",
      en: "No email in the file or its id_token; filename falls back to antigravity-unknown.json",
    });

  let accessToken = info.accessToken;
  if (opt.antigravityJwt) {
    const baked = bakeAntigravityAccessToken(info);
    accessToken = baked.token;
    warnings.push(...baked.warnings);
  } else if (info.antigravityJwtStyle) {
    warnings.push({
      zh: "access_token 看起来是 cc/cpa 的 v1/<JWT>.<sig> 形态，已原样保留；若网关要求 JWT，请开启「烘成 v1/<JWT>.<sig>」选项",
      en: "access_token already looks like cc/cpa v1/<JWT>.<sig> and was kept as-is; enable the bake option if your gateway requires a JWT.",
    });
  }

  if (!info.projectId) {
    warnings.push({
      zh: "没有 project_id：CLIProxyAPI 首次请求会调用 loadCodeAssist 自动获取；获取失败会报 antigravity auth missing project_id，此时手动补 project_id 即可",
      en: "No project_id: CLIProxyAPI calls loadCodeAssist on the first request to fetch one. If that fails it reports antigravity auth missing project_id — fill project_id in manually.",
    });
  }
  if (!info.refreshToken)
    warnings.push({ zh: "没有 refresh_token：access token（约 1 小时）过期后需要重新导出", en: "No refresh_token: you must export again in about an hour when the access token expires." });

  const now = Date.now();
  const expiresIn = info.expiresIn > 0 ? info.expiresIn : 3599;
  const body: Record<string, unknown> = {
    type: "antigravity",
    access_token: accessToken,
    expires_in: expiresIn,
    timestamp: now,
    expired: info.expiresAt || new Date(now + expiresIn * 1000).toISOString(),
    ...(info.refreshToken ? { refresh_token: info.refreshToken } : {}),
    ...(email ? { email } : {}),
    ...(info.projectId ? { project_id: info.projectId } : {}),
  };
  if (opt.disabled) body["disabled"] = true;

  return {
    fileName: antigravityFileName(email || "unknown"),
    content: json(body),
    meta: {
      email: email || "-",
      project_id: info.projectId || "-",
      expired: String(body["expired"]),
      mode: opt.antigravityJwt ? "v1-JWT" : "raw-ya29",
    },
    warnings,
  };
}

/* ---------------------------------------------------------------- gemini */

export async function buildGemini(info: GeminiInfo, opt: ConvertOptions): Promise<ConvertResult> {
  const warnings: LocalText[] = [];
  const email = info.email || "unknown";
  if (!info.projectId)
    warnings.push({ zh: "没有 project_id：CLIProxyAPI 启动时会调用 loadCodeAssist 自动补全", en: "No project_id: CLIProxyAPI fills it in through loadCodeAssist." });
  if (!info.refreshToken) warnings.push({ zh: "没有 refresh_token，过期后需要重新登录", en: "No refresh_token: you will need to sign in again after expiry." });

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

/* --------------------------------------------- xai / kimi / meta / devin */

interface GenericTargetSpec {
  type: TargetId;
  /** 校验必需字段，返回缺失项的中文提示 */
  required: (info: GenericOAuthInfo) => LocalText[];
  fileName: (info: GenericOAuthInfo) => Promise<string>;
  /** 额外字段（provider 专属） */
  extra?: (info: GenericOAuthInfo) => Record<string, unknown>;
}

const GENERIC_SPECS: Record<Exclude<TargetId, "codex" | "claude" | "antigravity" | "gemini-cli">, GenericTargetSpec> = {
  xai: {
    type: "xai",
    required: (i) => (i.refreshToken ? [] : [{ zh: "没有 refresh_token：xAI 需要它来续期 access token", en: "No refresh_token: xAI needs it to renew the access token." }]),
    fileName: (i) => xaiFileName(i.email, i.subject),
    extra: (i) => ({
      token_type: i.tokenType || "Bearer",
      expires_in: i.expiresIn,
      auth_kind: "oauth",
      ...(i.subject ? { sub: i.subject } : {}),
      base_url: i.baseUrl || DEFAULT_BASE_URL.xai,
      ...(i.clientId ? { client_id: i.clientId } : {}),
    }),
  },
  kimi: {
    type: "kimi",
    required: (i) => (i.refreshToken ? [] : [{ zh: "没有 refresh_token：Kimi 到期后需要重新设备码登录", en: "No refresh_token: Kimi needs a new device-code login after expiry." }]),
    fileName: () => Promise.resolve(kimiFileName("kimi")),
    extra: () => ({ token_type: "Bearer", domain: "kimi.com", base_url: DEFAULT_BASE_URL.kimi }),
  },
  "kimi-ai": {
    type: "kimi-ai",
    required: (i) => (i.refreshToken ? [] : [{ zh: "没有 refresh_token：Kimi 到期后需要重新设备码登录", en: "No refresh_token: Kimi needs a new device-code login after expiry." }]),
    fileName: () => Promise.resolve(kimiFileName("kimi-ai")),
    extra: () => ({ token_type: "Bearer", domain: "kimi.ai", base_url: DEFAULT_BASE_URL["kimi-ai"] }),
  },
  meta: {
    type: "meta",
    required: (i) => (i.accessToken ? [] : [{ zh: "没有 access_token", en: "Missing access_token" }]),
    fileName: (i) => metaFileName(i.email, i.subject || i.name),
    extra: (i) => ({
      base_url: i.baseUrl || DEFAULT_BASE_URL.meta,
      ...(i.subject ? { sub: i.subject } : {}),
      ...(i.name ? { name: i.name } : {}),
    }),
  },
  devin: {
    type: "devin",
    required: (i) => (i.refreshToken || i.accessToken ? [] : [{ zh: "没有 access_token / refresh_token", en: "Missing access_token / refresh_token" }]),
    fileName: (i) => devinFileName(i.email, i.name, i.subject),
    extra: (i) => ({
      base_url: i.baseUrl || DEFAULT_BASE_URL.devin,
      ...(i.name ? { name: i.name } : {}),
    }),
  },
};

export async function buildGeneric(
  target: keyof typeof GENERIC_SPECS,
  info: GenericOAuthInfo,
  opt: ConvertOptions,
): Promise<ConvertResult> {
  const spec = GENERIC_SPECS[target];
  const warnings = [...spec.required(info)];
  const email = info.email || "unknown";

  const body: Record<string, unknown> = {
    type: spec.type,
    access_token: info.accessToken,
    ...(info.refreshToken ? { refresh_token: info.refreshToken } : {}),
    ...(info.idToken ? { id_token: info.idToken } : {}),
    ...(info.expiresAt ? { expired: info.expiresAt } : {}),
    ...(info.scope ? { scope: info.scope } : {}),
    ...(info.email ? { email: info.email } : {}),
    last_refresh: nowRfc3339(),
    ...(spec.extra ? spec.extra(info) : {}),
  };
  if (opt.disabled) body["disabled"] = true;

  return {
    fileName: await spec.fileName(info),
    content: json(body),
    meta: {
      email,
      expired: info.expiresAt || "-",
      ...(info.subject ? { sub: info.subject } : {}),
    },
    warnings,
  };
}

export function isGenericTarget(id: TargetId): id is keyof typeof GENERIC_SPECS {
  return id in GENERIC_SPECS;
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
    case "xai":
      return "xAI Grok OAuth";
    case "kimi":
      return "Kimi OAuth";
    case "meta":
      return "Meta Muse OAuth";
    case "devin":
      return "Devin 凭据";
    case "cliproxy":
      return "CLIProxyAPI auth 文件";
    default:
      return "未知 / other";
  }
}
