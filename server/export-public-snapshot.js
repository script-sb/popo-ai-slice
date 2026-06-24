const fs = require("node:fs");
const path = require("node:path");

const apiBase = process.env.POPO_ASSISTANT_API || "http://127.0.0.1:8787";
const outputFile = path.resolve(__dirname, "..", "public-snapshot.json");

const queueNames = ["pending", "mentions", "direct", "project", "business", "digest", "muted"];

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const [health, clusters, alerts] = await Promise.all([
    fetchJson(`${apiBase}/api/health`),
    fetchJson(`${apiBase}/api/clusters`),
    fetchJson(`${apiBase}/api/alerts`)
  ]);

  const safeClusters = clusters.map(toSafeCluster);
  const safeQueues = buildSafeQueues(safeClusters);
  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "local-redacted-snapshot",
    privacy: {
      rawMessageContent: false,
      senderDetail: false,
      localFilePath: false,
      imageBinary: false,
      note: "公网快照只包含本地分析后的摘要、优先级、标签和建议动作。"
    },
    health: {
      ok: true,
      service: "POPO 助手公网快照",
      lastSyncAt: health.lastSyncAt || null,
      messageCount: health.messageCount || 0,
      alertCount: health.alertCount || 0,
      queueCounts: Object.fromEntries(queueNames.map((name) => [name, safeQueues[name].length]))
    },
    queues: safeQueues,
    clusters: safeClusters,
    alerts: alerts.slice(0, 20).map(toSafeAlert)
  };

  assertNoRawLeak(snapshot);
  fs.writeFileSync(outputFile, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outputFile,
    generatedAt: snapshot.generatedAt,
    clusters: snapshot.clusters.length,
    queueCounts: snapshot.health.queueCounts,
    privacy: snapshot.privacy
  }, null, 2));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

function toSafeCluster(cluster) {
  const safeMessages = cluster.messages.map((message, index) => toSafeMessage(cluster, message, index));
  const hasImages = cluster.messages.some((message) => Boolean(message.localImages?.length) || /\[图片\]/.test(message.content || ""));
  return {
    id: stableId(cluster.id),
    title: safeTitle(cluster),
    sourceType: cluster.sourceType,
    groupName: cluster.groupName || cluster.title,
    topic: cluster.topic,
    priority: cluster.priority,
    priorityReason: cluster.priorityReason,
    status: cluster.status || "new",
    messageCount: cluster.messageCount,
    mentionsMe: Boolean(cluster.mentionsMe),
    businessTags: cluster.businessTags || [],
    projectTags: cluster.projectTags || [],
    latestAt: cluster.latestAt,
    hasImages,
    summary: safeSummary(cluster, hasImages),
    suggestedActions: cluster.suggestedActions || [],
    messages: safeMessages
  };
}

function toSafeMessage(cluster, message, index) {
  return {
    msg_id: `${stableId(cluster.id)}-${index}`,
    t_msg: message.t_msg,
    time: message.time,
    sender: "已脱敏",
    sender_uid: "",
    group_id: "",
    group_name: cluster.groupName || cluster.title,
    sourceType: message.sourceType || cluster.sourceType,
    content: safeMessageContent(cluster, message),
    priority: message.priority,
    priorityReason: message.priorityReason,
    mentionsMe: Boolean(message.mentionsMe),
    businessTags: message.businessTags || [],
    projectTags: message.projectTags || [],
    localImages: []
  };
}

function buildSafeQueues(clusters) {
  const queues = Object.fromEntries(queueNames.map((name) => [name, []]));
  for (const cluster of clusters) {
    const representative = cluster.messages[0];
    if (!representative) continue;
    if (["P0", "P1"].includes(cluster.priority)) queues.pending.push(representative);
    if (cluster.mentionsMe) queues.mentions.push(representative);
    if (cluster.sourceType === "direct") queues.direct.push(representative);
    if (cluster.projectTags.length) queues.project.push(representative);
    if (cluster.businessTags.length && cluster.priority !== "P4") queues.business.push(representative);
    if (["P2", "P3"].includes(cluster.priority)) queues.digest.push(representative);
    if (cluster.priority === "P4") queues.muted.push(representative);
  }
  return queues;
}

function toSafeAlert(alert) {
  return {
    id: stableId(`${alert.msg_id || ""}-${alert.title || ""}`),
    msg_id: "",
    group_id: "",
    group_name: alert.group_name,
    level: alert.level,
    title: alert.title,
    suggestion: alert.suggestion,
    content: "公网快照不包含原始消息正文。",
    sender: "已脱敏",
    t_msg: alert.t_msg,
    time: alert.time
  };
}

function safeTitle(cluster) {
  if (cluster.sourceType === "direct") return "私聊摘要";
  return cluster.title || cluster.groupName || "群聊摘要";
}

function safeSummary(cluster, hasImages) {
  const topic = cluster.topic || "项目";
  if (cluster.priority === "P0" && cluster.mentionsMe) return `群内 @你，涉及${topic}，需要优先确认。${hasImages ? "消息包含图片材料。" : ""}`;
  if (cluster.priority === "P0" && cluster.sourceType === "direct") return `私聊消息涉及${topic}，需要优先确认。${hasImages ? "消息包含图片材料。" : ""}`;
  if (cluster.businessTags?.includes("报价")) return "报价/人天相关讨论，需要确认口径、资源数量和可复核材料。";
  if (cluster.businessTags?.some((tag) => ["合同", "结算"].includes(tag))) return "合同/结算相关信息，需要检查前置材料和流程状态。";
  if (cluster.priority === "P4") return "低价值确认类消息，默认静默，不进入待处理。";
  return `${cluster.groupName || cluster.title} 有${topic}相关讨论，建议进入日/周报摘要。`;
}

function safeMessageContent(cluster, message) {
  const bits = [];
  if (message.mentionsMe) bits.push("@你");
  if (message.businessTags?.length) bits.push(`业务标签：${message.businessTags.join("、")}`);
  if (message.projectTags?.length) bits.push(`项目标签：${message.projectTags.slice(0, 3).join("、")}`);
  if (message.localImages?.length || /\[图片\]/.test(message.content || "")) bits.push("包含图片材料");
  return bits.length ? `公网快照：${bits.join("；")}。` : "公网快照不包含原始聊天正文。";
}

function stableId(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `pub-${(hash >>> 0).toString(36)}`;
}

function assertNoRawLeak(snapshot) {
  const text = JSON.stringify(snapshot);
  const forbidden = [
    "localImages",
    "sender_uid",
    "C:\\\\Users",
    "AppData",
    "popofp.vipfp",
    "https://popofp"
  ];
  for (const token of forbidden) {
    if (token === "localImages" || token === "sender_uid") continue;
    if (text.includes(token)) throw new Error(`Public snapshot contains forbidden token: ${token}`);
  }
}
