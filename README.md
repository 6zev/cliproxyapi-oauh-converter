# CLIProxyAPI · OAuth 凭据转换器

把各 CLI Agent 的 OAuth 凭据转成 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) `auths/` 目录可直接吃下的 JSON。

纯前端（React + Vite），可部署到 GitHub Pages，**凭据不经过任何服务器**。

## 解决什么问题

直接把 OAuth 文件丢进 CLIProxyAPI：

- 后台列表里 Provider 显示成 `other`；
- 文件名 / 标识是一串随机串，看不出是哪个账号。

原因（上游 v8 源码）：

| 位置 | 行为 |
| --- | --- |
| `internal/watcher/synthesizer/file.go` | `provider := strings.ToLower(metadata["type"])`，字段缺失 → 保留空值 → 展示成 `other`；`gemini` 会被重写成 `gemini-cli` |
| `internal/auth/antigravity/filename.go` | `antigravity-<email>.json` |
| `internal/auth/codex/filename.go` | `codex-<sha256(account_id)[:8]>-<email>-<plan>.json`（无 hash 时省略，无 plan 时省略） |
| `internal/auth/claude/filename.go` | `claude-<sha256(organization_uuid 或 account_uuid)[:8]>-<email>.json` |
| `internal/auth/claude/identity.go` | `claude_device_ids` 必须是 64 位小写 hex |

本工具按上面的规则补齐 `type`、按上游规则生成文件名，所以输出 `codex-4fa42ae6-user@example.com-plus.json` 这种名字，不是 `<random>-email.json`。

## 支持的输入 → 输出

| 输入 | 识别依据 | 输出 `type` |
| --- | --- | --- |
| Codex CLI `~/.codex/auth.json`（`tokens.{id_token,access_token,refresh_token,account_id}`） | 内容里的 `tokens` 对象 + 有 `id_token` | `codex` |
| Claude Code `~/.claude/.credentials.json`（`claudeAiOauth`） | 内容里的 `claudeAiOauth` | `claude` |
| Antigravity `oauth_creds.json` / 带 `token` 包装的 Google 凭据 | `access_token` + Google 特征 | `antigravity` |
| Gemini CLI `oauth2` token（`access_token` + `expiry_date`） | Google OAuth 特征 | `gemini-cli` |
| 扁平结构（`access_token` / `id_token` 混放） | JWT claims（`https://api.openai.com/auth`、`https://api.anthropic.com/oauth/*`）；**注意**：没带 `id_token` 且无其他特征的纯 `access_token` 会被判为 Gemini（因为 OpenAI 的 access_token 也是 RS256 JWT），此时用下拉框手动改目标 |
| 已经是 CLIProxyAPI 格式 | `type` 属于已知 provider | 跳过，提示无需转换 |

识别失败时会报错并提示手动选择目标 provider，不会静默生成垃圾文件。

## 使用

```bash
npm install
npm run dev        # 本地开发
npm run test       # 纯 Node 冒烟测试（不需要浏览器）
npm run build      # 产出 dist/
npm run preview
```

页面里：拖拽 / 多选 / 粘贴 JSON → 每行可单独改目标 provider → 打包下载 zip 或逐个复制。

### 输出选项

- **写成 CLIProxyAPI 扁平结构**（默认开）：写 `type` + 扁平字段。关掉则保留原生嵌套（Codex 的 `tokens`、Claude 的 `claudeAiOauth`），这两种上游也能读，只是后台列表信息更少。
- **转换后默认禁用**：写 `disabled: true`，导入 WebUI 后手动启用，避免误拉起账号。
- **自动补 Claude 设备指纹**：缺 `claude_device_ids` 时生成 1 个 64 位 hex。

### 导入 CLIProxyAPI

1. 解压出的 `.json` 全部放进 auths 目录（默认 `~/.cli-proxy-api`，或 `config.yaml` 里的 `auth-dir`）；
2. 文件监听会自动加载，或重启 `cli-proxy-api` / 在 WebUI 里刷新凭据；
3. Provider 列应显示 `codex` / `claude` / `antigravity` / `gemini-cli`。

## 部署到 GitHub Pages

仓库已带 `.github/workflows/deploy.yml`：

1. push 到 `main` / `master`；
2. Settings → Pages → Source 选 **GitHub Actions**；
3. workflow 会自动算 `BASE_PATH`（`<user>.github.io` 用 `/`，普通仓库用 `/<repo>/`），跑类型检查 + 冒烟测试 + 构建 + 部署。

本地手动构建同理：`BASE_PATH=/<repo>/ npm run build`。

## 目录

```
src/
  App.tsx            # 页面
  lib/detect.ts      # 输入识别（内容优先，文件名兜底）
  lib/parsers.ts     # 各 provider 字段抽取（含 JWT 解包）
  lib/targets.ts     # 生成 CLIProxyAPI auth JSON
  lib/filename.ts    # 上游文件名规则（sha256 前缀 + email + plan）
  lib/convert.ts     # 批量转换流水线
  lib/zip.ts         # 零依赖 zip 打包下载
tests/run.mjs        # tsc 编译 lib 后用 Node 跑断言
tests/fixtures/      # 各类型样例（内含假 token）
```

## 注意

生成的 JSON 含 `refresh_token`，等同于账号密码：不要提交到公开仓库，不要发群，不要贴 issue。
