/**
 * Antigravity 的 project_id 获取策略（纯浏览器实现，思路对齐 AIClient2API 的
 * discoverProjectAndModels）：
 *
 *   1. 先调 v1internal:loadCodeAssist，返回 cloudaicompanionProject 就直接用；
 *   2. 没有就调 v1internal:onboardUser 轮询，返回 operation.response.cloudaicompanionProject.id；
 *   3. 都拿不到（网络/CORS/无资格）→ 本地生成一个同形态的占位 project_id
 *      （<adj>-<noun>-<5 位>），或让用户手填。
 *
 * 为什么能在浏览器里跑：Google 的 Cloud Code 接口对 Origin: https://antigravity.google
 * 放行 CORS，这也是同类前端工具能直连的原因。请求失败时静默降级，不影响其它字段。
 */
import { decodeJwt, nowRfc3339 } from "./utils";

const DAILY_BASE = "https://daily-cloudcode-pa.googleapis.com";
const PROD_BASE = "https://cloudcode-pa.googleapis.com";
const API_VERSION = "v1internal";
const ORIGIN = "https://antigravity.google";

const ADJECTIVES = ["useful", "bright", "swift", "calm", "bold", "quiet", "solid", "vivid"];
const NOUNS = ["fuze", "wave", "spark", "flow", "core", "beam", "path", "loop"];

export type ProjectIdSource = "loadCodeAssist" | "onboardUser" | "generated" | "manual";

export interface ProjectIdResult {
  projectId: string;
  source: ProjectIdSource;
  tierId?: string;
  email?: string;
  /** 失败时的原因，用于界面提示 */
  error?: string;
}

/** 和 AIClient2API 的 generateProjectID 同形态：useful-fuze-a1b2c */
export function generateProjectId(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 5);
  const adj = ADJECTIVES[bytes[0] % ADJECTIVES.length];
  const noun = NOUNS[bytes[1] % NOUNS.length];
  return `${adj}-${noun}-${suffix}`;
}

function antigravityUserAgent(): string {
  return "antigravity/cli/1.11.5 (darwin; arm64)";
}

async function callApi(method: string, accessToken: string, body: unknown, timeoutMs = 12000): Promise<Record<string, unknown>> {
  let lastError: unknown = null;
  for (const base of [DAILY_BASE, PROD_BASE]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/${API_VERSION}:${method}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": antigravityUserAgent(),
          Origin: ORIGIN,
        },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${method} ${res.status}: ${text.slice(0, 160)}`);
      }
      return (await res.json()) as Record<string, unknown>;
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function extractEmail(loadResponse: Record<string, unknown>, accessToken: string): string {
  // AIClient2API 从 manageSubscriptionUri 的 Email= 参数里抠邮箱
  const uri = typeof loadResponse["manageSubscriptionUri"] === "string" ? loadResponse["manageSubscriptionUri"] : "";
  const match = uri.match(/Email=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  const claims = decodeJwt(accessToken) ?? {};
  return typeof claims["email"] === "string" ? claims["email"] : "";
}

function extractProjectId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const id = (value as Record<string, unknown>)["id"];
    if (typeof id === "string") return id.trim();
  }
  return "";
}

/**
 * 走一遍 loadCodeAssist → onboardUser；失败时按 fallback 生成占位 ID。
 * 全程不抛异常：调用方拿到 error 自行决定是否提示用户。
 */
export async function resolveAntigravityProjectId(
  accessToken: string,
  opts: { allowGenerated?: boolean; knownProjectId?: string } = {},
): Promise<ProjectIdResult> {
  if (opts.knownProjectId) {
    return { projectId: opts.knownProjectId, source: "manual" };
  }
  try {
    const load = await callApi("loadCodeAssist", accessToken, { metadata: { ideType: "ANTIGRAVITY" } });
    const email = extractEmail(load, accessToken);

    const existing = extractProjectId(load["cloudaicompanionProject"]);
    if (existing) {
      const tiers = Array.isArray(load["allowedTiers"]) ? (load["allowedTiers"] as Record<string, unknown>[]) : [];
      const defaultTier = tiers.find((tier) => tier["isDefault"] === true);
      const tierId = typeof defaultTier?.["id"] === "string" ? (defaultTier["id"] as string) : undefined;
      return { projectId: existing, source: "loadCodeAssist", tierId, email };
    }

    const tiers = Array.isArray(load["allowedTiers"]) ? (load["allowedTiers"] as Record<string, unknown>[]) : [];
    const defaultTier = tiers.find((tier) => tier["isDefault"] === true);
    const baseTier = typeof defaultTier?.["id"] === "string" && defaultTier["id"] ? (defaultTier["id"] as string) : "free-tier";

    const body = {
      tier_id: baseTier,
      metadata: {
        ide_type: "ANTIGRAVITY",
        ide_version: antigravityUserAgent().match(/antigravity\/cli\/([^ ]+)/)?.[1] ?? "",
        ide_name: "antigravity",
      },
    };

    let lro = await callApi("onboardUser", accessToken, body);
    for (let i = 0; i < 6 && lro["done"] !== true; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      lro = await callApi("onboardUser", accessToken, body);
    }
    const response = (lro["response"] ?? {}) as Record<string, unknown>;
    const onboarded = extractProjectId(response["cloudaicompanionProject"]);
    if (onboarded) {
      return { projectId: onboarded, source: "onboardUser", tierId: baseTier, email };
    }
    throw new Error("onboardUser 未返回 project id（可能尚未完成或该账号无资格）");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // 浏览器里 CORS/DNS 失败只有 "Failed to fetch" 之类的笼统错误，这里换成可读说明
    const friendly = /failed to fetch|networkerror|load failed|aborted/i.test(message)
      ? "浏览器直连 Google 接口失败（CORS / 网络 / 代理）"
      : message;
    if (opts.allowGenerated) {
      return { projectId: generateProjectId(), source: "generated", error: friendly };
    }
    return { projectId: "", source: "generated", error: friendly };
  }
}

/** 便于界面展示的探测摘要 */
export function describeProjectIdResult(result: ProjectIdResult): string {
  switch (result.source) {
    case "loadCodeAssist":
      return `loadCodeAssist 返回 ${result.projectId}${result.tierId ? `（tier ${result.tierId}）` : ""}`;
    case "onboardUser":
      return `onboardUser 新建 ${result.projectId}${result.tierId ? `（tier ${result.tierId}）` : ""}`;
    case "generated":
      return result.projectId
        ? `接口不可用，已生成占位 ${result.projectId}（${result.error ?? "unknown"}）`
        : `接口不可用（${result.error ?? "unknown"}）`;
    default:
      return `手工指定 ${result.projectId}`;
  }
}

/** 供界面显示“刚探测过”的时间 */
export function stamp(): string {
  return nowRfc3339();
}
