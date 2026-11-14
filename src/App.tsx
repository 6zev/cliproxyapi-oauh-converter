import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertAll, type InputFile, type Row } from "./lib/convert";
import { TARGETS, type ConvertOptions, type TargetId } from "./lib/targets";
import { downloadFiles } from "./lib/zip";
import {
  DICTS,
  I18nContext,
  LOCALES,
  LOCALE_LABEL,
  detectLocale,
  type Locale,
} from "./i18n";

const DEFAULT_OPTIONS: ConvertOptions = {
  provider: "codex",
  canonical: true,
  disabled: false,
  fillClaudeDeviceId: true,
  antigravityJwt: false,
  antigravityProjectMode: "auto",
  antigravityProjectId: "",
};

let seq = 0;
const nextId = () => `f${++seq}-${Date.now().toString(36)}`;

const MAX_FILE_BYTES = 2 * 1024 * 1024;

type Theme = "dark" | "light";

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => detectLocale());
  const [theme, setTheme] = useState<Theme>(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("cpa-theme") === "light" ? "light" : "dark",
  );
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

  const t = DICTS[locale];

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : locale;
    localStorage.setItem("cpa-locale", locale);
  }, [locale]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("cpa-theme", theme);
  }, [theme]);

  const addFiles = useCallback(async (list: { name: string; text: string; size: number }[]) => {
    const next: InputFile[] = [];
    for (const f of list) {
      if (f.size > MAX_FILE_BYTES) continue;
      next.push({ id: nextId(), name: f.name, size: f.size, text: f.text, target: "auto" });
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
    if (files.length === 0) {
      setRows([]);
      return;
    }
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
      chunks.map((chunk, i) => ({
        name: `pasted-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${i + 1}.json`,
        text: chunk,
        size: new Blob([chunk]).size,
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
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      <div className="app">
        <div className="topbar">
          <select
            aria-label={t.langLabel}
            title={t.langLabel}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABEL[l]}
              </option>
            ))}
          </select>
          <button
            className="ghost"
            aria-label={t.themeLabel}
            title={t.themeLabel}
            onClick={() => setTheme((v) => (v === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? `☾ ${t.themeDark}` : `☀ ${t.themeLight}`}
          </button>
        </div>

        <header className="hero">
          <h1>{t.appTitle}</h1>
          <p>
            {t.heroLead} <span className="muted">{t.heroLocal}</span>
          </p>
          <div className="badges">
            <span className="badge">{t.badgePages}</span>
            <span className="badge">{t.badgeZip}</span>
            <span className="badge">{t.badgeBatch}</span>
            <span className="badge">{t.badgeNaming}</span>
            <span className="badge">{t.badgeProviders}</span>
          </div>
        </header>

        <section className="card">
          <h2>
            <span className="idx">1</span>
            {t.step1}
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
            <div className="drop-main">{t.dropMain}</div>
            <div className="sub">{t.dropSub}</div>
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
              placeholder={t.pastePlaceholder}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <div className="toolbar">
              <button onClick={addPasted} disabled={!pasteText.trim()}>
                {t.pasteParse}
              </button>
              <span className="spacer" />
              {files.length > 0 && (
                <button className="ghost" onClick={clearAll}>
                  {t.clearAll}
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="card">
          <h2>
            <span className="idx">2</span>
            {t.step2}
          </h2>
          <div className="options">
            <Toggle
              label={t.optCanonical}
              desc={t.optCanonicalDesc}
              checked={options.canonical}
              onChange={(v) => setOptions((o) => ({ ...o, canonical: v }))}
            />
            <Toggle
              label={t.optDisabled}
              desc={t.optDisabledDesc}
              checked={options.disabled}
              onChange={(v) => setOptions((o) => ({ ...o, disabled: v }))}
            />
            <Toggle
              label={t.optDeviceId}
              desc={t.optDeviceIdDesc}
              checked={options.fillClaudeDeviceId}
              onChange={(v) => setOptions((o) => ({ ...o, fillClaudeDeviceId: v }))}
            />
            <Toggle
              label={t.optProjectAuto}
              desc={t.optProjectAutoDesc}
              checked={options.antigravityProjectMode === "auto"}
              onChange={(v) =>
                setOptions((o) => ({ ...o, antigravityProjectMode: v ? "auto" : "off" }))
              }
            />
            <Toggle
              label={t.optAntigravityJwt}
              desc={t.optAntigravityJwtDesc}
              checked={options.antigravityJwt}
              onChange={(v) => setOptions((o) => ({ ...o, antigravityJwt: v }))}
            />
            <label className="toggle">
              <span>
                <span className="label">{t.optProjectManual}</span>
                <br />
                <span className="desc">{t.optProjectManualDesc}</span>
                <input
                  type="text"
                  className="manual-input"
                  placeholder={t.projectManualPlaceholder}
                  value={options.antigravityProjectId}
                  onChange={(e) => setOptions((o) => ({ ...o, antigravityProjectId: e.target.value.trim() }))}
                />
              </span>
            </label>
          </div>
        </section>

        <section className="card">
          <h2>
            <span className="idx">3</span>
            {t.step3}
          </h2>

          {files.length === 0 ? (
            <div className="empty">{t.noFiles}</div>
          ) : (
            <>
              <div className="summary">
                <span>{t.summaryTotal(files.length)}</span>
                <span>
                  <span className="dot ok" />
                  {t.summaryReady(ready.length)}
                </span>
                <span>
                  <span className="dot warn" />
                  {t.summaryWarn(warnCount)}
                </span>
                <span>
                  <span className="dot error" />
                  {t.summaryError(errorCount)}
                </span>
                {busy && <span>{t.converting}</span>}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 26 }} />
                      <th>{t.colSource}</th>
                      <th>{t.colDetected}</th>
                      <th>{t.colTarget}</th>
                      <th>{t.colOutput}</th>
                      <th>{t.colActions}</th>
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
                            {row.status === "error"
                              ? localize(row.messageText, locale, row.message)
                              : row.status === "warn"
                                ? t.statusWarn
                                : t.statusOk}
                          </div>
                          {row.warnings.length > 0 && (
                            <ul className="warn-list">
                              {row.warnings.map((w, i) => (
                                <li key={i}>
                                  <span className="warn-zh">{w.zh}</span>
                                  <span className="warn-en">{w.en ?? w.zh}</span>
                                </li>
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
                            <option value="auto">{t.autoOption(row.detectedTarget ?? "")}</option>
                            {TARGETS.map((target) => (
                              <option key={target.id} value={target.id}>
                                {target.label}
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
                              {t.actPreview}
                            </button>
                            <button disabled={!row.result} onClick={() => row.result && void copy(row.id, row.result.content)}>
                              {copied === row.id ? t.actCopied : t.actCopy}
                            </button>
                            <button
                              disabled={!row.result}
                              onClick={() =>
                                row.result && downloadFiles([{ name: row.fileName, content: row.result.content }])
                              }
                            >
                              {t.actDownload}
                            </button>
                            <button className="icon-btn" title={t.actRemove} onClick={() => removeFile(row.id)}>
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
                    downloadFiles(
                      ready.map((r) => ({ name: r.fileName, content: r.result!.content })),
                      "cliproxyapi-auths.zip",
                    )
                  }
                >
                  {ready.length > 1 ? t.downloadZip(ready.length) : t.downloadOne}
                </button>
                <button
                  disabled={ready.length === 0}
                  onClick={async () => {
                    for (const r of ready) await copy(`${r.id}-all`, r.result!.content);
                    setCopied("bulk");
                    setTimeout(() => setCopied((c) => (c === "bulk" ? null : c)), 1500);
                  }}
                >
                  {copied === "bulk" ? t.copiedAll : t.copyAll}
                </button>
                <button
                  className="ghost"
                  disabled={ready.length === 0}
                  onClick={async () => {
                    await copy("bundle", serializeBundle(ready));
                    setCopied("bundle");
                    setTimeout(() => setCopied((c) => (c === "bundle" ? null : c)), 1500);
                  }}
                >
                  {copied === "bundle" ? t.actCopied : t.copyBundle}
                </button>
              </div>
            </>
          )}
        </section>

        {preview?.result && (
          <section className="card">
            <h2>
              <span className="idx">4</span>
              {t.step4}
            </h2>
            <div className="preview-head">
              <span className="pill target">{preview.target}</span>
              <span className="name">{preview.fileName}</span>
              <span className="muted">· {t.bytes(new Blob([preview.result.content]).size)}</span>
              <span className="spacer" />
              <button onClick={() => void copy(preview.id, preview.result!.content)}>
                {copied === preview.id ? t.actCopied : t.actCopy}
              </button>
            </div>
            <pre>{preview.result.content}</pre>
          </section>
        )}

        <section className="card">
          <h2>
            <span className="idx">?</span>
            {t.guideTitle}
          </h2>
          <ol className="steps">
            <li>
              {t.guide1a} <code>~/.cli-proxy-api</code>
              {t.guide1b}
            </li>
            <li>{t.guide2}</li>
            <li>
              {t.guide3a} <code>codex</code> / <code>claude</code> / <code>antigravity</code> /{" "}
              <code>gemini-cli</code> / <code>xai</code> / <code>kimi</code> / <code>meta</code> /{" "}
              <code>devin</code>
              {t.guide3b}
            </li>
          </ol>
          <details className="template-details">
            <summary>{t.whyTitle}</summary>
            <p className="footnote">{t.whyBody}</p>
          </details>
          <details className="template-details">
            <summary>{t.antigravityNoteTitle}</summary>
            <p className="footnote">{t.antigravityNote}</p>
          </details>
        </section>

        <p className="footnote">{t.footerWarn}</p>
      </div>
    </I18nContext.Provider>
  );
}

/** 双语文案选择：zh 界面用中文，其它（vi/en）优先英文 */
function localize(text: { zh: string; en?: string } | null, locale: Locale, fallback = ""): string {
  if (!text) return fallback;
  return locale === "zh" ? text.zh : (text.en ?? text.zh);
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

/** 合并成备份用的 bundle；CLIProxyAPI 不支持一个文件放多个凭据 */
function serializeBundle(rows: Row[]): string {
  return JSON.stringify(
    {
      $comment: "CLIProxyAPI 不支持把多个凭据塞进一个文件，请按文件拆分；此处仅供备份",
      auths: rows.map((r) => ({ fileName: r.fileName, auth: JSON.parse(r.result!.content) })),
    },
    null,
    2,
  );
}
