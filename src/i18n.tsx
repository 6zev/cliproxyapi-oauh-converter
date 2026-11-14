/**
 * 三语 i18n：zh（简体中文）/ vi（Tiếng Việt）/ en（English）。
 * 类型从 zh 字典推导，任何语言漏 key 都会编译报错。
 */
import { createContext, useContext } from "react";

export const LOCALES = ["zh", "vi", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABEL: Record<Locale, string> = {
  zh: "中文",
  vi: "Tiếng Việt",
  en: "English",
};

const zh = {
  appTitle: "CLIProxyAPI · OAuth 凭据转换器",
  heroLead:
    "把 Antigravity / Codex / Claude Code / Gemini CLI / xAI Grok / Kimi / Meta Muse / Devin 的 OAuth 文件，转成 CLIProxyAPI auths/ 目录能直接读的 JSON：补上 type 字段、按上游规则命名文件，不再被后台识别成 other，文件名也不再是随机串。",
  heroLocal: "全部在浏览器本地完成，凭据不会出网。",
  badgePages: "纯前端 · GitHub Pages 可用",
  badgeZip: "零依赖打包 zip",
  badgeBatch: "批量拖拽 / 粘贴",
  badgeNaming: "文件名对齐上游 filename.go",
  badgeProviders: "9 个 provider",

  step1: "导入凭据文件",
  dropMain: "拖拽 .json 文件到这里，或点击选择",
  dropSub:
    "支持 auth.json、.credentials.json、oauth_creds.json、gemini oauth2、xai/kimi/meta/devin 导出；可多选、可混合",
  pastePlaceholder: '也可以直接粘贴一个或多个 JSON（多个对象用换行或连续 "}{" 分隔）',
  pasteParse: "解析粘贴内容",
  clearAll: "清空全部",

  step2: "输出选项",
  optCanonical: "写成 CLIProxyAPI 扁平结构",
  optCanonicalDesc: "关闭则保留 Codex / Claude Code 的原始嵌套结构（也能跑，但后台列表信息更少）",
  optDisabled: "转换后默认禁用",
  optDisabledDesc: "写入 disabled: true，先导入检查再在 WebUI 里手动启用",
  optDeviceId: "自动补 Claude 设备指纹",
  optDeviceIdDesc: "缺少 claude_device_ids 时生成 1 个 64 位 hex（上游校验要求）",
  optAntigravityJwt: "Antigravity：烘成 v1/<JWT>.<sig>",
  optAntigravityJwtDesc: "Google 的 ya29.* 不是 JWT，部分网关读不到邮箱/过期时间；开启后用 id_token 的 kid 拼签名前缀",

  step3: "转换结果",
  noFiles: "还没有导入文件",
  summaryTotal: (n: number) => `共 ${n} 个文件`,
  summaryReady: (n: number) => `可导出 ${n}`,
  summaryWarn: (n: number) => `有提醒 ${n}`,
  summaryError: (n: number) => `失败 ${n}`,
  converting: "转换中…",
  colSource: "源文件",
  colDetected: "识别",
  colTarget: "目标",
  colOutput: "输出文件名",
  colActions: "操作",
  autoOption: (hint: string) => (hint ? `自动（${hint}）` : "自动（未识别）"),
  actPreview: "预览",
  actCopy: "复制",
  actCopied: "已复制",
  actDownload: "下载",
  actRemove: "移除",
  downloadOne: "下载转换结果",
  downloadZip: (n: number) => `打包下载 ${n} 个文件`,
  copyAll: "复制全部 JSON",
  copiedAll: "已复制全部",
  copyBundle: "复制为单文件 bundle",
  statusOk: "已转换",
  statusWarn: "已转换（有提醒）",

  step4: "输出预览",
  bytes: (n: number) => `${n} bytes`,

  guideTitle: "导入 CLIProxyAPI",
  guide1a: "解压得到的 .json 全部丢进 auths 目录（默认",
  guide1b: "，或你在 config.yaml 里配置的 auth-dir）",
  guide2: "文件监听会自动加载；也可以重启 cli-proxy-api，或在 WebUI / 管理接口里刷新凭据",
  guide3a: "列表里的 Provider 应显示为",
  guide3b: "，不再是 other",
  whyTitle: "为什么之前会变成 other、文件名还是随机串",
  whyBody:
    '上游 internal/watcher/synthesizer/file.go 里 provider 直接取自 JSON 的 "type" 字段，缺失即留空 → 后台展示成 other。本工具显式写入 type，并按 internal/auth 下各 filename.go 的规则命名：Codex 用 codex-<sha256(account_id)[:8]>-<email>-<plan>.json，Claude 用 claude-<sha256(org_uuid)[:8]>-<email>.json，Antigravity 用 antigravity-<email>.json，xAI 用 xai-<email>-<sha256[:8]>.json。',
  antigravityNoteTitle: "Antigravity 常见报错对照",
  antigravityNote:
    "antigravity auth missing project_id：账号没在 Antigravity 里建过项目，CLIProxyAPI 首次请求会调 loadCodeAssist 自动获取；仍失败就手工在 JSON 里补 project_id。401 / 几分钟就过期：access_token 是 ya29.* 不是 JWT，开启上面的「烘成 v1/<JWT>.<sig>」再试。",
  footerWarn: "生成的 JSON 含 refresh_token，等同账号密码，别提交到公开仓库。",
  langLabel: "语言",
  themeLabel: "主题",
  themeDark: "深色",
  themeLight: "浅色",
} as const;

type DictShape = typeof zh;
export type TFunction = { [K in keyof DictShape]: DictShape[K] extends (...a: infer A) => string ? (...a: A) => string : string };
type Dict = TFunction;

const vi: Dict = {
  appTitle: "CLIProxyAPI · Trình chuyển đổi OAuth",
  heroLead:
    "Chuyển file OAuth của Antigravity / Codex / Claude Code / Gemini CLI / xAI Grok / Kimi / Meta Muse / Devin thành JSON mà thư mục auths/ của CLIProxyAPI đọc được ngay: có trường type, tên file đúng quy tắc upstream, không còn bị nhận thành other và tên file không còn là chuỗi ngẫu nhiên.",
  heroLocal: "Toàn bộ xử lý trong trình duyệt, thông tin đăng nhập không rời khỏi máy bạn.",
  badgePages: "Thuần frontend · chạy trên GitHub Pages",
  badgeZip: "Đóng gói zip không cần thư viện",
  badgeBatch: "Kéo thả / dán hàng loạt",
  badgeNaming: "Tên file khớp filename.go của upstream",
  badgeProviders: "9 provider",

  step1: "Nhập file thông tin đăng nhập",
  dropMain: "Kéo thả file .json vào đây, hoặc bấm để chọn",
  dropSub:
    "Hỗ trợ auth.json, .credentials.json, oauth_creds.json, gemini oauth2, bản export xai/kimi/meta/devin; chọn nhiều file và trộn nhiều loại cùng lúc",
  pastePlaceholder: 'Hoặc dán trực tiếp một hay nhiều JSON (nhiều object cách nhau bằng xuống dòng hoặc "}{")',
  pasteParse: "Phân tích nội dung dán",
  clearAll: "Xoá tất cả",

  step2: "Tuỳ chọn đầu ra",
  optCanonical: "Ghi theo cấu trúc phẳng của CLIProxyAPI",
  optCanonicalDesc:
    "Tắt để giữ cấu trúc lồng nhau gốc của Codex / Claude Code (vẫn chạy được, nhưng danh sách trong WebUI ít thông tin hơn)",
  optDisabled: "Mặc định tắt sau khi chuyển",
  optDisabledDesc: "Ghi disabled: true, import rồi kiểm tra sau đó bật thủ công trong WebUI",
  optDeviceId: "Tự sinh device fingerprint cho Claude",
  optDeviceIdDesc: "Thiếu claude_device_ids thì tạo 1 chuỗi hex 64 ký tự (upstream bắt buộc)",
  optAntigravityJwt: "Antigravity: đóng gói thành v1/<JWT>.<sig>",
  optAntigravityJwtDesc:
    "Token ya29.* của Google không phải JWT nên một số gateway không đọc được email/hạn dùng; bật để ghép tiền tố chữ ký từ kid của id_token",

  step3: "Kết quả chuyển đổi",
  noFiles: "Chưa có file nào",
  summaryTotal: (n: number) => `Tổng ${n} file`,
  summaryReady: (n: number) => `Xuất được ${n}`,
  summaryWarn: (n: number) => `Có cảnh báo ${n}`,
  summaryError: (n: number) => `Lỗi ${n}`,
  converting: "Đang chuyển…",
  colSource: "File nguồn",
  colDetected: "Nhận diện",
  colTarget: "Đích",
  colOutput: "Tên file đầu ra",
  colActions: "Thao tác",
  autoOption: (hint: string) => (hint ? `Tự động (${hint})` : "Tự động (chưa nhận diện)"),
  actPreview: "Xem trước",
  actCopy: "Sao chép",
  actCopied: "Đã chép",
  actDownload: "Tải về",
  actRemove: "Xoá",
  downloadOne: "Tải kết quả",
  downloadZip: (n: number) => `Đóng gói ${n} file`,
  copyAll: "Chép toàn bộ JSON",
  copiedAll: "Đã chép tất cả",
  copyBundle: "Chép thành một bundle",
  statusOk: "Đã chuyển",
  statusWarn: "Đã chuyển (có cảnh báo)",

  step4: "Xem trước đầu ra",
  bytes: (n: number) => `${n} bytes`,

  guideTitle: "Đưa vào CLIProxyAPI",
  guide1a: "Giải nén, chép tất cả .json vào thư mục auths (mặc định",
  guide1b: ", hoặc auth-dir bạn cấu hình trong config.yaml)",
  guide2:
    "Bộ theo dõi file sẽ tự nạp; hoặc khởi động lại cli-proxy-api, hoặc làm mới thông tin trong WebUI / management API",
  guide3a: "Cột Provider phải hiển thị",
  guide3b: ", không còn là other",
  whyTitle: "Vì sao trước đây thành other và tên file ngẫu nhiên",
  whyBody:
    'Trong upstream internal/watcher/synthesizer/file.go, provider lấy thẳng từ trường "type" của JSON; thiếu là để rỗng nên hiện ra other. Công cụ này ghi rõ type và đặt tên theo từng filename.go trong internal/auth: Codex dùng codex-<sha256(account_id)[:8]>-<email>-<plan>.json, Claude dùng claude-<sha256(org_uuid)[:8]>-<email>.json, Antigravity dùng antigravity-<email>.json, xAI dùng xai-<email>-<sha256[:8]>.json.',
  antigravityNoteTitle: "Các lỗi Antigravity thường gặp",
  antigravityNote:
    "antigravity auth missing project_id: tài khoản chưa từng tạo project trong Antigravity; CLIProxyAPI sẽ gọi loadCodeAssist để tự lấy ở request đầu tiên. Nếu vẫn lỗi, điền tay project_id vào JSON. 401 / hết hạn sau vài phút: access_token là ya29.* chứ không phải JWT, hãy bật tuỳ chọn đóng gói v1/<JWT>.<sig> ở trên rồi thử lại.",
  footerWarn:
    "File JSON sinh ra chứa refresh_token, tương đương mật khẩu tài khoản — đừng đưa lên repository công khai.",
  langLabel: "Ngôn ngữ",
  themeLabel: "Giao diện",
  themeDark: "Tối",
  themeLight: "Sáng",
};

const en: Dict = {
  appTitle: "CLIProxyAPI · OAuth Converter",
  heroLead:
    "Turn Antigravity / Codex / Claude Code / Gemini CLI / xAI Grok / Kimi / Meta Muse / Devin OAuth files into JSON that CLIProxyAPI's auths/ directory reads directly: explicit type field, upstream-compatible filenames — no more other, no more random filenames.",
  heroLocal: "Everything runs in your browser; credentials never leave this machine.",
  badgePages: "Client-side · GitHub Pages ready",
  badgeZip: "Zero-dependency zip export",
  badgeBatch: "Batch drag & drop / paste",
  badgeNaming: "Filenames match upstream filename.go",
  badgeProviders: "9 providers",

  step1: "Import credential files",
  dropMain: "Drag .json files here, or click to browse",
  dropSub:
    "Supports auth.json, .credentials.json, oauth_creds.json, gemini oauth2, xai/kimi/meta/devin exports; multiple and mixed files are fine",
  pastePlaceholder: 'Or paste one or more JSON objects (separate them with newlines or back-to-back "}{")',
  pasteParse: "Parse pasted text",
  clearAll: "Clear all",

  step2: "Output options",
  optCanonical: "Write CLIProxyAPI flat structure",
  optCanonicalDesc:
    "Off keeps the native Codex / Claude Code nesting (still works, less info in the backend list)",
  optDisabled: "Disable after conversion",
  optDisabledDesc: "Writes disabled: true so you can inspect before enabling in the WebUI",
  optDeviceId: "Auto-fill Claude device fingerprint",
  optDeviceIdDesc: "Generates one 64-char hex value when claude_device_ids is missing (required upstream)",
  optAntigravityJwt: "Antigravity: bake v1/<JWT>.<sig>",
  optAntigravityJwtDesc:
    "Google's ya29.* is not a JWT, so some gateways cannot read email/expiry; this rebuilds the JWT and appends the id_token kid as signature prefix",

  step3: "Results",
  noFiles: "No files imported yet",
  summaryTotal: (n: number) => `${n} files`,
  summaryReady: (n: number) => `${n} exportable`,
  summaryWarn: (n: number) => `${n} with warnings`,
  summaryError: (n: number) => `${n} failed`,
  converting: "Converting…",
  colSource: "Source",
  colDetected: "Detected",
  colTarget: "Target",
  colOutput: "Output filename",
  colActions: "Actions",
  autoOption: (hint: string) => (hint ? `Auto (${hint})` : "Auto (not detected)"),
  actPreview: "Preview",
  actCopy: "Copy",
  actCopied: "Copied",
  actDownload: "Download",
  actRemove: "Remove",
  downloadOne: "Download result",
  downloadZip: (n: number) => `Download ${n} files as zip`,
  copyAll: "Copy all JSON",
  copiedAll: "All copied",
  copyBundle: "Copy as single bundle",
  statusOk: "Converted",
  statusWarn: "Converted (with warnings)",

  step4: "Output preview",
  bytes: (n: number) => `${n} bytes`,

  guideTitle: "Load into CLIProxyAPI",
  guide1a: "Drop every generated .json into the auths directory (default",
  guide1b: ", or the auth-dir set in config.yaml)",
  guide2:
    "The file watcher picks them up; or restart cli-proxy-api, or refresh credentials in the WebUI / management API",
  guide3a: "The Provider column should read",
  guide3b: ", not other",
  whyTitle: "Why it used to show other with a random filename",
  whyBody:
    'Upstream internal/watcher/synthesizer/file.go derives the provider straight from the JSON "type" field; when it is missing the value stays empty and the backend renders other. This tool writes type explicitly and follows each filename.go under internal/auth: Codex codex-<sha256(account_id)[:8]>-<email>-<plan>.json, Claude claude-<sha256(org_uuid)[:8]>-<email>.json, Antigravity antigravity-<email>.json, xAI xai-<email>-<sha256[:8]>.json.',
  antigravityNoteTitle: "Common Antigravity errors",
  antigravityNote:
    "antigravity auth missing project_id: the account never created an Antigravity project; CLIProxyAPI calls loadCodeAssist on the first request to fetch one. If it still fails, set project_id manually in the JSON. 401 / expires after a few minutes: the access_token is ya29.*, not a JWT — enable the bake option above and retry.",
  footerWarn: "Generated JSON contains refresh_token — it is as sensitive as a password. Never commit it.",
  langLabel: "Language",
  themeLabel: "Theme",
  themeDark: "Dark",
  themeLight: "Light",
};

export const DICTS: Record<Locale, Dict> = { zh, vi, en };

/** 让 vi / en 也只校验 key 与签名，不锁死字面量 */
const _checkVi: Dict = vi satisfies Dict;
const _checkEn: Dict = en;
void _checkVi;
void _checkEn;

export interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFunction;
}

export const I18nContext = createContext<I18nContextValue>({
  locale: "vi",
  setLocale: () => {},
  t: zh,
});

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "vi";
  const saved = typeof localStorage !== "undefined" ? localStorage.getItem("cpa-locale") : null;
  if (saved === "zh" || saved === "vi" || saved === "en") return saved;
  const langs = [navigator.language, ...(navigator.languages ?? [])].map((l) => l.toLowerCase());
  for (const l of langs) {
    if (l.startsWith("vi")) return "vi";
    if (l.startsWith("zh")) return "zh";
    if (l.startsWith("en")) return "en";
  }
  return "vi";
}
