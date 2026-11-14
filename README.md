# CLIProxyAPI · OAuth Converter

Turn the OAuth files of CLI agents (Antigravity / Codex / Claude Code / Gemini CLI / xAI Grok / Kimi / Meta Muse / Devin) into JSON that [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) reads straight from its `auths/` directory.

界面支持 **Tiếng Việt / 中文 / English**，深色 / 浅色主题，纯前端（React + Vite），凭据不经过任何服务器。

> Live: https://6zev.github.io/cliproxyapi-oauh-converter/

## 解决什么问题

直接把 OAuth 文件丢进 CLIProxyAPI：Provider 显示成 `other`、文件名是一串随机串。原因（上游 v8 源码）：

| 位置 | 行为 |
| --- | --- |
| `internal/watcher/synthesizer/file.go` | `provider := strings.ToLower(metadata["type"])`，缺失即留空 → 渲染成 `other`；`gemini` 会被改写成 `gemini-cli` |
| `internal/auth/antigravity/filename.go` | `antigravity-<email>.json` |
| `internal/auth/codex/filename.go` | `codex-<sha256(account_id)[:8]>-<email>-<plan>.json` |
| `internal/auth/claude/filename.go` | `claude-<sha256(org_uuid 或 account_uuid)[:8]>-<email>.json` |
| `internal/auth/xai/filename.go` | `xai-<email>-<sha256("email\0"+email)[:8]>`（8 字节 hash） |
| `internal/auth/claude/identity.go` | `claude_device_ids` 必须是 64 位小写 hex |

## 支持的输入 → 输出

| 输入 | 输出 `type` |
| --- | --- |
| Codex CLI `~/.codex/auth.json`（`tokens.*`）、`credentials.*`、扁平结构 | `codex` |
| Claude Code `~/.claude/.credentials.json`（`claudeAiOauth`） | `claude` |
| Antigravity `oauth_creds.json`（`access_token` + `id_token` + `expiry_date`，无 email/project） | `antigravity` |
| Gemini CLI `oauth2` token | `gemini-cli` |
| xAI Grok / Kimi / Meta Muse / Devin 的导出文件 | `xai` / `kimi` / `kimi-ai` / `meta` / `devin` |
| 已经是 CLIProxyAPI 格式（type + 上游专属字段） | 跳过 |

识别优先看内容（JWT claims、`ya29.*`、`claudeAiOauth`、`tokens`、品牌关键字），文件名只作兜底；识别失败会提示手动选目标，不会静默生成垃圾文件。

## Antigravity 要点

真实 `oauth_creds.json` 长这样，**没有 email 和 project_id**：

```json
{ "access_token": "ya29...", "scope": "...", "token_type": "Bearer",
  "id_token": "eyJ...", "expiry_date": 1794655045605, "refresh_token": "1//..." }
```

本工具会：从 `id_token` 的 claims 取 email（`antigravity-<email>.json`）；把毫秒 `expiry_date` 转 RFC3339；补 `timestamp` / `expires_in`；`project_id` 缺省时不瞎填——CLIProxyAPI 首次请求会调 `loadCodeAssist` 自动获取，拿不到才报 `antigravity auth missing project_id`（此时手工补 `project_id`）。

### project_id 怎么来（无需手动）

参考 [AIClient2API](https://github.com/justlovemaki/AIClient2API) 的 `discoverProjectAndModels`，本工具会按顺序：

1. 文件里有 `project_id` → 直接用；
2. 浏览器直连 `POST v1internal:loadCodeAssist`（`daily-cloudcode-pa` → `cloudcode-pa` 回退），返回 `cloudaicompanionProject` 就用；
3. 没有则 `v1internal:onboardUser` 轮询，取 `operation.response.cloudaicompanionProject.id`；
4. 仍然失败（CORS / 网络 / 账号无资格）→ 生成同形态占位 ID `<adj>-<noun>-<5 位>`（与 AIClient2API 的 `generateProjectID` 一致）。

请求不成功不会阻塞转换，只在结果里留 `pid_source` 和一条提示。「自动获取 project_id」开关可关闭；也可在输入框里手填覆盖。

另有一个可选开关 **「Antigravity: bake v1/<JWT>.<sig>」**：Google 的 `ya29.*` 不是 JWT，部分只认 JWT 的网关读不到邮箱/过期时间；开启后会把 payload（`type/email/exp/iat/sub/azp`）烘成无签名 JWT，并把 `id_token` 头的 `kid` 拼在后面当签名前缀。不确定网关是否要求时保持关闭（保留原始 `ya29.*`）。

## 使用

```bash
npm install
npm run dev      # 本地开发
npm test         # Node 冒烟测试（tsc 编译 src/lib 后断言，无需浏览器）
npm run build    # 产出 dist/
npm run preview
```

页面：拖拽 / 多选 / 粘贴 JSON → 每行可改目标 provider → 单文件下载、打包 zip 或复制。

## 部署到 GitHub Pages

`.github/workflows/deploy.yml` 会在 push 到 `main` 时：装依赖 → `tsc -b` → 跑冒烟测试 → 构建（`BASE_PATH` 按仓库名自动注入）→ 生成 `404.html` → 部署。Settings → Pages → Source 选 **GitHub Actions** 即可。

## 目录

```
src/
  App.tsx            # 页面（含语言/主题切换）
  i18n.tsx           # zh / vi / en 三语字典（漏 key 会编译报错）
  lib/detect.ts      # 输入识别
  lib/parsers.ts     # 各 provider 字段抽取 + Antigravity JWT 烘焙
  lib/targets.ts     # 生成 CLIProxyAPI auth JSON
  lib/filename.ts    # 上游文件名规则
  lib/convert.ts     # 批量流水线
  lib/zip.ts         # 零依赖 zip
tests/run.mjs        # 冒烟测试
tests/fixtures/      # 各类型样例（假 token）
```

## 注意

生成的 JSON 含 `refresh_token`，等同账号密码：别提交到公开仓库，别贴 issue。
