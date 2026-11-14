import { decodeJwt, dig, isRecord, pickString, str } from "./utils";

/* =========================================================================
 * Codex（OpenAI CLI）相关解析
 * ========================================================================= */

export interface CodexInfo {
  email: string;
  accountId: string;
  planType: string;
  userId: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // RFC3339
  lastRefresh: string;
  /** 是否来自 auth.json 的 credentials 子对象（CLI 版），决定是否保留嵌套结构 */
  nested: boolean;
}

function unixToRfc3339(sec: unknown): string {
  const n = typeof sec === "number" ? sec : Number(sec);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n * 1000).toISOString().replace(".000Z", "Z");
}

/** 从 auth.json / 嵌套 credentials / 直接对象 中抽取 Codex 令牌信息 */
export function parseCodex(raw: unknown): CodexInfo | null {
  if (!isRecord(raw)) return null;
  // 优先级：credentials（云端同步格式）> tokens（Codex CLI auth.json）> 扁平结构
  const creds = isRecord(raw.credentials) ? raw.credentials : null;
  const cliTokens = isRecord(raw.tokens) ? raw.tokens : null;
  const t = creds ?? cliTokens ?? raw;

  const accessToken = pickString(t, ["access_token", "accessToken", "access"]);
  const refreshToken = pickString(t, ["refresh_token", "refreshToken", "refresh"]);
  const idToken = pickString(t, ["id_token", "idToken", "id"]);
  if (!accessToken && !refreshToken) return null;

  const claims = decodeJwt(idToken) ?? decodeJwt(accessToken) ?? {};
  // 注意：claim 的 key 本身带点，不能用 dig() 路径取值
  const authClaimRaw = claims["https://api.openai.com/auth"];
  const authClaim = isRecord(authClaimRaw) ? authClaimRaw : {};

  const email =
    pickString(t, ["email", "account.email", "profile.email"]) ||
    pickString(authClaim, ["email"]) ||
    pickString(claims, ["email"]);

  const accountId =
    pickString(t, ["account_id", "accountId", "account.id"]) ||
    pickString(authClaim, ["chatgpt_account_id", "chatgpt_accountId", "account_id"]) ||
    pickString(claims, ["chatgpt_account_id"]);

  // plan 以 id_token 的 claims 为准；显式字段（如手写的 "free"）只在 claims 缺失时兜底
  const planType =
    pickString(authClaim, ["chatgpt_plan_type", "plan_type"]) ||
    pickString(claims, ["chatgpt_plan_type"]) ||
    pickString(t, ["plan_type", "planType", "chatgpt_plan_type"]) ||
    "free";

  const userId = pickString(authClaim, ["chatgpt_user_id", "user_id"]) || pickString(claims, ["sub"]);

  let expiresAt = pickString(t, ["expired", "expires_at", "expiresAt", "expire"]);
  if (!expiresAt) {
    const exp = Number(dig(claims, "exp"));
    if (Number.isFinite(exp) && exp > 0) expiresAt = new Date(exp * 1000).toISOString();
  }
  const lastRefresh = pickString(raw, ["last_refresh", "lastRefresh"]);

  return {
    email,
    accountId,
    planType,
    userId,
    idToken,
    accessToken,
    refreshToken,
    expiresAt,
    lastRefresh,
    nested: !!creds,
  };
}

/* =========================================================================
 * Claude Code → CLIProxyAPI
 * ========================================================================= */

export interface ClaudeInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  subscriptionType: string;
  scopes: string[];
  email: string;
  organizationUuid: string;
  organizationName: string;
  accountUuid: string;
  deviceIds: string[];
  /** 来自 Claude Code credentials 结构（claudeAiOauth 嵌套） */
  fromCli: boolean;
}

export function parseClaude(raw: unknown): ClaudeInfo | null {
  if (!isRecord(raw)) return null;
  // Claude Code 的 ~/.claude/.credentials.json 是 { claudeAiOauth: {...} }
  const o = isRecord(raw.claudeAiOauth) ? raw.claudeAiOauth : raw;

  const accessToken = pickString(o, ["access_token", "accessToken"]);
  const refreshToken = pickString(o, ["refresh_token", "refreshToken"]);
  if (!accessToken && !refreshToken) return null;

  let expiresAt = pickString(o, ["expired", "expires_at"]);
  // Claude Code 的 expiresAt 是毫秒时间戳；上游写盘用 RFC3339 字符串，这里统一转成 RFC3339
  const expiresAtMs = Number(o["expiresAt"] ?? o["expires_at_ms"]);
  if (!expiresAt && Number.isFinite(expiresAtMs) && expiresAtMs > 0) {
    expiresAt = new Date(expiresAtMs).toISOString();
  }

  const claims = decodeJwt(accessToken) ?? {};
  const account = isRecord(claims["https://api.anthropic.com/oauth/account"])
    ? (claims["https://api.anthropic.com/oauth/account"] as Record<string, unknown>)
    : {};
  const org = isRecord(claims["https://api.anthropic.com/oauth/organization"])
    ? (claims["https://api.anthropic.com/oauth/organization"] as Record<string, unknown>)
    : {};

  const scopesRaw = dig(o, "scopes");
  const scopes = Array.isArray(scopesRaw) ? scopesRaw.map(String) : [];

  const deviceIdsRaw = (o["claude_device_ids"] ?? o["deviceIds"]) as unknown;
  const deviceIds = Array.isArray(deviceIdsRaw)
    ? deviceIdsRaw.map(String).filter((s) => /^[0-9a-f]{64}$/i.test(s.trim()))
    : [];

  return {
    accessToken,
    refreshToken,
    expiresAt,
    subscriptionType: pickString(o, ["subscriptionType", "subscription_type"]),
    scopes,
    email:
      pickString(o, ["email", "account.email"]) ||
      pickString(claims, ["email"]) ||
      pickString(account, ["email_address", "email"]),
    organizationUuid:
      pickString(o, ["organization_uuid", "organizationUuid"]) ||
      pickString(claims, ["organization_uuid"]) ||
      pickString(org, ["uuid", "id"]),
    organizationName:
      pickString(o, ["organization_name", "organizationName"]) || pickString(org, ["name"]),
    accountUuid:
      pickString(o, ["account_uuid", "accountUuid"]) ||
      pickString(claims, ["account_uuid"]) ||
      pickString(account, ["uuid", "id"]) ||
      str(claims["sub"]),
    deviceIds,
    fromCli: isRecord(raw.claudeAiOauth),
  };
}

/* =========================================================================
 * Gemini CLI（oauth2 token 结构）→ CLIProxyAPI gemini-cli
 * ========================================================================= */

export interface GeminiInfo {
  accessToken: string;
  refreshToken: string;
  /** 可能为空，CLIProxyAPI 会自己做 loadCodeAssist 获取 */
  projectId: string;
  email: string;
  expiresAt: string;
}

export function parseGemini(raw: unknown): GeminiInfo | null {
  if (!isRecord(raw)) return null;
  const t = isRecord(raw.token) ? raw.token : raw;
  const accessToken = pickString(t, ["access_token", "accessToken"]);
  const refreshToken = pickString(t, ["refresh_token", "refreshToken"]);
  if (!accessToken) return null;

  let expiresAt = pickString(t, ["expired", "expires_at", "expiresAt"]);
  const expiryDate = pickString(t, ["expiry_date", "expiryDate"]);
  if (!expiresAt && expiryDate) {
    const ms = Number(expiryDate);
    if (Number.isFinite(ms)) expiresAt = new Date(ms).toISOString();
  }

  const claims = decodeJwt(accessToken) ?? {};
  const idToken = pickString(raw, ["id_token", "idToken"]);

  return {
    accessToken,
    refreshToken,
    projectId:
      pickString(raw, ["project_id", "projectId", "cloudaicompanionProject"]) ||
      pickString(claims, ["cloudaicompanion_project", "project_id"]),
    email:
      pickString(raw, ["email"]) ||
      pickString(claims, ["email"]) ||
      pickString(decodeJwt(idToken) ?? {}, ["email"]),
    expiresAt,
  };
}

/* =========================================================================
 * Antigravity（Google Cloud Code）
 *   常见来源：
 *   1) ~/.antigravity/.../oauth_creds.json  形似 {"access_token","refresh_token","expires_in","email","project_id"}
 *   2) 带 token 包装的 {"token": {...}}
 *   3) 部分导出工具产出的 {"auth":{"access_token":...}}
 * ========================================================================= */

export interface AntigravityInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email: string;
  projectId: string;
  expiresIn: number;
}

export function parseAntigravity(raw: unknown): AntigravityInfo | null {
  if (!isRecord(raw)) return null;
  const candidates: Record<string, unknown>[] = [raw];
  for (const key of ["token", "auth", "credentials", "installed"]) {
    if (isRecord(raw[key])) candidates.push(raw[key] as Record<string, unknown>);
  }

  for (const t of candidates) {
    const accessToken = pickString(t, ["access_token", "accessToken", "id_token"]);
    const refreshToken = pickString(t, ["refresh_token", "refreshToken"]);
    if (!accessToken) continue;

    const claims = decodeJwt(pickString(t, ["id_token"])) ?? decodeJwt(accessToken) ?? {};
    let expiresAt = pickString(t, ["expired", "expires_at", "expiresAt"]);
    const exp = Number(claims["exp"]);
    if (!expiresAt && Number.isFinite(exp) && exp > 0) expiresAt = new Date(exp * 1000).toISOString();
    const expiresInRaw = Number(dig(t, "expires_in"));
    if (!expiresAt && Number.isFinite(expiresInRaw) && expiresInRaw > 0) {
      expiresAt = new Date(Date.now() + expiresInRaw * 1000).toISOString();
    }

    return {
      accessToken,
      refreshToken,
      expiresAt,
      email:
        pickString(t, ["email", "account"]) ||
        pickString(claims, ["email"]) ||
        "",
      projectId:
        pickString(t, ["project_id", "projectId", "cloudaicompanionProject", "quota_project_id"]) ||
        pickString(claims, ["cloudaicompanion_project"]),
      expiresIn: Number.isFinite(expiresInRaw) ? expiresInRaw : 0,
    };
  }
  return null;
}

/** 从 Google 的 client_secret*.json / gcloud 凭据里拿 client_id 与 refresh_token */
export function parseGoogleOAuthClient(raw: unknown): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  projectId: string;
} | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.installed)
    ? (raw.installed as Record<string, unknown>)
    : isRecord(raw.web)
      ? (raw.web as Record<string, unknown>)
      : raw;
  const clientId = pickString(src, ["client_id", "clientId"]);
  if (!clientId) return null;
  return {
    clientId,
    clientSecret: pickString(src, ["client_secret", "clientSecret"]),
    refreshToken: pickString(src, ["refresh_token", "refreshToken"]),
    projectId: pickString(src, ["quota_project_id", "project_id"]),
  };
}

export function codexExpiryFromJwt(accessToken: string): string {
  const claims = decodeJwt(accessToken);
  const exp = Number(claims?.["exp"]);
  return Number.isFinite(exp) && exp > 0 ? unixToRfc3339(exp) : "";
}
