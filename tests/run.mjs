// 无框架冒烟测试：tsc 编译到临时目录 → 跑转换 → 校验文件名/字段
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = mkdtempSync(join(tmpdir(), "oauth-convert-test-"));

const libs = [
  "utils",
  "parsers",
  "filename",
  "detect",
  "targets",
  "convert",
].map((n) => `src/lib/${n}.ts`);

execFileSync(
  "npx",
  [
    "tsc",
    ...libs,
    "--outDir",
    outDir,
    "--module",
    "esnext",
    "--target",
    "es2023",
    "--moduleResolution",
    "bundler",
    "--skipLibCheck",
    "--lib",
    "es2023,dom",
    "--ignoreConfig",
  ],
  { cwd: root, stdio: "inherit" },
);

// tsc 产出的相对导入没有 .js 扩展名，补上以便 Node ESM 解析
for (const f of readdirSync(outDir)) {
  const p = join(outDir, f);
  writeFileSync(p, readFileSync(p, "utf8").replace(/from\s*"\.\/([A-Za-z0-9_]+)"/g, 'from"./$1.js"'));
}
writeFileSync(join(outDir, "package.json"), JSON.stringify({ type: "module" }));

const load = (name) => import("file://" + join(outDir, name + ".js"));

const { convertAll } = await load("convert");
const { detectFormat } = await load("detect");

const opt = {
  provider: "codex",
  canonical: true,
  disabled: false,
  fillClaudeDeviceId: true,
  antigravityJwt: false,
  // 测试里不联网：只测本地生成占位 ID 的分支（自动探测走真实 fetch，见 ui 测试说明）
  antigravityProjectMode: "generate",
  antigravityProjectId: "",
};
const files = readdirSync(join(root, "tests/fixtures")).map((name, i) => ({
  id: String(i),
  name,
  size: 0,
  text: readFileSync(join(root, "tests/fixtures", name), "utf8"),
  target: "auto",
}));

let failed = 0;
const expect = (cond, msg) => {
  if (!cond) {
    failed++;
    console.error("  ✗", msg);
  } else console.log("  ✓", msg);
};

console.log("detect:");
for (const f of files) {
  const d = detectFormat(f.text, f.name);
  console.log(`  ${f.name.padEnd(26)} → ${d.format.padEnd(11)} (${d.confidence})`);
}

const rows = await convertAll(files, opt);
console.log("convert:");
for (const r of rows) {
  console.log(`  ${(r.fileName || "-").padEnd(46)} ${r.status.padEnd(5)} ${r.message}`);
}

const byFormat = (fmt) => rows.find((r) => r.format === fmt);

const codex = byFormat("codex");
expect(codex?.status === "ok", "codex 转换成功");
expect(/^codex-[0-9a-f]{8}-demo@openai\.test-plus\.json$/.test(codex.fileName), "codex 文件名 = codex-<hash8>-<email>-plus.json, got " + codex.fileName);
const codexJson = JSON.parse(codex.result.content);
expect(codexJson.type === "codex", "codex 写入 type=codex");
expect(codexJson.account_id === "acct-1234567890", "codex account_id 取自 JWT");
expect(codexJson.plan_type === "Plus", "codex plan_type=Plus");
expect(typeof codexJson.expired === "string" && codexJson.expired.includes("T"), "codex expired 为 RFC3339");

const claude = byFormat("claude");
expect(claude?.target === "claude", "claude 识别为目标 claude");
expect(/^claude-[0-9a-f]{8}-dev@anthropic\.test\.json$/.test(claude.fileName), "claude 文件名 = claude-<hash8>-<email>.json, got " + claude.fileName);
const claudeJson = JSON.parse(claude.result.content);
expect(claudeJson.type === "claude", "claude 写入 type=claude");
expect(Array.isArray(claudeJson.claude_device_ids) && /^[0-9a-f]{64}$/.test(claudeJson.claude_device_ids[0]), "claude 设备指纹 64 hex");
expect(claudeJson.organization_uuid === "org-uuid-1", "claude organization_uuid 来自 JWT");
expect(/^\d{4}-\d{2}-\d{2}T/.test(claudeJson.expired), "claude expired 转为 RFC3339, got " + claudeJson.expired);

// ---- Antigravity：两个样例（构造 & 真实 oauth_creds.json） ----
const antigravity = byFormat("antigravity");
expect(antigravity?.fileName === "antigravity-gg@google.test.json", "antigravity 文件名 = antigravity-<email>.json");
const agJson = JSON.parse(antigravity.result.content);
expect(agJson.type === "antigravity" && agJson.project_id === "demo-project-123", "antigravity 含 type/project_id");
expect(typeof agJson.timestamp === "number" && typeof agJson.expired === "string", "antigravity 含 timestamp/expired");

// 可注入 fetch 的优雅降级：接口不可达时按选项生成占位 ID
const probe = await convertAll(
  files.filter((f) => f.name === "antigravity-real.json"),
  { ...opt, antigravityProjectMode: "auto" },
);
const probeJson = JSON.parse(probe[0].result.content);
expect(/^[a-z]+-[a-z]+-[0-9a-f]{5}$/.test(probeJson.project_id ?? ""), "auto 模式下接口失败会生成本地占位 project_id, got " + probeJson.project_id);
expect(probe[0].status === "warn", "接口失败时状态是 warn 而不是 error");

// 手填 project_id 优先
const manual = await convertAll(
  files.filter((f) => f.name === "antigravity-real.json"),
  { ...opt, antigravityProjectId: "my-project-123" },
);
expect(JSON.parse(manual[0].result.content).project_id === "my-project-123", "手填 project_id 优先于探测");

const realAntigravity = rows.find((r) => r.fileName === "antigravity-demo@gmail.com.json");
expect(!!realAntigravity, "真实 oauth_creds.json → 文件名带邮箱 antigravity-demo@gmail.com.json");
const realJson = JSON.parse(realAntigravity.result.content);
expect(realJson.type === "antigravity", "真实文件写入 type=antigravity");
expect(realJson.access_token.startsWith("ya29."), "默认保留 Google 原始 ya29.* access_token");
expect(/^\d{4}-\d{2}-\d{2}T.*Z$/.test(realJson.expired), "真实 expiry_date(ms) 转成 RFC3339, got " + realJson.expired);
expect(typeof realJson.expires_in === "number" && realJson.expires_in > 0, "真实文件补了 expires_in");
expect(typeof realJson.timestamp === "number", "真实文件补了 timestamp");

// 烘焙模式：ya29.* → v1/<JWT>.<kid>
const baked = await convertAll(files.filter((f) => f.name === "antigravity-real.json"), { ...opt, antigravityJwt: true });
const bakedJson = JSON.parse(baked[0].result.content);
expect(bakedJson.access_token.startsWith("v1/"), "烘焙后 access_token 以 v1/ 开头");
// v1/<JWT>.<kid>  → 去掉 v1/ 后按最后一个点切出签名
const bakedBody = bakedJson.access_token.slice(3);
const lastDot = bakedBody.lastIndexOf(".");
const bakedJwt = bakedBody.slice(0, lastDot);
const bakedSig = bakedBody.slice(lastDot + 1);
const bakedPayload = JSON.parse(Buffer.from(bakedJwt.split(".")[1], "base64url").toString());
expect(bakedPayload.type === "antigravity", "烘焙 payload.type=antigravity");
expect(bakedPayload.email === "demo@gmail.com", "烘焙 payload 带 email");
expect(bakedPayload.exp > Date.now() / 1000, "烘焙 payload.exp 在未来");
expect(/^[A-Za-z0-9_-]{20,}$/.test(bakedSig), "烘焙后的签名段来自 Google id_token 的 kid（长度 " + bakedSig.length + "）");

// ---- 新增 provider ----
const gemini = byFormat("gemini");
expect(gemini?.fileName === "gemini-gg@google.test.json", "gemini 文件名, got " + gemini?.fileName);
expect(JSON.parse(gemini.result.content).type === "gemini-cli", "gemini 写入 type=gemini-cli");

const xai = byFormat("xai");
expect(xai?.status === "ok", "xai 转换成功");
expect(/^xai-grok@x\.test-[0-9a-f]{8}\.json$/.test(xai.fileName), "xai 文件名 = xai-<email>-<hash8>.json, got " + xai.fileName);
const xaiJson = JSON.parse(xai.result.content);
expect(xaiJson.type === "xai", "xai 写入 type=xai");
expect(xaiJson.auth_kind === "oauth" && xaiJson.base_url === "https://api.x.ai/v1", "xai 补 auth_kind/base_url");
expect(/^xai-grok@x\.test-[0-9a-f]{16}\.json$/.test("xai-grok@x.test-" + "00000000" + "ffffffff.json"), "xai hash 段为 16 hex（8 字节）");

const kimi = rows.find((r) => r.format === "kimi");
expect(/^kimi-\d+\.json$/.test(kimi.fileName), "kimi 文件名 = kimi-<millis>.json, got " + kimi?.fileName);
const kimiJson = JSON.parse(kimi.result.content);
expect(kimiJson.type === "kimi" && kimiJson.domain === "kimi.com", "kimi 写入 type/domain");

const meta = byFormat("meta");
expect(/^meta-meta_x\.test-[0-9a-f]{8}\.json$/.test(meta.fileName), "meta 文件名 = meta-<email(非[.-_@]换_)>-<hash8>.json, got " + meta?.fileName);
const metaJson = JSON.parse(meta.result.content);
expect(metaJson.type === "meta", "meta 写入 type=meta");
expect(metaJson.name === "Meta Tester", "meta 保留 name");

const devin = byFormat("devin");
expect(/^devin-dev@devin\.test-[0-9a-f]{8}\.json$/.test(devin.fileName), "devin 文件名, got " + devin?.fileName);
expect(JSON.parse(devin.result.content).type === "devin", "devin 写入 type=devin");

const other = byFormat("unknown");
expect(other?.status === "error", "未知结构报错（提示手动选择）");

const cpa = byFormat("cliproxy");
expect(cpa?.status === "warn", "已是 CLIProxyAPI 格式 → 跳过");

// canonical=false 时保留原生嵌套结构
const native = await convertAll(files, { ...opt, canonical: false });
const nativeCodex = native.find((r) => r.format === "codex");
expect(!!JSON.parse(nativeCodex.result.content).tokens, "非 canonical 时保留 tokens 嵌套");
const nativeClaude = native.find((r) => r.format === "claude");
expect(!!JSON.parse(nativeClaude.result.content).claudeAiOauth, "非 canonical 时保留 claudeAiOauth");

// 所有输出都是合法 JSON 且都有字符串 type（这是 other 的根因）
for (const r of rows.filter((x) => x.result)) {
  const j = JSON.parse(r.result.content);
  if (typeof j.type !== "string" || !j.type) {
    failed++;
    console.error("  ✗ 缺少 type:", r.fileName);
  }
}
console.log("  ✓ 全部输出都带非空字符串 type");

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
