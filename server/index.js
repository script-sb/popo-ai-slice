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
    keywords: ["有点高", "重新", "调整", "修改", "0.5", "1.45", "人天", "按"],
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
    if (req.url === "/api/digest/today") return sendJson(res, buildTodayDigest());
    if (req.url === "/api/sync-now" && (req.method === "POST" || req.method === "GET")) {
      const result = await syncNow("manual");
      return sendJson(res, result);
    }
    if (req.url === "/events") return openEvents(req, res);
    return sendJson(res, { error: "not_found" }, 404);
  } catch (error) {
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
  return {
    msg_id: message.msg_id,
    t_msg: message.t_msg,
    time: new Date(message.t_msg).toISOString(),
    sender: message.memberName || message.nfrom || "未知成员",
    sender_uid: message.nfrom || "",
    group_id: message.session_id || message.nto || "",
    group_name: message.sessionName || groupName(message.session_id),
    content: sanitizeContent(message.content || ""),
    raw_type: message.msg_type || ""
  };
}

function analyzeMessage(message) {
  const text = message.content;
  return riskRules
    .filter((rule) => rule.keywords.some((keyword) => text.includes(keyword)))
    .map((rule) => ({
      id: `${message.msg_id}-${rule.title}`,
      msg_id: message.msg_id,
      group_id: message.group_id,
      group_name: message.group_name,
      level: rule.level,
      title: rule.title,
      suggestion: rule.suggestion,
      content: text,
      sender: message.sender,
      t_msg: message.t_msg,
      time: message.time
    }));
}

function buildTodayDigest() {
  const todayStart = startOfLocalDay(Date.now());
  const messages = state.messages
    .filter((message) => message.t_msg >= todayStart)
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
    .filter((message) => /报价|人天|节点|统计|确认|修改|排期|引擎/.test(message.content))
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
    groups: config.groups,
    pollIntervalMs: config.pollIntervalMs
  };
}

function recentMessages() {
  return state.messages.slice(-100).reverse();
}

function recentAlerts() {
  return state.alerts.slice(-100).reverse();
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
