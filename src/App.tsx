import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertAll, type InputFile, type Row } from "./lib/convert";
import { TARGETS, type ConvertOptions, type TargetId } from "./lib/targets";
import { downloadFiles } from "./lib/zip";
import { nowRfc3339 } from "./lib/utils";

const DEFAULT_OPTIONS: ConvertOptions = {
  provider: "codex",
  canonical: true,
  disabled: false,
  fillClaudeDeviceId: true,
};

let seq = 0;
const nextId = () => `f${++seq}-${Date.now().toString(36)}`;

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export default function App() {
  const [files, setFiles] = useState<InputFile[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [options, setOptions] = useState<ConvertOptions>(DEFAULT_OPTIONS);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const runToken = useRef(0);

  const addFiles = useCallback(async (list: { name: string; text: string; size: number }[]) => {
    const next: InputFile[] = [];
    for (const f of list) {
      if (f.size > MAX_FILE_BYTES) continue;
      next.push({
        id: nextId(),
        name: f.name,
        size: f.size,
        text: f.text,
        target: "auto",
      });
    }
    if (next.length === 0) return;
    setFiles((prev) => [...prev, ...next]);
  }, []);

  const handleFileList = useCallback(
    async (list: FileList | null) => {
      if (!list) return;
      const arr = Array.from(list);
      const payload = await Promise.all(
        arr.map(async (file) => ({ name: file.name, text: await file.text(), size: file.size })),
      );
      await addFiles(payload);
    },
    [addFiles],
  );

  // 任意变化都重新跑一遍转换（纯本地、极快）
  useEffect(() => {
    const token = ++runToken.current;
    setBusy(true);
    convertAll(files, options)
      .then((res) => {
        if (token !== runToken.current) return;
        setRows(res);
      })
      .finally(() => {
        if (token === runToken.current) setBusy(false);
      });
  }, [files, options]);

  const ready = useMemo(() => rows.filter((r) => r.result), [rows]);
  const errorCount = rows.filter((r) => r.status === "error").length;
  const warnCount = rows.filter((r) => r.status === "warn").length;

  const setFileTarget = (id: string, target: TargetId | "auto") =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, target } : f)));

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (previewId === id) setPreviewId(null);
  };

  const clearAll = () => {
    setFiles([]);
    setRows([]);
    setPreviewId(null);
    setPasteText("");
  };

  const addPasted = () => {
    const text = pasteText.trim();
    if (!text) return;
    const chunks = splitPasted(text);
    if (chunks.length === 0) return;
    void addFiles(
      chunks.map((t, i) => ({
        name: `pasted-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${i + 1}.json`,
        text: t,
        size: new Blob([t]).size,
      })),
    );
    setPasteText("");
  };

  const copy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1400);
    } catch {
      setCopied(null);
    }
  };

  const preview = rows.find((r) => r.id === previewId && r.result) ?? ready[0] ?? null;

  return (
    <div className="app">
      <header className="hero">
        <h1>CLIProxyAPI · OAuth 凭据转换器</h1>
        <p>
          把 Antigravity / Codex / Claude Code / Gemini CLI 的 OAuth 文件，转成{" "}
          <a href="https://github.com/router-for-me/CLIProxyAPI" target="_blank" rel="noreferrer">
            CLIProxyAPI
          </a>{" "}
          <code>auths/</code> 目录能直接吃下的 JSON：补上 <code>type</code> 字段、按上游规则命名文件（<code>&lt;provider&gt;-&lt;email&gt;.json</code>），
          不再被后台识别成 <code>other</code>。全部在浏览器本地完成，不出网、不上传。
        </p>
        <div className="badges">
          <span className="badge">纯前端 · GitHub Pages 可用</span>
          <span className="badge">零依赖打包 zip</span>
          <span className="badge">批量拖拽 / 粘贴</span>
          <span className="badge">文件名对齐上游 filename.go</span>
        </div>
      </header>

      <section className="card">
        <h2>
          <span className="idx">1</span>导入凭据文件
        </h2>
        <div
          className={`dropzone${dragActive ? " active" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            void handleFileList(e.dataTransfer.files);
          }}
        >
          <div>
            拖拽 <strong>.json</strong> 文件到这里，或<strong>点击选择</strong>
          </div>
          <div className="sub">
            支持 auth.json（Codex）、.credentials.json（Claude Code）、antigravity oauth_creds.json、gemini oauth2 token 导出；
            可多选、可混合
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            multiple
            hidden
            onChange={(e) => {
              void handleFileList(e.target.files);
              e.currentTarget.value = "";
            }}
          />
        </div>

        <div className="paste">
          <textarea
            placeholder='也可以直接粘贴一个或多个 JSON（多个对象用换行/连续 "}{" 分隔）'
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="toolbar">
            <button onClick={addPasted} disabled={!pasteText.trim()}>
              解析粘贴内容
            </button>
            <span className="spacer" />
            {files.length > 0 && (
              <button className="ghost" onClick={clearAll}>
                清空全部
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>
          <span className="idx">2</span>输出选项
        </h2>
        <div className="options">
          <Toggle
            label="写成 CLIProxyAPI 扁平结构"
            desc="关闭则保留 Codex auth.json / Claude Code 的原始嵌套结构（也能跑，但后台列表信息更少）"
            checked={options.canonical}
            onChange={(v) => setOptions((o) => ({ ...o, canonical: v }))}
          />
          <Toggle
            label="转换后默认禁用"
            desc="写入 disabled: true，先导入检查再在 WebUI 里手动启用"
            checked={options.disabled}
            onChange={(v) => setOptions((o) => ({ ...o, disabled: v }))}
          />
          <Toggle
            label="自动补 Claude 设备指纹"
            desc="缺少 claude_device_ids 时生成 1 个 64 位 hex（上游校验要求）"
            checked={options.fillClaudeDeviceId}
            onChange={(v) => setOptions((o) => ({ ...o, fillClaudeDeviceId: v }))}
          />
        </div>
      </section>

      <section className="card">
        <h2>
          <span className="idx">3</span>转换结果
        </h2>

        {files.length === 0 ? (
          <div className="empty">还没有导入文件</div>
        ) : (
          <>
            <div className="summary">
              <span>共 {files.length} 个文件</span>
              <span>
                <span className="dot ok" />
                可导出 {ready.length}
              </span>
              <span>
                <span className="dot warn" />
                有提醒 {warnCount}
              </span>
              <span>
                <span className="dot error" />
                失败 {errorCount}
              </span>
              {busy && <span>转换中…</span>}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 26 }} />
                    <th>源文件</th>
                    <th>识别</th>
                    <th>目标</th>
                    <th>输出文件名</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className={`dot ${row.status}`} />
                      </td>
                      <td>
                        <div className="cell-file">{sourceName(files, row.id)}</div>
                        <div className="cell-src">
                          {row.status === "error" ? row.message : row.status === "warn" ? row.message : "已转换"}
                        </div>
                        {row.warnings.length > 0 && (
                          <ul className="warn-list">
                            {row.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>
                        <span className={`pill ${row.formatConfidence}`}>{row.formatLabel}</span>
                      </td>
                      <td>
                        <select
                          value={row.userTarget}
                          onChange={(e) => setFileTarget(row.id, e.target.value as TargetId | "auto")}
                        >
                          <option value="auto">
                            自动{row.detectedTarget ? `（${row.detectedTarget}）` : "（未识别）"}
                          </option>
                          {TARGETS.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="cell-file">{row.fileName || "—"}</div>
                        {Object.entries(row.meta).length > 0 && (
                          <div className="cell-src">
                            {Object.entries(row.meta)
                              .map(([k, v]) => `${k}=${v}`)
                              .join(" · ")}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="actions">
                          <button disabled={!row.result} onClick={() => setPreviewId(row.id)}>
                            预览
                          </button>
                          <button
                            disabled={!row.result}
                            onClick={() => row.result && void copy(row.id, row.result.content)}
                          >
                            {copied === row.id ? "已复制" : "复制"}
                          </button>
                          <button
                            disabled={!row.result}
                            onClick={() => row.result && downloadFiles([{ name: row.fileName, content: row.result.content }])}
                          >
                            下载
                          </button>
                          <button className="icon-btn" title="移除" onClick={() => removeFile(row.id)}>
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="toolbar">
              <button
                className="primary"
                disabled={ready.length === 0}
                onClick={() =>
                  downloadFiles(ready.map((r) => ({ name: r.fileName, content: r.result!.content })), "cliproxyapi-auths.zip")
                }
              >
                {ready.length > 1 ? `打包下载 ${ready.length} 个文件` : "下载转换结果"}
              </button>
              <button
                disabled={ready.length === 0}
                onClick={async () => {
                  for (const r of ready) await copy(r.id + "-all", r.result!.content);
                  setCopied("bulk");
                  setTimeout(() => setCopied((c) => (c === "bulk" ? null : c)), 1500);
                }}
              >
                {copied === "bulk" ? "已复制全部" : "复制全部 JSON"}
              </button>
              <button
                className="ghost"
                disabled={ready.length === 0}
                onClick={async () => {
                  try {
                    await copy("x", serializeAll(ready));
                    setCopied("bundle");
                    setTimeout(() => setCopied((c) => (c === "bundle" ? null : c)), 1500);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                {copied === "bundle" ? "已复制" : "复制为单文件 bundle"}
              </button>
            </div>
          </>
        )}
      </section>

      {preview?.result && (
        <section className="card">
          <h2>
            <span className="idx">4</span>输出预览
          </h2>
          <div className="preview-head">
            <span className="pill target">{preview.target}</span>
            <span className="name">{preview.fileName}</span>
            <span className="muted">· {new Blob([preview.result.content]).size} bytes</span>
            <span className="spacer" />
            <button onClick={() => void copy(preview.id, preview.result!.content)}>
              {copied === preview.id ? "已复制" : "复制"}
            </button>
          </div>
          <pre>{preview.result.content}</pre>
        </section>
      )}

      <section className="card">
        <h2>
          <span className="idx">?</span>导入 CLIProxyAPI
        </h2>
        <ol className="steps">
          <li>
            解压得到的 <code>.json</code> 全部丢进 auths 目录（默认 <code>~/.cli-proxy-api</code>，或你在 <code>config.yaml</code> 里配置的{" "}
            <code>auth-dir</code>）
          </li>
          <li>
            文件监听会自动加载；也可以重启 <code>cli-proxy-api</code>，或在 WebUI / 管理接口里点“刷新凭据”
          </li>
          <li>
            列表里的 Provider 应该显示为 <code>codex</code> / <code>claude</code> / <code>antigravity</code> / <code>gemini-cli</code>，
            不再是 <code>other</code>
          </li>
        </ol>
        <p className="footnote">
          为什么之前会变成 other：上游 <code>internal/watcher/synthesizer/file.go</code> 里 provider 直接取自 JSON 的{" "}
          <code>"type"</code> 字段（或文件名约定的前缀），拿不到就保留空值 → 后台展示成 other。本工具会显式写入{" "}
          <code>type</code>，并按上游 <code>internal/auth/*/filename.go</code> 的规则生成文件名：Codex 用{" "}
          <code>codex-&lt;sha256(account_id)[:8]&gt;-&lt;email&gt;-&lt;plan&gt;.json</code>，Claude 用{" "}
          <code>claude-&lt;sha256(org_uuid)[:8]&gt;-&lt;email&gt;.json</code>，Antigravity 用{" "}
          <code>antigravity-&lt;email&gt;.json</code>——所以文件名天然带邮箱，不再是随机串。
        </p>
      </section>

      <p className="footnote">
        所有转换都在你的浏览器里完成，凭据不会离开本机。生成的 JSON 含 refresh_token，请勿上传到公开仓库。生成时间戳：
        <code>{nowRfc3339()}</code>（仅展示）
      </p>
    </div>
  );
}

function sourceName(files: InputFile[], id: string): string {
  return files.find((f) => f.id === id)?.name ?? "—";
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="label">{label}</span>
        <br />
        <span className="desc">{desc}</span>
      </span>
    </label>
  );
}

/** 连续 JSON 流切分：按大括号深度切，忽略字符串里的括号 */
function splitPasted(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  if (out.length === 0 && text.trim()) return [text.trim()];
  return out.filter((s) => {
    try {
      JSON.parse(s);
      return true;
    } catch {
      return false;
    }
  });
}

/** 合并成 CLIProxyAPI 支持的 “auths 数组 / 对象” bundle 形式，方便整块粘贴 */
function serializeAll(rows: Row[]): string {
  return JSON.stringify(
    {
      $comment: "CLIProxyAPI 不支持把多个凭据塞进一个文件，请按文件拆分；此处仅供备份/粘贴到 WebUI 的单文件导入",
      auths: rows.map((r) => ({ fileName: r.fileName, auth: JSON.parse(r.result!.content) })),
    },
    null,
    2,
  );
}
