import {
  decodeJwt,
  dig,
  isRecord,
  jwtExp,
  jwtKeyId,
  pickString,
  str,
  unsignedJwt,
} from "./utils";

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
  /** 是否来自 auth.json 的 credentials/tokens 子对象 */
  nested: boolean;
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
 * Google 系（Antigravity / Gemini CLI）共用工具
 * ========================================================================= */

/** 统一的时间字段解析：expiry_date / expires_at 可能是 ms 或 s */
function parseGoogleExpiry(t: Record<string, unknown>): string {
  const explicit = pickString(t, ["expired", "expires_at"]);
  if (explicit) {
    const n = Number(explicit);
    if (Number.isFinite(n) && n > 1e11) return new Date(n).toISOString();
    return explicit;
  }
  for (const key of ["expiry_date", "expiryDate", "expires_at_ms", "timestamp"]) {
    const raw = t[key];
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (key === "timestamp") {
      // Antigravity 写盘格式：timestamp 是签发毫秒 + expires_in 秒
      const expiresIn = Number(t["expires_in"]);
      if (Number.isFinite(expiresIn) && expiresIn > 0) return new Date(n + expiresIn * 1000).toISOString();
      continue;
    }
    return new Date(n > 1e11 ? n : n * 1000).toISOString();
  }
  return "";
}

/** Google 系凭据里 email 的三个来源：显式字段 / id_token / access_token */
function googleEmail(t: Record<string, unknown>, outer?: Record<string, unknown>): string {
  const idClaims = decodeJwt(pickString(t, ["id_token", "idToken"])) ?? {};
  const atClaims = decodeJwt(pickString(t, ["access_token", "accessToken"])) ?? {};
  return (
    pickString(t, ["email", "account.email"]) ||
    pickString(outer ?? {}, ["email"]) ||
    pickString(idClaims, ["email"]) ||
    pickString(atClaims, ["email"]) ||
    ""
  );
}

function unwrapTokenCandidates(raw: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [raw];
  for (const key of ["token", "auth", "credentials", "installed", "web", "oauth"]) {
    if (isRecord(raw[key])) candidates.push(raw[key] as Record<string, unknown>);
  }
  for (const key of ["accounts", "items", "creds"]) {
    const list = raw[key];
    if (Array.isArray(list) && isRecord(list[0])) candidates.push(list[0] as Record<string, unknown>);
  }
  return candidates;
}

/* =========================================================================
 * Antigravity（Google Cloud Code）
 *
 * 真实文件形如（注意没有 email / project_id，只有 expiry_date 毫秒）：
 * {
 *   "access_token": "ya29...", "scope": "...", "token_type": "Bearer",
 *   "id_token": "eyJ...", "expiry_date": 1794655045605, "refresh_token": "1//0e..."
 * }
 * ========================================================================= */

export interface AntigravityInfo {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: string;
  email: string;
  projectId: string;
  expiresIn: number;
  scope: string;
  /** 是否为 cc/cpa 风格的 JWT（v1/<payload>.<sig>），而不是 Google 真 access token */
  antigravityJwtStyle: boolean;
}

export function parseAntigravity(raw: unknown): AntigravityInfo | null {
  if (!isRecord(raw)) return null;

  for (const t of unwrapTokenCandidates(raw)) {
    const accessToken = pickString(t, ["access_token", "accessToken", "id_token"]);
    if (!accessToken) continue;
    const refreshToken = pickString(t, ["refresh_token", "refreshToken"]);
    const idToken = pickString(t, ["id_token", "idToken"]);

    let expiresAt = parseGoogleExpiry(t);
    if (!expiresAt) {
      const exp = jwtExp(idToken) || jwtExp(accessToken);
      if (exp) expiresAt = new Date(exp * 1000).toISOString();
    }

    const expiresInRaw = Number(dig(t, "expires_in"));
    const expiresIn =
      Number.isFinite(expiresInRaw) && expiresInRaw > 0
        ? expiresInRaw
        : Math.max(60, Math.round((Date.parse(expiresAt) - Date.now()) / 1000) || 3599);

    const projectId =
      pickString(t, ["project_id", "projectId", "cloudaicompanionProject", "quota_project_id"]) ||
      pickString(decodeJwt(idToken) ?? {}, ["cloudaicompanion_project"]) ||
      pickString(decodeJwt(accessToken) ?? {}, ["cloudaicompanion_project"]);

    return {
      accessToken,
      refreshToken,
      idToken,
      expiresAt,
      email: googleEmail(t, raw),
      projectId,
      expiresIn,
      scope: pickString(t, ["scope"]),
      antigravityJwtStyle: accessToken.startsWith("v1/") || accessToken.split(".").length === 2,
    };
  }
  return null;
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
  for (const t of unwrapTokenCandidates(raw)) {
    const accessToken = pickString(t, ["access_token", "accessToken"]);
    if (!accessToken) continue;
    return {
      accessToken,
      refreshToken: pickString(t, ["refresh_token", "refreshToken"]),
      projectId:
        pickString(t, ["project_id", "projectId", "cloudaicompanionProject"]) ||
        pickString(decodeJwt(accessToken) ?? {}, ["cloudaicompanion_project", "project_id"]),
      email: googleEmail(t, raw),
      expiresAt: parseGoogleExpiry(t),
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

/* =========================================================================
 * 通用：xAI Grok / Kimi / Meta Muse / Devin
 *   这些 provider 的 auth 文件基本都是扁平字段，主要差别在 type 与文件名。
 * ========================================================================= */

export interface GenericOAuthInfo {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: string;
  email: string;
  subject: string;
  name: string;
  scope: string;
  tokenType: string;
  expiresIn: number;
  baseUrl: string;
  domain: string;
  deviceId: string;
  clientId: string;
}

/** 从任意常见 OAuth 形状里抽取通用字段（含 access_token 才会返回） */
export function parseGenericOAuth(raw: unknown): GenericOAuthInfo | null {
  if (!isRecord(raw)) return null;
  for (const t of unwrapTokenCandidates(raw)) {
    const accessToken = pickString(t, ["access_token", "accessToken", "token.access_token"]);
    if (!accessToken) continue;

    const idToken = pickString(t, ["id_token", "idToken"]);
    const claims = decodeJwt(idToken) ?? {};
    const atClaims = decodeJwt(accessToken) ?? {};

    let expiresAt = pickString(t, ["expired", "expires_at"]);
    if (!expiresAt) {
      const exp = jwtExp(idToken) || jwtExp(accessToken);
      if (exp) expiresAt = new Date(exp * 1000).toISOString();
    }
    if (!expiresAt) expiresAt = parseGoogleExpiry(t);

    const expiresInRaw = Number(dig(t, "expires_in"));
    const expiresIn =
      Number.isFinite(expiresInRaw) && expiresInRaw > 0
        ? expiresInRaw
        : Math.max(60, Math.round((Date.parse(expiresAt) - Date.now()) / 1000) || 3600);

    return {
      accessToken,
      refreshToken: pickString(t, ["refresh_token", "refreshToken"]),
      idToken,
      expiresAt,
      email:
        pickString(t, ["email", "account.email", "profile.email", "user.email"]) ||
        pickString(claims, ["email"]) ||
        pickString(atClaims, ["email"]),
      subject: pickString(t, ["sub", "subject", "user_id", "userId"]) || pickString(claims, ["sub"]),
      name: pickString(t, ["name", "display_name", "displayName", "user.name"]) || pickString(claims, ["name"]),
      scope: pickString(t, ["scope", "scopes"]),
      tokenType: pickString(t, ["token_type"]) || "Bearer",
      expiresIn,
      baseUrl: pickString(t, ["base_url", "baseUrl", "api_base", "endpoint"]),
      domain: pickString(t, ["domain", "host", "issuer"]),
      deviceId: pickString(t, ["device_id", "deviceId"]),
      clientId: pickString(t, ["client_id", "clientId"]),
    };
  }
  return null;
}

/* =========================================================================
 * Antigravity 增强：把 Google 真令牌烘成 cc/cpa 风格的 v1/<JWT>.<sig>
 *
 * Google 的 access_token（ya29.*）不是 JWT，Agy/Antigravity 兼容网关读不到
 * 邮箱、密钥 id、过期时间；上游社区把 payload 烘进一个无签名 JWT，并把
 * Google id_token 的 kid（DER 签名前缀）拼在后面当 "sig"。
 * ========================================================================= */

export interface AntigravityJwtPayload {
  type: "antigravity";
  email?: string;
  exp: number;
  iat: number;
  sub?: string;
  azp?: string;
  /**
   * 让 Google 把「项目 ID」直接猜出来（上游 loadCodeAssist 的 metadata 字段），
   * 缺少 project_id 且用户也填不出时，可让 CLIProxyAPI 首次请求时自动获取。
   */
  projectId?: string;
}

/** 用 Google 的 id_token 信息构造 v1/<jwt>.<sig> 形态的 access token */
export function bakeAntigravityAccessToken(info: AntigravityInfo): { token: string; warnings: string[] } {
  const warnings: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  const exp = jwtExp(info.idToken) || jwtExp(info.accessToken) || now + 2999;
  const payload: AntigravityJwtPayload = {
    type: "antigravity",
    exp,
    iat: Math.min(now, exp - 1),
  };
  if (info.email) payload.email = info.email;

  const idClaims = decodeJwt(info.idToken) ?? {};
  const sub = str(idClaims["sub"]);
  if (sub) payload.sub = sub;
  const azp = str(idClaims["azp"]);
  if (azp) payload.azp = azp;

  const jwt = unsignedJwt(payload as unknown as Record<string, unknown>);
  const kid = jwtKeyId(info.idToken);
  if (!kid) {
    warnings.push("Google id_token 里没有 kid，无法还原 Google 的签名前缀（Google 可能直接拒绝这个 access token）");
  }
  return { token: `v1/${jwt}.${kid}`, warnings };
}

/** 取 access/id token 的 exp，输出 RFC3339（codex 的 expired 字段用） */
export function codexExpiryFromJwt(token: string): string {
  const exp = jwtExp(token);
  return exp ? new Date(exp * 1000).toISOString() : "";
}
