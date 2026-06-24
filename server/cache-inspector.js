const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const user = process.env.POPO_USER || "sunbin05@corp.netease.com";
const localPopoRoot = path.join(process.env.LOCALAPPDATA || "", "netease", "popo");
const userRoot = path.join(localPopoRoot, "users", user);
const outputDir = path.join(__dirname, "state");
const outputFile = path.join(outputDir, "cache-inspection.json");

const scanRoots = [
  userRoot,
  path.join(process.env.APPDATA || "", "MyPopo"),
  path.join(process.env.USERPROFILE || "", "Documents", "我的POPO")
];

const messageKeywordBytes = [
  Buffer.from("message", "utf8"),
  Buffer.from("msg", "utf8"),
  Buffer.from("session", "utf8"),
  Buffer.from("chat", "utf8"),
  Buffer.from("H55", "utf8"),
  Buffer.from("报价", "utf8"),
  Buffer.from("人天", "utf8")
];

fs.mkdirSync(outputDir, { recursive: true });

const report = {
  generatedAt: new Date().toISOString(),
  user,
  roots: scanRoots.map((root) => ({ root, exists: fs.existsSync(root) })),
  directories: {},
  sqliteCandidates: [],
  wcdbCandidates: [],
  logCandidates: [],
  imageCandidates: [],
  attachmentCandidates: [],
  documentExportCandidates: [],
  recommendations: []
};

for (const root of scanRoots) {
  if (!fs.existsSync(root)) continue;
  scanRoot(root);
}

report.sqliteCandidates.sort(sortBySignal);
report.wcdbCandidates.sort(sortBySignal);
report.logCandidates.sort(sortBySignal);
report.imageCandidates.sort((a, b) => new Date(b.lastWriteTime) - new Date(a.lastWriteTime));
report.attachmentCandidates.sort((a, b) => new Date(b.lastWriteTime) - new Date(a.lastWriteTime));
report.documentExportCandidates.sort((a, b) => new Date(b.lastWriteTime) - new Date(a.lastWriteTime));

report.recommendations = buildRecommendations(report);

fs.writeFileSync(outputFile, JSON.stringify(report, null, 2), "utf8");
printSummary(report, outputFile);

function scanRoot(root) {
  const files = walk(root, 6, 20000);
  const extStats = {};
  let totalBytes = 0;
  let fileCount = 0;

  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase() || "(none)";
    extStats[ext] ||= { count: 0, bytes: 0 };
    extStats[ext].count += 1;
    extStats[ext].bytes += file.size;
    totalBytes += file.size;
    fileCount += 1;

    inspectFile(file);
  }

  report.directories[root] = {
    fileCount,
    totalBytes,
    extStats: Object.fromEntries(
      Object.entries(extStats)
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .slice(0, 30)
    )
  };
}

function inspectFile(file) {
  const lower = file.fullPath.toLowerCase();
  const ext = path.extname(file.name).toLowerCase();
  const header = readHeader(file.fullPath, 4096);
  const headerText = header.toString("utf8");
  const sqlite = header.subarray(0, 16).toString("utf8") === "SQLite format 3\u0000";
  const keywordHits = messageKeywordBytes
    .filter((keyword) => header.includes(keyword))
    .map((keyword) => keyword.toString("utf8"));
  const signal = scoreFile(file, sqlite, keywordHits);

  const baseInfo = {
    path: file.fullPath,
    name: file.name,
    size: file.size,
    lastWriteTime: file.mtime.toISOString(),
    ext,
    sha1Head: hash(header),
    keywordHits,
    signal
  };

  if (sqlite) {
    report.sqliteCandidates.push({ ...baseInfo, kind: "sqlite" });
    return;
  }

  if (lower.includes(`${path.sep}wcdb${path.sep}`) || ext === ".wcdb" || ext === ".db") {
    report.wcdbCandidates.push({ ...baseInfo, kind: "wcdb-or-db", headerAscii: safeAscii(header) });
    return;
  }

  if ([".log", ".txt", ".json", ".dat"].includes(ext) || lower.includes(`${path.sep}log${path.sep}`)) {
    if (signal > 0 || file.size > 1024) {
      report.logCandidates.push({ ...baseInfo, kind: "log-or-text", preview: redactPreview(headerText) });
    }
  }

  if (isImageLike(file, header)) {
    report.imageCandidates.push({
      path: file.fullPath,
      name: file.name,
      size: file.size,
      lastWriteTime: file.mtime.toISOString(),
      ext,
      mime: detectMime(header),
      sha1Head: hash(header)
    });
  }

  if (isAttachmentLike(file)) {
    report.attachmentCandidates.push({
      path: file.fullPath,
      name: file.name,
      size: file.size,
      lastWriteTime: file.mtime.toISOString(),
      ext
    });
  }

  if (file.fullPath.includes(`${path.sep}我的POPO${path.sep}`)) {
    report.documentExportCandidates.push({
      path: file.fullPath,
      name: file.name,
      size: file.size,
      lastWriteTime: file.mtime.toISOString(),
      ext
    });
  }
}

function walk(root, maxDepth, maxFiles) {
  const result = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length && result.length < maxFiles) {
    const { dir, depth } = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) stack.push({ dir: fullPath, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(fullPath);
        result.push({ fullPath, name: entry.name, size: stat.size, mtime: stat.mtime });
      } catch {
        // Skip locked or transient files.
      }
    }
  }
  return result;
}

function readHeader(file, bytes) {
  try {
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(Math.min(bytes, fs.statSync(file).size));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    return buffer;
  } catch {
    return Buffer.alloc(0);
  }
}

function scoreFile(file, sqlite, keywordHits) {
  let score = 0;
  const lower = file.fullPath.toLowerCase();
  if (sqlite) score += 10;
  if (lower.includes("wcdb")) score += 5;
  if (lower.includes("msg") || lower.includes("message") || lower.includes("session") || lower.includes("chat")) score += 4;
  if (keywordHits.length) score += keywordHits.length * 3;
  if (file.size > 1024 * 1024) score += 1;
  if (file.mtime.getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000) score += 1;
  return score;
}

function isImageLike(file, header) {
  const ext = path.extname(file.name).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext) || Boolean(detectMime(header));
}

function detectMime(header) {
  if (header.length < 12) return "";
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (header.subarray(0, 6).toString("ascii").startsWith("GIF")) return "image/gif";
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (header.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  return "";
}

function isAttachmentLike(file) {
  const ext = path.extname(file.name).toLowerCase();
  return [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip", ".rar", ".7z", ".psd", ".ods"].includes(ext);
}

function sortBySignal(a, b) {
  return b.signal - a.signal || new Date(b.lastWriteTime) - new Date(a.lastWriteTime) || b.size - a.size;
}

function safeAscii(buffer) {
  return buffer.toString("latin1").replace(/[^\x20-\x7e]+/g, " ").slice(0, 160);
}

function redactPreview(text) {
  return text
    .replace(/[a-zA-Z0-9._%+-]+@(?:corp\.)?netease\.com/g, "[uid]")
    .replace(/[\u4e00-\u9fa5]{2,4}/g, "[cn]")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function hash(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 12);
}

function buildRecommendations(data) {
  const items = [];
  if (data.sqliteCandidates.length) {
    items.push("存在 SQLite 格式候选库，可以下一步复制到临时目录后读取表结构。");
  }
  if (data.wcdbCandidates.length) {
    items.push("存在大量 WCDB/DB 候选文件，优先按最近修改和 signal 分数定位消息库。");
  }
  if (data.imageCandidates.length) {
    items.push("图片缓存可用，后端可以增加 /api/local-assets/:id 静态代理用于前端预览。");
  }
  if (data.documentExportCandidates.length) {
    items.push("“我的POPO”目录可作为文件归档入口和附件反查补充源。");
  }
  items.push("建议下一步实现只读 SQLite/WCDB 表结构探测，不直接读取或输出完整聊天正文。");
  return items;
}

function printSummary(data, file) {
  const summary = {
    outputFile: file,
    roots: data.roots,
    sqliteCandidates: data.sqliteCandidates.length,
    wcdbCandidates: data.wcdbCandidates.length,
    logCandidates: data.logCandidates.length,
    imageCandidates: data.imageCandidates.length,
    attachmentCandidates: data.attachmentCandidates.length,
    documentExportCandidates: data.documentExportCandidates.length,
    topWcdbCandidates: data.wcdbCandidates.slice(0, 8).map((item) => ({
      name: item.name,
      size: item.size,
      lastWriteTime: item.lastWriteTime,
      signal: item.signal,
      keywordHits: item.keywordHits
    })),
    recentImages: data.imageCandidates.slice(0, 8).map((item) => ({
      name: item.name,
      size: item.size,
      lastWriteTime: item.lastWriteTime,
      mime: item.mime
    })),
    recommendations: data.recommendations
  };
  console.log(JSON.stringify(summary, null, 2));
}
