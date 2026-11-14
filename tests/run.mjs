// 无框架冒烟测试：tsc 编译到临时目录 → 跑转换 → 校验文件名/字段
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = mkdtempSync(join(tmpdir(), "oauth-convert-test-"));

execFileSync(
  "npx",
  ["tsc", "src/lib/utils.ts", "src/lib/parsers.ts", "src/lib/filename.ts", "src/lib/detect.ts", "src/lib/targets.ts", "src/lib/convert.ts",
   "--outDir", outDir, "--module", "esnext", "--target", "es2023", "--moduleResolution", "bundler", "--skipLibCheck", "--lib", "es2023,dom", "--ignoreConfig"],
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

const opt = { provider: "codex", canonical: true, disabled: false, fillClaudeDeviceId: true };
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
  console.log(`  ${r.fileName.padEnd(48)} ${r.status.padEnd(5)} ${r.message}`);
}

const by = Object.fromEntries(rows.map((r) => [r.fileName.split(".")[0].replace(/^[a-z]+-/, (m) => m), r]));
const find = (pred) => rows.find(pred);

const codex = find((r) => r.format === "codex");
expect(codex?.status === "ok", "codex 转换成功");
expect(/^codex-[0-9a-f]{8}-demo@openai\.test-plus\.json$/.test(codex.fileName), "codex 文件名 = codex-<hash8>-<email>-plus.json, got " + codex.fileName);
const codexJson = JSON.parse(codex.result.content);
expect(codexJson.type === "codex", "codex 写入 type=codex");
expect(codexJson.account_id === "acct-1234567890", "codex account_id 取自 JWT");
expect(codexJson.plan_type === "Plus", "codex plan_type=Plus");
expect(typeof codexJson.expired === "string" && codexJson.expired.includes("T"), "codex expired 为 RFC3339");

const claude = find((r) => r.format === "claude");
expect(claude?.target === "claude", "claude 识别为目标 claude");
expect(/^claude-[0-9a-f]{8}-dev@anthropic\.test\.json$/.test(claude.fileName), "claude 文件名 = claude-<hash8>-<email>.json, got " + claude.fileName);
const claudeJson = JSON.parse(claude.result.content);
expect(claudeJson.type === "claude", "claude 写入 type=claude");
expect(Array.isArray(claudeJson.claude_device_ids) && /^[0-9a-f]{64}$/.test(claudeJson.claude_device_ids[0]), "claude 设备指纹 64 hex");
expect(claudeJson.organization_uuid === "org-uuid-1", "claude organization_uuid 来自 JWT");
expect(/^\d{4}-\d{2}-\d{2}T/.test(claudeJson.expired), "claude expired 转为 RFC3339, got " + claudeJson.expired);

const antigravity = find((r) => r.format === "antigravity");
expect(antigravity?.fileName === "antigravity-gg@google.test.json", "antigravity 文件名 = antigravity-<email>.json");
const agJson = JSON.parse(antigravity.result.content);
expect(agJson.type === "antigravity" && agJson.project_id === "demo-project-123", "antigravity 含 type/project_id");
expect(typeof agJson.timestamp === "number" && typeof agJson.expired === "string", "antigravity 含 timestamp/expired");

const gemini = find((r) => r.format === "gemini");
expect(gemini?.fileName === "gemini-gg@google.test.json", "gemini 文件名, got " + gemini?.fileName);
expect(JSON.parse(gemini.result.content).type === "gemini-cli", "gemini 写入 type=gemini-cli");

const other = find((r) => r.format === "unknown");
expect(other?.status === "error", "未知结构报错（提示手动选择）");

const cpa = find((r) => r.format === "cliproxy");
expect(cpa?.status === "warn", "已是 CLIProxyAPI 格式 → 跳过");

// canonical=false 时保留原生嵌套结构
const native = await convertAll(files, { ...opt, canonical: false });
const nativeCodex = native.find((r) => r.format === "codex");
expect(!!JSON.parse(nativeCodex.result.content).tokens, "非 canonical 时保留 tokens 嵌套");
const nativeClaude = native.find((r) => r.format === "claude");
expect(!!JSON.parse(nativeClaude.result.content).claudeAiOauth, "非 canonical 时保留 claudeAiOauth");

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
