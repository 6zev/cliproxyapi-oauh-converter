/**
 * 输入识别：优先看内容，其次看文件名。
 * 这样即使用户把 auth.json 改名成 1.json 也能认出来。
 */
import { decodeJwt, dig, isRecord, pickString } from "./utils";

export type SourceFormat = "codex" | "claude" | "antigravity" | "gemini" | "cliproxy" | "unknown";

export interface Detection {
  format: SourceFormat;
  confidence: "high" | "medium" | "low";
  providerHint: string;
  reasons: string[];
}

const ANTIGRAVITY_SIGNATURES = [
  "cloudcode",
  "antigravity",
  "daily-cloudcode-pa",
  "aicode",
];

function headerAlg(token: string): string {
  try {
    const head = JSON.parse(decodeJwt(token) ? atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")) : "{}");
    return typeof head?.alg === "string" ? head.alg : "";
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
  const declaredType = pickString(obj, ["type"]).toLowerCase();
  const knownCpaTypes = ["codex", "claude", "antigravity", "gemini-cli", "gemini", "xai", "kimi", "kimi-ai", "devin", "meta", "vertex", "openai", "qwen", "iflow"];
  if (
    knownCpaTypes.includes(declaredType) &&
    (obj.access_token || obj.refresh_token || obj.api_key || obj.project_id || obj.claude_device_ids || asRecords(obj) > 0)
  ) {
    reasons.push(`已有 type="${declaredType}"`);
    return { format: "cliproxy", confidence: "high", providerHint: declaredType, reasons };
  }

  // ---------- Codex / OpenAI CLI ----------
  const tokens = isRecord(obj.tokens) ? (obj.tokens as Record<string, unknown>) : null;
  const creds = isRecord(obj.credentials) ? (obj.credentials as Record<string, unknown>) : null;
  if (tokens && ("refresh_token" in tokens || "access_token" in tokens)) {
    reasons.push("存在 tokens.{access,refresh}_token（Codex CLI auth.json）");
    return { format: "codex", confidence: "high", providerHint: "codex", reasons };
  }
  if (isRecord(obj.auth_tokens) || isRecord((obj.auth as Record<string, unknown> | undefined)?.tokens as Record<string, unknown> | undefined)) {
    reasons.push("存在 auth_tokens（Codex 旧版 auth.json）");
    return { format: "codex", confidence: "high", providerHint: "codex", reasons };
  }
  if (creds && (pickString(creds, ["access_token", "refresh_token"]) || "")) {
    reasons.push("存在 credentials.access_token");
    return { format: "codex", confidence: "medium", providerHint: "codex", reasons };
  }

  // ---------- Claude Code ----------
  const claudeScope = obj.claudeAiOauth;
  if (isRecord(claudeScope)) {
    reasons.push("存在 claudeAiOauth（Claude Code .credentials.json）");
    return { format: "claude", confidence: "high", providerHint: "claude", reasons };
  }
  if (Array.isArray(obj.scopes) || obj.subscriptionType) {
    reasons.push("存在 scopes / subscriptionType（Claude OAuth）");
    return { format: "claude", confidence: "medium", providerHint: "claude", reasons };
  }

  // ---------- Codex 扁平结构 ----------
  const idToken = pickString(obj, ["id_token", "idToken"]);
  const accessToken = pickString(obj, ["access_token", "accessToken"]);
  const refreshToken = pickString(obj, ["refresh_token", "refreshToken"]);

  if (idToken) {
    const claims = decodeJwt(idToken) ?? {};
    if (dig(claims, "https://api.openai.com/auth")) {
      reasons.push("id_token 含 https://api.openai.com/auth claims");
      return { format: "codex", confidence: "high", providerHint: "codex", reasons };
    }
    if (claims["https://api.anthropic.com/oauth/account"]) {
      reasons.push("id_token 含 Anthropic oauth claims");
      return { format: "claude", confidence: "high", providerHint: "claude", reasons };
    }
    const iss = String(claims.iss ?? "");
    if (/anthropic/i.test(iss)) {
      reasons.push(`id_token iss=${iss}`);
      return { format: "claude", confidence: "medium", providerHint: "claude", reasons };
    }
  }

  const haystack = JSON.stringify(obj).toLowerCase();
  const antigravityHit = ANTIGRAVITY_SIGNATURES.find((s) => haystack.includes(s));
  if (antigravityHit) {
    reasons.push(`内容含 Antigravity 特征 "${antigravityHit}"`);
    return { format: "antigravity", confidence: "high", providerHint: "antigravity", reasons };
  }

  if (accessToken) {
    const claims = decodeJwt(accessToken) ?? {};
    const iss = String(claims.iss ?? "");
    const alg = headerAlg(accessToken);
    if (/googleapis|accounts\.google|cloudcode/i.test(iss) || alg === "RS256") {
      reasons.push(`access_token iss=${iss || "-"}，alg=${alg || "-"}（Google OAuth）`);
      return { format: "gemini", confidence: "medium", providerHint: "gemini-cli", reasons };
    }
    if (/openai/i.test(iss)) {
      reasons.push(`access_token iss=${iss}`);
      return { format: "codex", confidence: "medium", providerHint: "codex", reasons };
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

  if (accessToken || refreshToken) {
    reasons.push("有 access/refresh_token 但缺少 provider 特征（这是被 CLIProxyAPI 判成 other 的典型情况）");
    return { format: "unknown", confidence: "low", providerHint: "", reasons };
  }

  return { format: "unknown", confidence: "low", providerHint: "", reasons: ["无法识别此结构"] };
}

function asRecords(obj: Record<string, unknown>): number {
  return Object.values(obj).filter((v) => isRecord(v)).length;
}
