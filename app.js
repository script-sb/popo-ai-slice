const localApiBase = "http://127.0.0.1:8787";

const queueMeta = [
  { id: "pending", label: "待处理", hint: "P0/P1", description: "群内 @我、私聊、高风险报价/合同/结算。" },
  { id: "mentions", label: "@我", hint: "点名", description: "群聊中明确 @你的消息。" },
  { id: "direct", label: "私聊", hint: "个人", description: "私聊消息默认最高优先级。" },
  { id: "project", label: "项目关注", hint: "项目", description: "H55/H74/Joker 等项目相关讨论。" },
  { id: "business", label: "业务风险", hint: "报价/合同", description: "报价、人天、合同、结算、归档材料。" },
  { id: "digest", label: "摘要", hint: "日/周报", description: "普通但有价值的上下文，进入日报/周报。" },
  { id: "muted", label: "已静默", hint: "低价值", description: "收到、好滴、普通确认类消息。" }
];

const state = {
  queues: {},
  clusters: [],
  alerts: [],
  activeQueue: "pending",
  selectedClusterId: "",
  search: "",
  health: null
};

const elements = {
  serviceMini: document.querySelector("#serviceMini"),
  syncStatus: document.querySelector("#syncStatus"),
  syncNowButton: document.querySelector("#syncNowButton"),
  syncMessageCount: document.querySelector("#syncMessageCount"),
  syncAlertCount: document.querySelector("#syncAlertCount"),
  queueList: document.querySelector("#queueList"),
  clusterList: document.querySelector("#clusterList"),
  messageSearch: document.querySelector("#messageSearch"),
  activeQueueTitle: document.querySelector("#activeQueueTitle"),
  activeQueueHint: document.querySelector("#activeQueueHint"),
  selectedHint: document.querySelector("#selectedHint"),
  selectedPriority: document.querySelector("#selectedPriority"),
  selectedMessage: document.querySelector("#selectedMessage"),
  riskList: document.querySelector("#riskList"),
  todoList: document.querySelector("#todoList"),
  replyDraft: document.querySelector("#replyDraft"),
  digestMeta: document.querySelector("#digestMeta"),
  digestPreview: document.querySelector("#digestPreview"),
  loadLocalDigestButton: document.querySelector("#loadLocalDigestButton")
};

elements.syncNowButton.addEventListener("click", syncNow);
elements.loadLocalDigestButton.addEventListener("click", loadDigest);
elements.messageSearch.addEventListener("input", (event) => {
  state.search = event.target.value.trim().toLowerCase();
  renderClusters();
});

init();

async function init() {
  renderQueues();
  await refreshAll();
  connectEvents();
}

async function refreshAll() {
  try {
    const [health, queues, clusters, alerts] = await Promise.all([
      fetchJson(`${localApiBase}/api/health`),
      fetchJson(`${localApiBase}/api/queues`),
      fetchJson(`${localApiBase}/api/clusters`),
      fetchJson(`${localApiBase}/api/alerts`)
    ]);
    state.health = health;
    state.queues = queues;
    state.clusters = clusters;
    state.alerts = alerts;
    updateHealth(health);
    renderQueues();
    renderClusters();
    keepSelection();
  } catch {
    useDemoData();
  }
}

async function syncNow() {
  elements.syncStatus.textContent = "同步中";
  elements.serviceMini.classList.remove("offline");
  try {
    await fetchJson(`${localApiBase}/api/sync-now`, { method: "POST" });
    await refreshAll();
  } catch {
    updateOffline();
  }
}

function connectEvents() {
  try {
    const events = new EventSource(`${localApiBase}/events`);
    events.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "hello") updateHealth(data.payload);
      if (data.type === "sync") await refreshAll();
      if (data.type === "error") elements.syncStatus.textContent = "同步异常";
    };
    events.onerror = () => {
      if (!state.clusters.length) useDemoData();
    };
  } catch {
    if (!state.clusters.length) useDemoData();
  }
}

function updateHealth(health) {
  state.health = health;
  elements.serviceMini.classList.remove("offline");
  elements.syncStatus.textContent = health.lastSyncAt ? `已连接 ${formatTime(health.lastSyncAt)}` : "已连接";
  elements.syncMessageCount.textContent = health.messageCount;
  elements.syncAlertCount.textContent = health.alertCount;
}

function updateOffline() {
  elements.serviceMini.classList.add("offline");
  elements.syncStatus.textContent = "未连接";
  elements.syncMessageCount.textContent = "-";
  elements.syncAlertCount.textContent = "-";
  elements.clusterList.innerHTML = `<div class="empty-state">本地同步服务未连接。请在项目目录运行：<code>npm run server</code></div>`;
}

function useDemoData() {
  const now = Date.now();
  const messages = [
    demoMessage("demo-1", now - 8 * 60 * 1000, "成都益格PM江浩", "H55-动作-益格-报价群", "这是套用修改3端动画1人天，3个loop调整位置参考之前的0.15，一起1.45吧 [图片] 这个有点高，是单独出了pose，一个加0.2吧 @孙斌"),
    demoMessage("demo-2", now - 35 * 60 * 1000, "赵佑福", "H55-动作-益格-报价群", "我找对接同学和对对"),
    demoMessage("demo-3", now - 48 * 60 * 1000, "成都益格PM江浩", "H55-动作-益格-报价群", "好滴", "P4", "低价值确认类消息，默认静默"),
    demoMessage("demo-4", now - 66 * 60 * 1000, "上海点晴|刘瑶颖|PM", "H55-场景制作-点晴-报价群", "基本制作都会用到引擎，我们都是用离线版本，数量在10个左右", "P2", "项目或业务相关，可进入摘要")
  ];
  state.health = {
    messageCount: messages.length,
    alertCount: 2,
    queueCounts: { pending: 1, mentions: 1, direct: 0, project: 4, business: 1, digest: 2, muted: 1 }
  };
  state.queues = {
    pending: [messages[0]],
    mentions: [messages[0]],
    direct: [],
    project: messages,
    business: [messages[0]],
    digest: [messages[1], messages[3]],
    muted: [messages[2]]
  };
  state.clusters = [
    {
      id: "demo:quote",
      title: "H55-动作-益格-报价群",
      sourceType: "group",
      groupName: "H55-动作-益格-报价群",
      topic: "报价",
      priority: "P0",
      priorityReason: "群内 @你，需要优先处理",
      messageCount: 3,
      mentionsMe: true,
      businessTags: ["报价", "文件"],
      projectTags: ["H55", "动作"],
      latestAt: messages[0].t_msg,
      summary: "群内 @你，需要确认人天报价口径和截图材料。",
      suggestedActions: ["确认是否需要你回复或推进。", "核对报价表中的资源、数量、环节、人天、合计和截图。", "确认是否存在人天差异、增补或口径变更。"],
      messages: [messages[0], messages[1], messages[2]]
    },
    {
      id: "demo:engine",
      title: "H55-场景制作-点晴-报价群",
      sourceType: "group",
      groupName: "H55-场景制作-点晴-报价群",
      topic: "H55",
      priority: "P2",
      priorityReason: "项目或业务相关，可进入摘要",
      messageCount: 1,
      mentionsMe: false,
      businessTags: [],
      projectTags: ["H55", "场景"],
      latestAt: messages[3].t_msg,
      summary: "供应商反馈制作同学使用引擎数量，适合进入日报摘要。",
      suggestedActions: ["保留上下文，进入日/周报摘要即可。"],
      messages: [messages[3]]
    }
  ];
  state.alerts = [{
    msg_id: "demo-1",
    level: "高",
    title: "报价材料需要复核",
    content: messages[0].content
  }];
  elements.serviceMini.classList.add("offline");
  elements.syncStatus.textContent = "演示数据";
  elements.syncMessageCount.textContent = state.health.messageCount;
  elements.syncAlertCount.textContent = state.health.alertCount;
  renderQueues();
  renderClusters();
}

function demoMessage(msgId, tMsg, sender, groupName, content, priority = "P0", priorityReason = "群内 @你，需要优先处理") {
  return {
    msg_id: msgId,
    t_msg: tMsg,
    time: new Date(tMsg).toISOString(),
    sender,
    sender_uid: sender,
    group_id: groupName,
    group_name: groupName,
    sourceType: "group",
    content,
    priority,
    priorityReason,
    mentionsMe: content.includes("@孙斌"),
    businessTags: content.includes("人天") ? ["报价"] : [],
    projectTags: ["H55"]
  };
}

function renderQueues() {
  const counts = state.health?.queueCounts || {};
  elements.queueList.innerHTML = queueMeta.map((queue) => `
    <button class="queue-item${queue.id === state.activeQueue ? " active" : ""}" type="button" data-queue="${queue.id}">
      <span>
        <strong>${queue.label}</strong>
        <small>${queue.hint}</small>
      </span>
      <em>${counts[queue.id] ?? 0}</em>
    </button>
  `).join("");

  elements.queueList.querySelectorAll("[data-queue]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeQueue = button.dataset.queue;
      state.selectedClusterId = "";
      renderQueues();
      renderClusters();
    });
  });
}

function renderClusters() {
  const queue = queueMeta.find((item) => item.id === state.activeQueue) || queueMeta[0];
  elements.activeQueueTitle.textContent = queue.label;
  elements.activeQueueHint.textContent = queue.description;

  const clusters = filteredClusters();
  if (!clusters.length) {
    elements.clusterList.innerHTML = `<div class="empty-state">当前队列暂无会话。普通群消息会保留在摘要或已静默中，避免打断。</div>`;
    clearSelection();
    return;
  }

  elements.clusterList.innerHTML = clusters.map(clusterCard).join("");
  elements.clusterList.querySelectorAll("[data-cluster-id]").forEach((card) => {
    card.addEventListener("click", () => selectCluster(card.dataset.clusterId));
  });

  if (!state.selectedClusterId || !clusters.some((cluster) => cluster.id === state.selectedClusterId)) {
    selectCluster(clusters[0].id);
  }
}

function filteredClusters() {
  const queueMessageIds = new Set((state.queues[state.activeQueue] || []).map((message) => message.msg_id));
  return state.clusters
    .filter((cluster) => cluster.messages.some((message) => queueMessageIds.has(message.msg_id)))
    .filter((cluster) => {
      if (!state.search) return true;
      const text = `${cluster.title} ${cluster.groupName} ${cluster.topic} ${cluster.summary} ${cluster.messages.map((message) => message.content).join(" ")}`;
      return text.toLowerCase().includes(state.search);
    });
}

function clusterCard(cluster) {
  const active = cluster.id === state.selectedClusterId ? " active" : "";
  const latest = cluster.messages[0];
  const tags = [...cluster.projectTags.slice(0, 2), ...cluster.businessTags.slice(0, 2)];
  return `
    <article class="cluster-card${active} priority-${cluster.priority.toLowerCase()}" data-cluster-id="${escapeHtml(cluster.id)}">
      <div class="cluster-card-top">
        <span class="priority-pill">${cluster.priority}</span>
        <time>${formatTime(cluster.latestAt)}</time>
      </div>
      <h3>${escapeHtml(cluster.title)}</h3>
      <p>${escapeHtml(cluster.summary)}</p>
      <div class="tag-row">
        <span>${escapeHtml(cluster.topic)}</span>
        ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="cluster-meta">
        <span>${cluster.messageCount} 条消息</span>
        <strong>${escapeHtml(cluster.priorityReason || latest?.priorityReason || "")}</strong>
      </div>
    </article>
  `;
}

function selectCluster(clusterId) {
  state.selectedClusterId = clusterId;
  document.querySelectorAll(".cluster-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.clusterId === clusterId);
  });

  const cluster = state.clusters.find((item) => item.id === clusterId);
  if (!cluster) return clearSelection();

  elements.selectedPriority.textContent = cluster.priority;
  elements.selectedPriority.className = `mode-pill priority-${cluster.priority.toLowerCase()}`;
  elements.selectedHint.textContent = `${cluster.title} / ${cluster.topic}`;
  elements.selectedMessage.innerHTML = `
    <span>${cluster.sourceType === "direct" ? "私聊" : "群聊"} · ${escapeHtml(cluster.groupName || cluster.title)}</span>
    <h3>${escapeHtml(cluster.title)}</h3>
    <p>${escapeHtml(cluster.summary)}</p>
    <div class="message-thread">
      ${cluster.messages.map(threadMessage).join("")}
    </div>
  `;

  const relatedAlerts = alertsForCluster(cluster);
  elements.riskList.innerHTML = riskItems(cluster, relatedAlerts);
  elements.todoList.innerHTML = cluster.suggestedActions.map((item) => `<p class="todo-item">${escapeHtml(item)}</p>`).join("");
  elements.replyDraft.value = buildReplyDraft(cluster, relatedAlerts);
}

function threadMessage(message) {
  return `
    <article class="thread-message">
      <div>
        <strong>${escapeHtml(message.sender || "未知成员")}</strong>
        <time>${formatTime(message.t_msg)}</time>
      </div>
      <div class="rich-message">${renderRichContent(message.content)}</div>
    </article>
  `;
}

function alertsForCluster(cluster) {
  const ids = new Set(cluster.messages.map((message) => message.msg_id));
  return state.alerts.filter((alert) => ids.has(alert.msg_id));
}

function riskItems(cluster, alerts) {
  const lines = [
    { level: cluster.priority, title: cluster.priorityReason, content: cluster.summary }
  ];
  alerts.slice(0, 5).forEach((alert) => {
    lines.push({ level: alert.level, title: alert.title, content: alert.content });
  });
  return lines.map((line) => `
    <article class="risk-row">
      <span class="${riskClass(line.level)}">${escapeHtml(line.level)}</span>
      <div>
        <strong>${escapeHtml(line.title)}</strong>
        <p>${escapeHtml(line.content)}</p>
      </div>
    </article>
  `).join("");
}

function clearSelection() {
  state.selectedClusterId = "";
  elements.selectedHint.textContent = "选择中间会话后查看判断、动作和建议回复。";
  elements.selectedPriority.textContent = "未选择";
  elements.selectedPriority.className = "mode-pill";
  elements.selectedMessage.innerHTML = `<span>未选择会话</span><p>当前队列暂无可处理会话。</p>`;
  elements.riskList.innerHTML = `<p class="muted">暂无选中会话。</p>`;
  elements.todoList.innerHTML = `<p class="muted">暂无选中会话。</p>`;
  elements.replyDraft.value = "";
}

function keepSelection() {
  if (state.selectedClusterId && state.clusters.some((cluster) => cluster.id === state.selectedClusterId)) {
    selectCluster(state.selectedClusterId);
  }
}

async function loadDigest() {
  try {
    const digest = await fetchJson(`${localApiBase}/api/digest/today`);
    elements.digestMeta.textContent = `${digest.date} · ${digest.messageCount} 条有效消息 · ${digest.alertCount} 条风险`;
    elements.digestPreview.innerHTML = `
      ${digest.groups.map((group) => `
        <section class="digest-group">
          <h4>${escapeHtml(group.name)} <span>${group.messageCount} 条</span></h4>
          <ul>${group.progress.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无明确进展。</li>"}</ul>
          <strong>待办</strong>
          <ul>${group.todos.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无新增待办。</li>"}</ul>
        </section>
      `).join("")}
      <section class="digest-group">
        <h4>需要确认</h4>
        <ul>${digest.questions.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无确认项。</li>"}</ul>
      </section>
    `;
  } catch {
    elements.digestPreview.innerHTML = `<p class="muted">本地同步服务未连接，无法生成日报。</p>`;
  }
}

function buildReplyDraft(cluster, alerts) {
  if (cluster.priority === "P4") return "这类消息默认静默，不建议主动回复。";
  if (!alerts.length && !["P0", "P1"].includes(cluster.priority)) return "收到，我先关注下，有需要我再跟进。";
  const actions = cluster.suggestedActions.slice(0, 3).map((item) => `- ${item}`).join("\n");
  if (cluster.sourceType === "direct" || cluster.mentionsMe) {
    return `收到，我先确认下。\n${actions}\n确认后我同步最终口径。`;
  }
  return `这条我建议先纳入日/周报跟踪。\n${actions}`;
}

function renderRichContent(content) {
  const raw = String(content || "");
  const urls = extractMediaUrls(raw);
  const safeText = escapeHtml(raw).replace(/\[?https?:\/\/[^\]\s]+]?/g, "").trim();
  const imageHtml = urls.length
    ? `<div class="image-strip">${urls.map((url) => `
        <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
          <img src="${escapeHtml(url)}" alt="POPO 图片预览" loading="lazy" />
        </a>
      `).join("")}</div>`
    : "";
  const placeholder = /\[图片\]/.test(raw) && !urls.length
    ? `<div class="image-placeholder">图片占位：当前 POPO 搜索结果只返回 [图片]，需要后端接入附件下载接口后才能展示原图。</div>`
    : "";
  return `<p>${safeText || escapeHtml(raw)}</p>${imageHtml}${placeholder}`;
}

function extractMediaUrls(content) {
  const matches = String(content || "").match(/https?:\/\/[^\]\s]+/g) || [];
  return [...new Set(matches.filter((url) => /popofp|popo\.fp|vipfp|png|jpg|jpeg|webp|gif/i.test(url)))];
}

function riskClass(level) {
  if (level === "P0" || level === "P1" || level === "高") return "level-high";
  if (level === "P2" || level === "中") return "level-mid";
  return "level-low";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
