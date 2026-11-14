/** 批量转换入口：识别 → 解析 → 生成 CLIProxyAPI auth JSON */
import { detectFormat, type SourceFormat } from "./detect";
import {
  parseAntigravity,
  parseClaude,
  parseCodex,
  parseGemini,
  parseGenericOAuth,
  type CodexInfo,
} from "./parsers";
import {
  buildAntigravity,
  buildClaude,
  buildCodex,
  buildGemini,
  buildGeneric,
  isGenericTarget,
  sourceFormatLabel,
  type ConvertOptions,
  type ConvertResult,
  type TargetId,
} from "./targets";
import { decodeJwt, isRecord, pickString } from "./utils";

export interface InputFile {
  id: string;
  name: string;
  size: number;
  text: string;
  /** 用户手动指定的目标；auto = 跟随识别结果 */
  target: TargetId | "auto";
}

export type RowStatus = "ok" | "warn" | "error";

export interface Row {
  id: string;
  fileName: string;
  format: SourceFormat;
  formatLabel: string;
  formatConfidence: "high" | "medium" | "low";
  target: TargetId | null;
  detectedTarget: TargetId | null;
  userTarget: TargetId | "auto";
  status: RowStatus;
  message: string;
  warnings: string[];
  meta: Record<string, string>;
  result: ConvertResult | null;
}

const FORMAT_TO_TARGET: Record<SourceFormat, TargetId | null> = {
  codex: "codex",
  claude: "claude",
  antigravity: "antigravity",
  gemini: "gemini-cli",
  xai: "xai",
  kimi: "kimi",
  meta: "meta",
  devin: "devin",
  cliproxy: null,
  unknown: null,
};

export function detectTarget(file: InputFile): {
  target: TargetId | null;
  format: SourceFormat;
  confidence: Row["formatConfidence"];
  reasons: string[];
} {
  const det = detectFormat(file.text, file.name);
  return { target: FORMAT_TO_TARGET[det.format], format: det.format, confidence: det.confidence, reasons: det.reasons };
}

export async function convertFile(file: InputFile, opt: ConvertOptions): Promise<Row> {
  const det = detectFormat(file.text, file.name);
  const detectedTarget = FORMAT_TO_TARGET[det.format];
  const userTarget = file.target;
  const target = userTarget !== "auto" ? userTarget : detectedTarget;

  const row: Row = {
    id: file.id,
    fileName: "",
    format: det.format,
    formatLabel: sourceFormatLabel(det.format),
    formatConfidence: det.confidence,
    target,
    detectedTarget,
    userTarget,
    status: "error",
    message: "",
    warnings: [],
    meta: {},
    result: null,
  };

  if (det.format === "cliproxy") {
    row.status = "warn";
    row.fileName = file.name;
    row.message = `已经是 CLIProxyAPI 格式（type=${det.providerHint}），无需转换`;
    return row;
  }

  if (!target) {
    row.status = "error";
    row.message = det.reasons.join("；") || "无法识别，请手动选择目标 provider";
    return row;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(file.text);
  } catch (e) {
    row.status = "error";
    row.message = `JSON 解析失败：${(e as Error).message}`;
    return row;
  }

  const merged: ConvertOptions = { ...opt, provider: target };
  try {
    let result: ConvertResult | null = null;
    switch (target) {
      case "codex": {
        const info = parseCodexForTarget(raw);
        if (!info) throw new Error("没有找到 access_token / refresh_token");
        result = await buildCodex(info, merged);
        break;
      }
      case "claude": {
        const info = parseClaude(raw);
        if (!info) throw new Error("没有找到 claudeAiOauth / access_token");
        result = await buildClaude(info, merged);
        break;
      }
      case "antigravity": {
        const info = parseAntigravity(raw);
        if (!info) throw new Error("没有找到 access_token（Antigravity 的 oauth_creds.json 里必须有 access_token）");
        result = await buildAntigravity(info, merged);
        break;
      }
      case "gemini-cli": {
        const info = parseGemini(raw);
        if (!info) throw new Error("没有找到 access_token");
        result = await buildGemini(info, merged);
        break;
      }
      default: {
        if (!isGenericTarget(target)) throw new Error(`不支持的目标 ${target}`);
        const info = parseGenericOAuth(raw);
        if (!info) throw new Error("没有找到 access_token / refresh_token");
        result = await buildGeneric(target, info, merged);
        break;
      }
    }
    if (!result) throw new Error("生成失败");
    row.result = result;
    row.fileName = result.fileName;
    row.meta = result.meta;
    row.warnings = [...result.warnings];
    if (detectedTarget && target !== detectedTarget) {
      row.warnings.push(
        `内容看起来像 ${sourceFormatLabel(det.format)}，但你强制转成了 ${target}，请自行确认字段是否正确`,
      );
    }
    row.status = row.warnings.length ? "warn" : "ok";
    row.message = row.warnings.length ? "已转换（有提醒）" : "已转换";
    return row;
  } catch (e) {
    row.status = "error";
    row.message = (e as Error).message;
    return row;
  }
}

/** 强制按 codex 解析：兼容 tokens 嵌套 / auth_tokens 旧格式 / 扁平三种 */
function parseCodexForTarget(raw: unknown): CodexInfo | null {
  const direct = parseCodex(raw);
  if (direct) return direct;
  if (isRecord(raw)) {
    const nested = isRecord(raw.tokens) ? raw.tokens : isRecord(raw.auth_tokens) ? raw.auth_tokens : null;
    if (nested) {
      const claims = decodeJwt(pickString(nested, ["id_token"])) ?? {};
      const authClaimRaw = claims["https://api.openai.com/auth"];
      const authClaim = isRecord(authClaimRaw) ? authClaimRaw : {};
      return {
        email: pickString(nested, ["email"]) || pickString(claims, ["email"]),
        accountId: pickString(nested, ["account_id"]) || pickString(authClaim, ["chatgpt_account_id"]),
        planType: pickString(authClaim, ["chatgpt_plan_type"]) || "free",
        userId: pickString(authClaim, ["chatgpt_user_id", "user_id"]),
        idToken: pickString(nested, ["id_token"]),
        accessToken: pickString(nested, ["access_token"]),
        refreshToken: pickString(nested, ["refresh_token"]),
        expiresAt: "",
        lastRefresh: pickString(raw, ["last_refresh"]) || "",
        nested: true,
      };
    }
  }
  return null;
}

export async function convertAll(files: InputFile[], opt: ConvertOptions): Promise<Row[]> {
  const rows: Row[] = [];
  for (const f of files) {
    rows.push(await convertFile(f, opt));
  }
  return rows;
}
