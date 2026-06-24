const localApiBase = "http://127.0.0.1:8787";

const state = {
  messages: [],
  alerts: [],
  activeFeed: "all",
  selectedMessageId: "",
  search: "",
  collapsedGroups: new Set(),
  manualAnalysis: new Set()
};

const elements = {
  serviceMini: document.querySelector("#serviceMini"),
  syncStatus: document.querySelector("#syncStatus"),
  syncNowButton: document.querySelector("#syncNowButton"),
  syncMessageCount: document.querySelector("#syncMessageCount"),
  syncAlertCount: document.querySelector("#syncAlertCount"),
  messageFeed: document.querySelector("#messageFeed"),
  messageSearch: document.querySelector("#messageSearch"),
  selectedHint: document.querySelector("#selectedHint"),
  selectedMessage: document.querySelector("#selectedMessage"),
  riskList: document.querySelector("#riskList"),
  todoList: document.querySelector("#todoList"),
  replyDraft: document.querySelector("#replyDraft"),
  digestMeta: document.querySelector("#digestMeta"),
  digestPreview: document.querySelector("#digestPreview"),
  loadLocalDigestButton: document.querySelector("#loadLocalDigestButton"),
  countAll: document.querySelector("#countAll"),
  countGroup: document.querySelector("#countGroup"),
  countDirect: document.querySelector("#countDirect"),
  countMention: document.querySelector("#countMention")
};

document.querySelectorAll("[data-feed]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-feed]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.activeFeed = button.dataset.feed;
    renderMessages();
  });
});

elements.syncNowButton.addEventListener("click", syncNow);
elements.loadLocalDigestButton.addEventListener("click", loadDigest);
elements.messageSearch.addEventListener("input", (event) => {
  state.search = event.target.value.trim().toLowerCase();
  renderMessages();
});

init();

async function init() {
  await refreshAll();
  connectEvents();
}

async function refreshAll() {
  try {
    const [health, messages, alerts] = await Promise.all([
      fetchJson(`${localApiBase}/api/health`),
      fetchJson(`${localApiBase}/api/messages`),
      fetchJson(`${localApiBase}/api/alerts`)
    ]);
    state.messages = messages;
    state.alerts = alerts;
    updateHealth(health);
    renderCounts();
    renderMessages();
    keepSelection();
  } catch {
    updateOffline();
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
    events.onerror = () => updateOffline();
  } catch {
    updateOffline();
  }
}

function updateHealth(health) {
  elements.serviceMini.classList.remove("offline");
  elements.syncStatus.textContent = health.lastSyncAt ? `已连接 ${formatTime(health.lastSyncAt)}` : "已连接";
  elements.syncMessageCount.textContent = health.messageCount;
  elements.syncAlertCount.textContent = actionableAlertCount();
}

function updateOffline() {
  elements.serviceMini.classList.add("offline");
  elements.syncStatus.textContent = "未连接";
  elements.syncMessageCount.textContent = "-";
  elements.syncAlertCount.textContent = "-";
  elements.messageFeed.innerHTML = `<div class="empty-state">本地同步服务未连接。请在项目目录运行：<code>npm run server</code></div>`;
}

function renderCounts() {
  const counts = countByFeed();
  elements.countAll.textContent = counts.all;
  elements.countGroup.textContent = counts.group;
  elements.countDirect.textContent = counts.direct;
  elements.countMention.textContent = counts.mention;
}

function countByFeed() {
  return state.messages.reduce(
    (acc, message) => {
      acc.all += 1;
      acc[classifyMessage(message)] += 1;
      if (isMention(message) && classifyMessage(message) !== "mention") acc.mention += 1;
      return acc;
    },
    { all: 0, group: 0, direct: 0, mention: 0 }
  );
}

function renderMessages() {
  const messages = filteredMessages();
  if (!messages.length) {
    elements.messageFeed.innerHTML = `<div class="empty-state">当前分流暂无消息。</div>`;
    clearSelection();
    return;
  }

  elements.messageFeed.innerHTML = groupedMessageSections(messages);
  elements.messageFeed.querySelectorAll("[data-message-id]").forEach((card) => {
    card.addEventListener("click", () => selectMessage(card.dataset.messageId));
  });
  elements.messageFeed.querySelectorAll("[data-group-key]").forEach((button) => {
    button.addEventListener("click", () => toggleGroup(button.dataset.groupKey));
  });

  if (!state.selectedMessageId || !messages.some((message) => message.msg_id === state.selectedMessageId)) {
    selectMessage(messages[0].msg_id);
  }
}

function filteredMessages() {
  return state.messages
    .filter((message) => {
      if (state.activeFeed === "all") return true;
      if (state.activeFeed === "mention") return isMention(message);
      return classifyMessage(message) === state.activeFeed;
    })
    .filter((message) => {
      if (!state.search) return true;
      return `${message.group_name} ${message.sender} ${message.content}`.toLowerCase().includes(state.search);
    });
}

function groupedMessageSections(messages) {
  const groups = groupMessages(messages);
  return groups.map((group, index) => {
    const key = group.key;
    if (index === 0 && !state.collapsedGroups.has(key) && !state.selectedMessageId) {
      state.collapsedGroups.delete(key);
    }
    const collapsed = state.collapsedGroups.has(key);
    const mentionCount = group.items.filter(isMention).length;
    const alertCount = group.items.reduce((count, message) => count + visibleAlertsForMessage(message).length, 0);
    return `
      <section class="message-group">
        <button class="group-header" type="button" data-group-key="${escapeHtml(key)}">
          <div>
            <strong>${escapeHtml(group.title)}</strong>
            <span>${group.items.length} 条消息${mentionCount ? ` · ${mentionCount} 条 @我` : ""}${alertCount ? ` · ${alertCount} 条建议` : ""}</span>
          </div>
          <span>${collapsed ? "展开" : "收起"}</span>
        </button>
        ${collapsed ? "" : `<div class="group-messages">${group.items.map(messageCard).join("")}</div>`}
      </section>
    `;
  }).join("");
}

function groupMessages(messages) {
  const map = new Map();
  messages.forEach((message) => {
    const type = classifyMessage(message);
    const key = type === "direct" ? `direct:${message.sender_uid || message.sender}` : `group:${message.group_id || message.group_name}`;
    const title = type === "direct" ? `私聊 · ${message.sender || "未知联系人"}` : message.group_name || "未知群聊";
    if (!map.has(key)) map.set(key, { key, title, items: [] });
    map.get(key).items.push(message);
  });
  return [...map.values()];
}

function toggleGroup(key) {
  if (state.collapsedGroups.has(key)) {
    state.collapsedGroups.delete(key);
  } else {
    state.collapsedGroups.add(key);
  }
  renderMessages();
}

function messageCard(message) {
  const alerts = visibleAlertsForMessage(message);
  const feed = isMention(message) ? "@我" : classifyMessage(message) === "direct" ? "私聊" : "群聊";
  const active = message.msg_id === state.selectedMessageId ? " active" : "";
  const summary = alerts.length ? `<strong>${alerts.length} 条建议</strong>` : `<span>${shouldAnalyzeMessage(message) ? "无强提醒" : "未分析"}</span>`;
  return `
    <article class="message-card${active}" data-message-id="${escapeHtml(message.msg_id)}">
      <div class="message-card-top">
        <span class="feed-pill">${feed}</span>
        <time>${formatTime(message.t_msg)}</time>
      </div>
      <h3>${escapeHtml(classifyMessage(message) === "direct" ? message.sender : message.group_name || "未知群聊")}</h3>
      <p>${escapeHtml(message.content)}</p>
      <div class="message-meta">
        <span>${escapeHtml(message.sender || "未知成员")}</span>
        ${summary}
      </div>
    </article>
  `;
}

function selectMessage(messageId) {
  state.selectedMessageId = messageId;
  document.querySelectorAll(".message-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.messageId === messageId);
  });

  const message = state.messages.find((item) => item.msg_id === messageId);
  if (!message) return clearSelection();

  const alerts = visibleAlertsForMessage(message);
  const canAnalyze = !shouldAnalyzeMessage(message);
  elements.selectedHint.textContent = `${message.group_name} / ${message.sender}`;
  elements.selectedMessage.innerHTML = `
    <span>${formatTime(message.t_msg)} · ${escapeHtml(message.sender)}</span>
    <h3>${escapeHtml(message.group_name)}</h3>
    <div class="rich-message">${renderRichContent(message.content)}</div>
    ${canAnalyze ? `<button class="outline-button analyze-button" type="button" id="analyzeSelectedButton">分析这条消息</button>` : ""}
  `;
  document.querySelector("#analyzeSelectedButton")?.addEventListener("click", () => {
    state.manualAnalysis.add(message.msg_id);
    selectMessage(message.msg_id);
    renderMessages();
  });

  elements.riskList.innerHTML = canAnalyze
    ? `<p class="muted">这是一条未 @ 你的群聊消息，默认只展示不分析。需要处理时点击上方“分析这条消息”。</p>`
    : alerts.length
    ? alerts.map((alert) => `
        <article class="risk-row">
          <span class="${alert.level === "高" ? "level-high" : "level-mid"}">${alert.level}</span>
          <div>
            <strong>${escapeHtml(alert.title)}</strong>
            <p>${escapeHtml(alert.content)}</p>
          </div>
        </article>
      `).join("")
    : `<p class="muted">未命中强风险，建议只做普通关注。</p>`;

  elements.todoList.innerHTML = canAnalyze
    ? `<p class="todo-item">默认不生成待办，避免普通群消息干扰工作流。</p>`
    : alerts.length
    ? [...new Set(alerts.map((alert) => alert.suggestion))].map((todo) => `<p class="todo-item">${escapeHtml(todo)}</p>`).join("")
    : `<p class="todo-item">无需立即处理，保留在消息流中观察。</p>`;

  elements.replyDraft.value = canAnalyze ? "" : buildReplyDraft(message, alerts);
}

function clearSelection() {
  state.selectedMessageId = "";
  elements.selectedHint.textContent = "选择左侧消息后查看风险、待办和建议回复。";
  elements.selectedMessage.innerHTML = `<span>未选择消息</span><p>当前分流暂无可处理消息。</p>`;
  elements.riskList.innerHTML = `<p class="muted">暂无选中消息。</p>`;
  elements.todoList.innerHTML = `<p class="muted">暂无选中消息。</p>`;
  elements.replyDraft.value = "";
}

function keepSelection() {
  if (state.selectedMessageId && state.messages.some((message) => message.msg_id === state.selectedMessageId)) {
    selectMessage(state.selectedMessageId);
  }
}

async function loadDigest() {
  try {
    const digest = await fetchJson(`${localApiBase}/api/digest/today`);
    elements.digestMeta.textContent = `${digest.date} · ${digest.messageCount} 条消息 · ${digest.alertCount} 条风险`;
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

function alertsForMessage(message) {
  return state.alerts.filter((alert) => alert.msg_id === message.msg_id);
}

function visibleAlertsForMessage(message) {
  return shouldAnalyzeMessage(message) ? alertsForMessage(message) : [];
}

function actionableAlertCount() {
  return state.messages.reduce((total, message) => total + visibleAlertsForMessage(message).length, 0);
}

function shouldAnalyzeMessage(message) {
  return classifyMessage(message) === "direct" || isMention(message) || state.manualAnalysis.has(message.msg_id);
}

function classifyMessage(message) {
  if (message.sessionType === 1 || !message.group_id) return "direct";
  return "group";
}

function isMention(message) {
  return /@孙斌|@sunbin|@POPO 助手|@我/.test(message.content || "");
}

function buildReplyDraft(message, alerts) {
  if (!alerts.length) return "收到，我先关注下，有需要我再跟进。";
  const suggestions = [...new Set(alerts.map((alert) => alert.suggestion))];
  return `好滴，我先确认下。\n${suggestions.map((item) => `- ${item}`).join("\n")}\n确认后我同步最终口径。`;
}

function renderRichContent(content) {
  const text = escapeHtml(content || "");
  const urls = extractMediaUrls(content || "");
  const withoutUrls = text.replace(/\[?https?:\/\/[^\]\s]+]?/g, "").trim();
  const imageHtml = urls.length
    ? `<div class="image-strip">${urls.map((url) => `
        <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
          <img src="${escapeHtml(url)}" alt="POPO 图片预览" loading="lazy" />
        </a>
      `).join("")}</div>`
    : "";
  const placeholder = /\[图片\]/.test(content || "") && !urls.length
    ? `<div class="image-placeholder">图片占位：当前 POPO 搜索结果只返回 [图片]，需要后端接入附件下载接口后才能展示原图。</div>`
    : "";
  return `<p>${withoutUrls || text}</p>${imageHtml}${placeholder}`;
}

function extractMediaUrls(content) {
  const matches = String(content || "").match(/https?:\/\/[^\]\s]+/g) || [];
  return [...new Set(matches.filter((url) => /popofp|popo\.fp|vipfp/.test(url)))];
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
