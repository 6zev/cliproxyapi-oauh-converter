/** 浏览器端打包下载：单文件直出，多文件打 zip（STORE，无压缩、无依赖） */

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array<ArrayBuffer>;
}

/** 极简 ZIP writer（deflate=store），足够 GitHub Pages 静态站使用 */
export function makeZip(files: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const chunks: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  const dosTime = (() => {
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  })();

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    const local = new Uint8Array(new ArrayBuffer(30 + nameBytes.length));
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 flag
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, dosTime.time, true);
    lv.setUint16(12, dosTime.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, file.data);

    const cd = new Uint8Array(new ArrayBuffer(46 + nameBytes.length));
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime.time, true);
    cv.setUint16(14, dosTime.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + size;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(new ArrayBuffer(22));
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...(central as unknown as BlobPart[]), end as unknown as BlobPart], { type: "application/zip" });
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadFiles(files: { name: string; content: string }[], zipName = "cliproxyapi-auths.zip"): void {
  if (files.length === 0) return;
  if (files.length === 1) {
    downloadBlob(new Blob([files[0].content], { type: "application/json" }), files[0].name);
    return;
  }
  const used = new Map<string, number>();
  const entries = files.map((f) => {
    let name = f.name;
    const n = used.get(name) ?? 0;
    used.set(name, n + 1);
    if (n > 0) name = name.replace(/\.json$/i, `-${n}.json`);
    return { name, data: new TextEncoder().encode(f.content) };
  });
  downloadBlob(makeZip(entries), zipName);
}
