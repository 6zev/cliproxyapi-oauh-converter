/**
 * 输入识别：优先看内容，其次看文件名。
 * 这样即使用户把 auth.json 改名成 1.json 也能认出来。
 */
import { b64urlDecode, decodeJwt, isRecord, pickString } from "./utils";

export type SourceFormat =
  | "codex"
  | "claude"
  | "antigravity"
  | "gemini"
  | "xai"
  | "kimi"
  | "meta"
  | "devin"
  | "cliproxy"
  | "unknown";

export interface Detection {
  format: SourceFormat;
  confidence: "high" | "medium" | "low";
  providerHint: string;
  reasons: string[];
}

const KNOWN_CPA_TYPES = [
  "codex",
  "claude",
  "antigravity",
  "gemini-cli",
  "gemini",
  "xai",
  "kimi",
  "kimi-ai",
  "devin",
  "meta",
  "vertex",
  "openai",
  "qwen",
  "iflow",
];

function jwtHeader(token: string): Record<string, unknown> {
  try {
    return JSON.parse(b64urlDecode(token.split(".")[0])) ?? {};
  } catch {
    return {};
  }
}

function haystackOf(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj).toLowerCase();
  } catch {
    return "";
  }
}

export function detectFormat(rawText: string, fileName = ""): Detection {
  const lowerName = fileName.toLowerCase();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      format: "unknown",
      confidence: "low",
      providerHint: "",
      reasons: ["不是合法 JSON（可能粘贴不完整或文件损坏）"],
    };
  }

  const reasons: string[] = [];
  if (!isRecord(parsed)) {
    return { format: "unknown", confidence: "low", providerHint: "", reasons: ["顶层不是 JSON 对象"] };
  }
  const obj = parsed as Record<string, unknown>;

  // ---------- 已经是 CLIProxyAPI 的 auth 文件 ----------
  // 只有 type + 上游专属“指纹字段”才算已转换；否则 type 可能只是导出工具顺手写的
  const declaredType = pickString(obj, ["type"]).toLowerCase();
  const cpaFingerprints: Record<string, string[]> = {
    codex: ["account_id", "plan_type", "last_refresh"],
    claude: ["claude_device_ids", "organization_uuid", "account_uuid", "last_refresh"],
    antigravity: ["project_id"],
    "gemini-cli": ["project_id"],
    xai: ["auth_kind", "token_endpoint"],
    kimi: ["domain", "base_url"],
    "kimi-ai": ["domain", "base_url"],
    meta: ["base_url"],
    devin: ["base_url"],
  };
  if (
    KNOWN_CPA_TYPES.includes(declaredType) &&
    (cpaFingerprints[declaredType] ?? []).some((k) => obj[k] !== undefined) &&
    (obj.access_token || obj.refresh_token || obj.api_key)
  ) {
    reasons.push(`已有 type="${declaredType}" + 上游专属字段`);
    return { format: "cliproxy", confidence: "high", providerHint: declaredType, reasons };
  }
  if (declaredType === "kimi" || declaredType === "kimi-ai") {
    reasons.push(`导出文件里带 type="${declaredType}"（Kimi 官方导出格式）`);
    return { format: "kimi", confidence: "high", providerHint: declaredType, reasons };
  }
  if (declaredType === "xai" || declaredType === "meta" || declaredType === "devin") {
    reasons.push(`导出文件里带 type="${declaredType}"`);
    return { format: declaredType, confidence: "high", providerHint: declaredType, reasons };
  }

  // ---------- Codex / OpenAI CLI ----------
  const tokens = isRecord(obj.tokens) ? (obj.tokens as Record<string, unknown>) : null;
  const creds = isRecord(obj.credentials) ? (obj.credentials as Record<string, unknown>) : null;
  if (tokens && ("refresh_token" in tokens || "access_token" in tokens)) {
    reasons.push("存在 tokens.{access,refresh}_token");
    return { format: "codex", confidence: "high", providerHint: "codex", reasons };
  }
  if (isRecord(obj.auth_tokens) || isRecord((obj.auth as Record<string, unknown> | undefined)?.tokens as Record<string, unknown> | undefined)) {
    reasons.push("存在 auth_tokens（Codex 旧版 auth.json）");
    return { format: "codex", confidence: "high", providerHint: "codex", reasons };
  }
  if (creds && (pickString(creds, ["access_token", "refresh_token"]) || "")) {
    // credentials 里同时带 account_id / 无 Google scope 时按 codex 处理
    const hay = haystackOf(creds);
    if (/googleusercontent|accounts\.google|cloudcode/.test(hay)) {
      reasons.push("credentials 内是 Google OAuth 令牌");
      return { format: "antigravity", confidence: "medium", providerHint: "antigravity", reasons };
    }
    reasons.push("存在 credentials.access_token");
    return { format: "codex", confidence: "medium", providerHint: "codex", reasons };
  }

  // ---------- Claude Code ----------
  if (isRecord(obj.claudeAiOauth)) {
    reasons.push("存在 claudeAiOauth（Claude Code .credentials.json）");
    return { format: "claude", confidence: "high", providerHint: "claude", reasons };
  }
  if (Array.isArray(obj.scopes) || obj.subscriptionType) {
    reasons.push("存在 scopes / subscriptionType（Claude OAuth）");
    return { format: "claude", confidence: "medium", providerHint: "claude", reasons };
  }

  // ---------- JWT claims 线索 ----------
  const idToken = pickString(obj, ["id_token", "idToken"]);
  const accessToken = pickString(obj, ["access_token", "accessToken"]);
  const refreshToken = pickString(obj, ["refresh_token", "refreshToken"]);

  if (idToken) {
    const claims = decodeJwt(idToken) ?? {};
    const iss = String(claims.iss ?? "");
    if (isRecord(claims["https://api.openai.com/auth"])) {
      reasons.push("id_token 含 https://api.openai.com/auth claims");
      return { format: "codex", confidence: "high", providerHint: "codex", reasons };
    }
    if (isRecord(claims["https://api.anthropic.com/oauth/account"])) {
      reasons.push("id_token 含 Anthropic oauth claims");
      return { format: "claude", confidence: "high", providerHint: "claude", reasons };
    }
    if (/anthropic/i.test(iss)) {
      reasons.push(`id_token iss=${iss}`);
      return { format: "claude", confidence: "medium", providerHint: "claude", reasons };
    }
    if (/accounts\.google\.com|googleusercontent/i.test(iss)) {
      const azp = String(claims.azp ?? "");
      const scope = String(obj.scope ?? "");
      // Antigravity 用自家 OAuth client；Gemini CLI 用 google-cloud-sdk
      const isAntigravity =
        /cloudcode|antigravity|aicode/i.test(haystackOf(obj)) ||
        /aicode|cloudcode|cclog/i.test(scope) ||
        (!!azp && !/google-cloud-sdk/i.test(azp));
      reasons.push(`Google iss=${iss}${isAntigravity ? " + Antigravity 特征" : ""}`);
      return {
        format: isAntigravity ? "antigravity" : "gemini",
        confidence: "high",
        providerHint: isAntigravity ? "antigravity" : "gemini-cli",
        reasons,
      };
    }
    if (/x\.ai|xai|grok/i.test(iss)) {
      reasons.push(`id_token iss=${iss}`);
      return { format: "xai", confidence: "high", providerHint: "xai", reasons };
    }
  }

  const hay = haystackOf(obj);
  // 其他品牌线索先判，避免被后面的通用 Google 分支抢走
  const brandHints: [SourceFormat, RegExp][] = [
    ["xai", /x\.ai|\bxai\b|grok/i],
    ["meta", /meta\.ai|muse[-_ ]?code|\bmeta\b/i],
    ["devin", /devin\.ai/i],
    ["kimi", /kimi\.(com|ai)|moonshot/i],
  ];
  for (const [format, re] of brandHints) {
    if (re.test(hay)) {
      reasons.push(`内容含 ${format} 特征`);
      return { format, confidence: "medium", providerHint: format, reasons };
    }
  }

  const antigravityHit = ["cloudcode", "antigravity", "aicode"].find((s) => hay.includes(s));
  if (antigravityHit) {
    reasons.push(`内容含 Antigravity 特征 "${antigravityHit}"`);
    return { format: "antigravity", confidence: "high", providerHint: "antigravity", reasons };
  }

  if (accessToken) {
    const claims = decodeJwt(accessToken) ?? {};
    const iss = String(claims.iss ?? "");
    const alg = String(jwtHeader(accessToken).alg ?? "");
    // Antigravity / Gemini 的 access token 是 ya29.*（不是 JWT）
    if (/^ya29\./.test(accessToken)) {
      const isAntigravity = /antigravity|aicode/i.test(String(obj.scope ?? "")) || !!obj.project_id;
      reasons.push(`access_token 是 Google ya29.*${isAntigravity ? " + 带 project_id" : ""}`);
      return {
        format: isAntigravity ? "antigravity" : "gemini",
        confidence: "medium",
        providerHint: isAntigravity ? "antigravity" : "gemini-cli",
        reasons,
      };
    }
    if (/googleapis|accounts\.google|cloudcode/i.test(iss) || alg === "RS256") {
      reasons.push(`access_token iss=${iss || "-"}，alg=${alg || "-"}`);
      return { format: "gemini", confidence: "medium", providerHint: "gemini-cli", reasons };
    }
    if (/openai/i.test(iss)) {
      reasons.push(`access_token iss=${iss}`);
      return { format: "codex", confidence: "medium", providerHint: "codex", reasons };
    }
    if (/x\.ai|xai|grok/i.test(iss)) {
      reasons.push(`access_token iss=${iss}`);
      return { format: "xai", confidence: "medium", providerHint: "xai", reasons };
    }
    if (/kimi\.(com|ai)|moonshot/i.test(iss) || /kimi/i.test(String(obj.domain ?? ""))) {
      reasons.push("Kimi 特征（iss / domain）");
      return { format: "kimi", confidence: "medium", providerHint: "kimi", reasons };
    }
    if (/meta\.ai|facebook|meta/i.test(iss)) {
      reasons.push(`access_token iss=${iss}`);
      return { format: "meta", confidence: "medium", providerHint: "meta", reasons };
    }
    if (/devin/i.test(iss) || /devin/i.test(String(obj.base_url ?? ""))) {
      reasons.push("Devin 特征（iss / base_url）");
      return { format: "devin", confidence: "medium", providerHint: "devin", reasons };
    }
  }

  if (isRecord(obj.installed) || isRecord(obj.web)) {
    reasons.push("installed/web 结构（Google OAuth client）");
    return { format: "antigravity", confidence: "low", providerHint: "antigravity", reasons };
  }

  // ---------- 兜底：文件名 + 键名 ----------
  if (lowerName.includes("antigravity")) {
    return { format: "antigravity", confidence: "low", providerHint: "antigravity", reasons: ["按文件名推断"] };
  }
  if (lowerName.includes("claude")) {
    return { format: "claude", confidence: "low", providerHint: "claude", reasons: ["按文件名推断"] };
  }
  if (lowerName.includes("codex") || lowerName.includes("auth.json")) {
    return { format: "codex", confidence: "low", providerHint: "codex", reasons: ["按文件名推断"] };
  }
  if (lowerName.includes("gemini")) {
    return { format: "gemini", confidence: "low", providerHint: "gemini-cli", reasons: ["按文件名推断"] };
  }
  if (lowerName.includes("xai") || lowerName.includes("grok")) {
    return { format: "xai", confidence: "low", providerHint: "xai", reasons: ["按文件名推断"] };
  }
  if (lowerName.includes("kimi")) {
    return { format: "kimi", confidence: "low", providerHint: "kimi", reasons: ["按文件名推断"] };
  }
  if (lowerName.includes("devin")) {
    return { format: "devin", confidence: "low", providerHint: "devin", reasons: ["按文件名推断"] };
  }

  if (accessToken || refreshToken) {
    reasons.push("有 access/refresh_token 但缺少 provider 特征（这是被 CLIProxyAPI 判成 other 的典型情况）");
    return { format: "unknown", confidence: "low", providerHint: "", reasons };
  }

  return { format: "unknown", confidence: "low", providerHint: "", reasons: ["无法识别此结构"] };
}
