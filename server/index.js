const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const config = readJson(path.join(__dirname, "config.json"));
const stateDir = path.join(__dirname, "state");
const stateFile = path.join(stateDir, "messages.json");
const popoCli = path.join(process.env.APPDATA || "", "npm", "node_modules", "@popo", "cli", "bin", "popo.js");

fs.mkdirSync(stateDir, { recursive: true });

const state = loadState();
const clients = new Set();
let isSyncing = false;
let lastSyncError = "";
let lastSyncAt = state.lastSyncAt || null;
let assetCache = { builtAt: 0, images: [], byId: new Map() };

const mentionAliases = ["@孙斌", "@sunbin", "@sunbin05", "@我"];
const projectKeywords = ["H55", "H74", "Joker", "角色", "动作", "场景", "美术", "外包", "报价群"];
const noisePatterns = ["好的", "好滴", "收到", "ok", "OK", "嗯嗯", "辛苦", "看下", "我们看下"];

const businessTagRules = [
  { tag: "报价", keywords: ["报价", "报价单", "报价表", "人天", "单价", "合计", "增补", "差异"] },
  { tag: "合同", keywords: ["合同", "电子签", "签署", "营业执照", "开户", "主体"] },
  { tag: "结算", keywords: ["结算", "结款", "发票", "扣款", "金额", "验收比例"] },
  { tag: "文件", keywords: ["文件", "图片", "截图", "附件", "上传", "资源"] },
  { tag: "流程", keywords: ["APC", "ArcoLab", "Muse", "QC", "任务", "单号", "OA"] },
  { tag: "排期", keywords: ["排期", "节点", "开始时间", "延期", "往前赶", "下周", "周五"] }
];

const riskRules = [
  {
    level: "高",
    title: "报价材料需要复核",
    keywords: ["报价", "报价单", "报价表", "人天", "合计", "图片", "截图", "确认"],
    suggestion: "确认报价表中是否有资源、数量、环节、人天、合计和对应截图。"
  },
  {
    level: "高",
    title: "人天或报价口径存在差异",
    keywords: ["有点高", "重新", "调整", "修改", "0.5", "1.45", "人天", "差异"],
    suggestion: "让内部对接人确认最终人天口径，并把差异原因写入报价记录。"
  },
  {
    level: "中",
    title: "排期或节点需要跟进",
    keywords: ["节点", "开始时间", "往前赶", "排期", "周五", "下周", "尽量"],
    suggestion: "补充明确交付时间、负责人和是否影响后续审核或结算。"
  },
  {
    level: "中",
    title: "资料或工具信息需要补齐",
    keywords: ["统计", "数量", "引擎", "离线版本", "名单", "权限"],
    suggestion: "确认统计用途，必要时补名单、工具版本、权限或供应商侧联系人。"
  },
  {
    level: "高",
    title: "合同/结算/归档前置风险",
    keywords: ["合同", "结算", "发票", "营业执照", "开户", "APC", "ArcoLab", "Muse"],
    suggestion: "先核对合同、APC 单、验收截图、结算金额和供应商资质材料。"
  }
];

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return sendCors(res, 204);
    if (req.url === "/api/health") return sendJson(res, healthPayload());
    if (req.url === "/api/groups") return sendJson(res, config.groups);
    if (req.url === "/api/messages") return sendJson(res, recentMessages());
    if (req.url === "/api/alerts") return sendJson(res, recentAlerts());
    if (req.url === "/api/queues") return sendJson(res, buildQueues());
    if (req.url === "/api/clusters") return sendJson(res, buildClusters());
    if (req.url === "/api/digest/today") return sendJson(res, buildTodayDigest());
    if (req.url.startsWith("/api/local-assets/")) return sendLocalAsset(req, res);
    if (req.url === "/api/sync-now" && (req.method === "POST" || req.method === "GET")) {
      const result = await syncNow("manual");
      return sendJson(res, result);
    }
    if (req.url === "/events") return openEvents(req, res);
    return sendJson(res, { error: "not_found" }, 404);
  } catch (error) {
    console.error(error.stack || error.message);
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, { error: error.message }, 500);
  }
});

server.listen(config.port, config.host, () => {
  console.log(`POPO assistant backend listening on http://${config.host}:${config.port}`);
  syncNow("startup");
  setInterval(() => syncNow("poll"), config.pollIntervalMs);
});

async function syncNow(reason) {
  if (isSyncing) return { ok: true, skipped: true, reason: "sync_in_progress" };
  isSyncing = true;
  lastSyncError = "";

  try {
    const now = Date.now();
    const timeStart = Math.max(startOfLocalDay(now), now - config.lookbackMinutes * 60 * 1000);
    const timeEnd = now + 60 * 1000;
    const messages = fetchPopoMessages(timeStart, timeEnd);
    let inserted = 0;
    let alertCount = 0;

    for (const message of messages) {
      if (!message.msg_id || state.messageIds[message.msg_id]) continue;
      const normalized = normalizeMessage(message);
      state.messageIds[normalized.msg_id] = true;
      state.messages.push(normalized);
      const alerts = analyzeMessage(normalized);
      state.alerts.push(...alerts);
      inserted += 1;
      alertCount += alerts.length;
    }

    trimState();
    lastSyncAt = new Date().toISOString();
    state.lastSyncAt = lastSyncAt;
    saveState();
    broadcast({ type: "sync", payload: { reason, inserted, alertCount, lastSyncAt } });
    return { ok: true, reason, inserted, alertCount, lastSyncAt };
  } catch (error) {
    lastSyncError = error.message;
    broadcast({ type: "error", payload: { message: error.message } });
    return { ok: false, error: error.message };
  } finally {
    isSyncing = false;
  }
}

function fetchPopoMessages(timeStart, timeEnd) {
  if (!fs.existsSync(popoCli)) {
    throw new Error(`未找到 popo-cli Node 入口：${popoCli}`);
  }

  const sessionList = JSON.stringify(config.groups.map((group) => group.id));
  const args = [
    popoCli,
    "popo",
    "message_search",
    "query=",
    "type=1",
    "page=0",
    "pageSize=80",
    "msgType=1",
    `sessionList=${sessionList}`,
    `timeStart=${timeStart}`,
    `timeEnd=${timeEnd}`
  ];

  const result = spawnSync(process.execPath, args, {
    cwd: rootDir,
    encoding: "utf8",
    timeout: 45000
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `popo-cli exited ${result.status}`).trim());
  }

  const payload = JSON.parse(result.stdout);
  const data = payload?.data?.data?.data?.data;
  if (!payload.ok || !data) {
    throw new Error(payload.message || "POPO 消息搜索返回格式异常");
  }

  return Array.isArray(data.result_list) ? data.result_list : [];
}

function normalizeMessage(message) {
  const content = sanitizeContent(message.content || "");
  const normalized = {
    msg_id: message.msg_id,
    t_msg: message.t_msg,
    time: new Date(message.t_msg).toISOString(),
    sender: message.memberName || message.nfrom || "未知成员",
    sender_uid: message.nfrom || "",
    group_id: message.session_id || message.nto || "",
    group_name: message.sessionName || groupName(message.session_id),
    sessionType: message.sessionType,
    sourceType: message.sessionType === 1 ? "direct" : "group",
    content,
    raw_type: message.msg_type || ""
  };
  return { ...normalized, ...deriveMessageMeta(normalized) };
}

function analyzeMessage(message) {
  const decorated = decorateMessage(message);
  if (decorated.priority === "P4") return [];
  return riskRules
    .filter((rule) => rule.keywords.some((keyword) => decorated.content.includes(keyword)))
    .map((rule) => ({
      id: `${decorated.msg_id}-${rule.title}`,
      msg_id: decorated.msg_id,
      group_id: decorated.group_id,
      group_name: decorated.group_name,
      level: rule.level,
      title: rule.title,
      suggestion: rule.suggestion,
      content: decorated.content,
      sender: decorated.sender,
      t_msg: decorated.t_msg,
      time: decorated.time
    }));
}

function buildQueues() {
  const messages = recentDecoratedMessages();
  return {
    pending: messages.filter((message) => ["P0", "P1"].includes(message.priority)),
    mentions: messages.filter((message) => message.mentionsMe),
    direct: messages.filter((message) => message.sourceType === "direct"),
    project: messages.filter((message) => message.projectTags.length),
    business: messages.filter((message) => message.businessTags.length && message.priority !== "P4"),
    digest: messages.filter((message) => ["P2", "P3"].includes(message.priority)),
    muted: messages.filter((message) => message.priority === "P4")
  };
}

function buildQueueCounts() {
  return Object.fromEntries(Object.entries(buildQueues()).map(([key, items]) => [key, items.length]));
}

function buildClusters() {
  const map = new Map();
  for (const message of recentDecoratedMessages()) {
    const topic = topicForMessage(message);
    const key = message.sourceType === "direct"
      ? `direct:${message.sender_uid || message.sender}`
      : `group:${message.group_id || message.group_name}:${topic}`;

    if (!map.has(key)) {
      map.set(key, {
        id: key,
        title: message.sourceType === "direct" ? `私聊：${message.sender}` : message.group_name,
        sourceType: message.sourceType,
        groupName: message.group_name,
        topic,
        priority: message.priority,
        priorityReason: message.priorityReason,
        status: "new",
        messages: [],
        messageCount: 0,
        mentionsMe: false,
        businessTags: [],
        projectTags: []
      });
    }

    const cluster = map.get(key);
    cluster.messages.push(message);
    cluster.messageCount += 1;
    cluster.mentionsMe ||= message.mentionsMe;
    cluster.priority = highestPriority(cluster.priority, message.priority);
    if (priorityWeight(message.priority) >= priorityWeight(cluster.priority)) {
      cluster.priorityReason = message.priorityReason;
    }
    cluster.businessTags = unique([...cluster.businessTags, ...message.businessTags]);
    cluster.projectTags = unique([...cluster.projectTags, ...message.projectTags]);
  }

  return [...map.values()]
    .map((cluster) => {
      const sorted = cluster.messages.sort((a, b) => b.t_msg - a.t_msg);
      return {
        ...cluster,
        latestAt: sorted[0]?.t_msg || 0,
        messages: sorted.slice(0, 12),
        summary: buildClusterSummary({ ...cluster, messages: sorted }),
        suggestedActions: suggestedActionsForCluster({ ...cluster, messages: sorted })
      };
    })
    .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || b.latestAt - a.latestAt);
}

function buildTodayDigest() {
  const todayStart = startOfLocalDay(Date.now());
  const messages = state.messages
    .map(decorateMessage)
    .filter((message) => message.t_msg >= todayStart && message.priority !== "P4")
    .sort((a, b) => a.t_msg - b.t_msg);
  const alerts = state.alerts
    .filter((alert) => alert.t_msg >= todayStart)
    .sort((a, b) => levelWeight(b.level) - levelWeight(a.level) || b.t_msg - a.t_msg);
  const byGroup = Object.groupBy ? Object.groupBy(messages, (message) => message.group_name) : groupBy(messages, "group_name");

  return {
    date: localDateText(Date.now()),
    messageCount: messages.length,
    alertCount: alerts.length,
    groups: Object.entries(byGroup).map(([name, items]) => ({
      name,
      messageCount: items.length,
      progress: progressFromMessages(items),
      todos: todosFromAlerts(alerts.filter((alert) => alert.group_name === name))
    })),
    risks: alerts.slice(0, 8),
    questions: questionsFromAlerts(alerts)
  };
}

function progressFromMessages(messages) {
  return messages
    .filter((message) => /报价|人天|节点|统计|确认|修改|排期|引擎|合同|结算/.test(message.content))
    .slice(-5)
    .map((message) => `${localTimeText(message.t_msg)} ${message.sender}：${message.content}`);
}

function todosFromAlerts(alerts) {
  return [...new Set(alerts.slice(0, 5).map((alert) => alert.suggestion))];
}

function questionsFromAlerts(alerts) {
  const questions = [];
  if (alerts.some((alert) => alert.title.includes("报价"))) questions.push("报价表是否已补齐资源、数量、环节、人天、合计和截图对应关系？");
  if (alerts.some((alert) => alert.title.includes("人天"))) questions.push("人天差异是否已有内部对接人确认最终口径？");
  if (alerts.some((alert) => alert.title.includes("排期"))) questions.push("排期或节点调整是否已有明确新时间？");
  if (alerts.some((alert) => alert.title.includes("资料"))) questions.push("统计类信息是否需要继续补名单、权限或工具版本？");
  if (alerts.some((alert) => alert.title.includes("合同"))) questions.push("合同、APC、验收截图、结算金额和供应商资质是否已齐套？");
  return questions;
}

function healthPayload() {
  return {
    ok: true,
    service: "POPO 助手本地同步服务",
    lastSyncAt,
    lastSyncError,
    isSyncing,
    messageCount: state.messages.length,
    alertCount: state.alerts.length,
    queueCounts: buildQueueCounts(),
    groups: config.groups,
    pollIntervalMs: config.pollIntervalMs
  };
}

function recentMessages() {
  return recentDecoratedMessages();
}

function recentDecoratedMessages() {
  return state.messages.slice(-200).map(decorateMessage).map(enrichLocalAssets).sort((a, b) => b.t_msg - a.t_msg);
}

function recentAlerts() {
  return state.alerts.slice(-100).reverse();
}

function decorateMessage(message) {
  return { ...message, ...deriveMessageMeta(message) };
}

function enrichLocalAssets(message) {
  if (!/\[图片\]|\[image\]|https?:\/\//i.test(message.content || "")) return { ...message, localImages: [] };
  const images = findLocalImagesNear(message.t_msg, 12 * 60 * 1000).slice(0, 6);
  return { ...message, localImages: images };
}

function deriveMessageMeta(message) {
  const sourceType = classifySourceType(message);
  const content = message.content || "";
  const text = `${message.group_name || ""} ${content}`;
  const mentionsMe = isMention(text);
  const projectTags = projectTagsFor(text);
  const businessTags = businessTagsFor(content);
  const noiseScore = noisePatterns.reduce((score, pattern) => score + (content.includes(pattern) ? 1 : 0), 0);
  const { priority, priorityReason } = classifyPriority({ sourceType, mentionsMe, projectTags, businessTags, noiseScore });
  return { sourceType, mentionsMe, projectTags, businessTags, noiseScore, priority, priorityReason };
}

function classifyPriority(context) {
  if (context.sourceType === "direct") return { priority: "P0", priorityReason: "私聊消息需要优先确认" };
  if (context.mentionsMe) return { priority: "P0", priorityReason: "群内 @你，需要优先处理" };
  if (context.businessTags.some((tag) => ["合同", "结算"].includes(tag))) {
    return { priority: "P1", priorityReason: "合同/结算相关风险" };
  }
  if (context.businessTags.includes("报价") && context.projectTags.length) {
    return { priority: "P1", priorityReason: "项目报价相关" };
  }
  if (context.noiseScore >= 1 && !context.businessTags.length) {
    return { priority: "P4", priorityReason: "低价值确认类消息，默认静默" };
  }
  if (context.projectTags.length || context.businessTags.length) {
    return { priority: "P2", priorityReason: "项目或业务相关，可进入摘要" };
  }
  return { priority: "P3", priorityReason: "普通群消息，仅保留上下文" };
}

function classifySourceType(message) {
  if (message.sourceType) return message.sourceType;
  if (message.sessionType === 1 || !message.group_id) return "direct";
  return "group";
}

function isMention(text) {
  return mentionAliases.some((alias) => String(text || "").includes(alias));
}

function projectTagsFor(text) {
  return projectKeywords.filter((keyword) => String(text || "").includes(keyword));
}

function businessTagsFor(text) {
  return businessTagRules
    .filter((rule) => rule.keywords.some((keyword) => String(text || "").includes(keyword)))
    .map((rule) => rule.tag);
}

function topicForMessage(message) {
  return message.businessTags[0] || message.projectTags[0] || (message.priority === "P4" ? "静默确认" : "普通讨论");
}

function buildClusterSummary(cluster) {
  const latest = cluster.messages[0];
  if (!latest) return "暂无消息。";
  if (cluster.priority === "P0" && cluster.mentionsMe) return `群内 @你，需要优先确认：${latest.content}`;
  if (cluster.priority === "P0" && cluster.sourceType === "direct") return `私聊需要优先处理：${latest.content}`;
  if (cluster.businessTags.includes("报价")) return "报价/人天相关讨论，需要确认口径、资源数量和可复核材料。";
  if (cluster.businessTags.includes("合同") || cluster.businessTags.includes("结算")) return "合同/结算相关信息，需要检查前置材料和流程状态。";
  if (cluster.priority === "P4") return "低价值确认类消息，默认静默，不进入待处理。";
  return latest.content;
}

function suggestedActionsForCluster(cluster) {
  const actions = [];
  if (cluster.priority === "P0") {
    actions.push("先确认是否需要你回复或推进。");
    actions.push("查看上下文后生成回复草稿。");
  }
  if (cluster.businessTags.includes("报价")) {
    actions.push("核对报价表中的资源、数量、环节、人天、合计和截图。");
    actions.push("确认是否存在人天差异、增补或口径变更。");
  }
  if (cluster.businessTags.includes("合同") || cluster.businessTags.includes("结算")) {
    actions.push("检查合同、APC/OA、验收截图、发票和结算金额是否齐套。");
  }
  if (cluster.businessTags.includes("文件")) {
    actions.push("确认图片、截图、附件是否能归档，并补齐缺失材料。");
  }
  if (cluster.priority === "P4") {
    actions.push("默认静默，不进入待处理。");
  }
  return actions.length ? unique(actions) : ["保留上下文，进入日/周报摘要即可。"];
}

function highestPriority(a, b) {
  return priorityWeight(b) > priorityWeight(a) ? b : a;
}

function priorityWeight(priority) {
  return { P0: 5, P1: 4, P2: 3, P3: 2, P4: 1 }[priority] || 0;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function openEvents(req, res) {
  sendCorsHeaders(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  res.write(`data: ${JSON.stringify({ type: "hello", payload: healthPayload() })}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(data);
}

function sendJson(res, payload, status = 200) {
  sendCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendCors(res, status) {
  sendCorsHeaders(res);
  res.writeHead(status);
  res.end();
}

function sendCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function sendLocalAsset(req, res) {
  sendCorsHeaders(res);
  const id = decodeURIComponent(req.url.replace("/api/local-assets/", "").split("?")[0]);
  const index = getLocalAssetIndex();
  const item = index.byId.get(id);
  if (!item || !fs.existsSync(item.path)) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "asset_not_found" }));
    return;
  }
  res.writeHead(200, {
    "Content-Type": item.mime || "application/octet-stream",
    "Cache-Control": "private, max-age=3600"
  });
  fs.createReadStream(item.path).pipe(res);
}

function findLocalImagesNear(time, windowMs) {
  const target = Number(time) || Date.now();
  return getLocalAssetIndex().images
    .filter((image) => Math.abs(image.mtimeMs - target) <= windowMs)
    .sort((a, b) => Math.abs(a.mtimeMs - target) - Math.abs(b.mtimeMs - target))
    .map((image) => ({
      id: image.id,
      url: `/api/local-assets/${encodeURIComponent(image.id)}`,
      name: image.name,
      size: image.size,
      mime: image.mime,
      lastWriteTime: new Date(image.mtimeMs).toISOString(),
      timeDistanceMs: Math.abs(image.mtimeMs - target),
      source: image.source
    }));
}

function getLocalAssetIndex() {
  const ttl = 60 * 1000;
  if (Date.now() - assetCache.builtAt < ttl && assetCache.images.length) return assetCache;

  const byId = new Map();
  const images = [];
  const recentSince = Date.now() - 2 * 24 * 60 * 60 * 1000;
  for (const root of localImageRoots()) {
    if (!fs.existsSync(root.path)) continue;
    for (const file of walkFiles(root.path, 2, 20000)) {
      if (file.mtimeMs < recentSince) continue;
      const mimeFromName = detectImageMimeByName(file.path);
      const mime = mimeFromName || detectImageMime(file.path, readHeader(file.path, 16));
      if (!mime) continue;
      const id = hashText(file.path);
      const item = {
        id,
        path: file.path,
        name: path.basename(file.path),
        size: file.size,
        mtimeMs: file.mtimeMs,
        mime,
        source: root.name
      };
      byId.set(id, item);
      images.push(item);
    }
  }
  images.sort((a, b) => b.mtimeMs - a.mtimeMs);
  assetCache = { builtAt: Date.now(), images, byId };
  return assetCache;
}

function localImageRoots() {
  const user = "sunbin05@corp.netease.com";
  const userRoot = path.join(process.env.LOCALAPPDATA || "", "netease", "popo", "users", user);
  return [
    { name: "POPO image", path: path.join(userRoot, "image") },
    { name: "POPO thumbimage", path: path.join(userRoot, "thumbimage") },
    { name: "MyPopo image", path: path.join(process.env.APPDATA || "", "MyPopo", "image") }
  ];
}

function walkFiles(root, maxDepth, maxFiles) {
  const files = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length && files.length < maxFiles) {
    let entries = [];
    const current = stack.pop();
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory() && current.depth < maxDepth) {
        stack.push({ dir: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(fullPath);
        files.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // Ignore files being written by POPO.
      }
    }
  }
  return files;
}

function readHeader(file, bytes) {
  try {
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, 0);
    fs.closeSync(fd);
    return buffer.subarray(0, read);
  } catch {
    return Buffer.alloc(0);
  }
}

function detectImageMime(name, header) {
  const ext = path.extname(name).toLowerCase();
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (header.subarray(0, 6).toString("ascii").startsWith("GIF")) return "image/gif";
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return `image/${ext.replace(".", "").replace("jpg", "jpeg")}`;
  return "";
}

function detectImageMimeByName(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  return "";
}

function hashText(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  return (hash >>> 0).toString(36);
}

function loadState() {
  const initial = { lastSyncAt: null, messageIds: {}, messages: [], alerts: [] };
  if (!fs.existsSync(stateFile)) return initial;
  try {
    return { ...initial, ...readJson(stateFile) };
  } catch {
    return initial;
  }
}

function saveState() {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
}

function trimState() {
  state.messages = state.messages.slice(-1000);
  state.alerts = state.alerts.slice(-1000);
  state.messageIds = Object.fromEntries(state.messages.map((message) => [message.msg_id, true]));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function groupName(groupId) {
  return config.groups.find((group) => group.id === groupId)?.name || groupId || "未知群";
}

function sanitizeContent(content) {
  return String(content).replace(/\s+/g, " ").trim();
}

function startOfLocalDay(time) {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function localDateText(time) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(time));
}

function localTimeText(time) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(time));
}

function levelWeight(level) {
  if (level === "高") return 3;
  if (level === "中") return 2;
  return 1;
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key];
    acc[value] ||= [];
    acc[value].push(item);
    return acc;
  }, {});
}
