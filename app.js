const samples = {
  digestCommand: "总结 H55 报价群今天的沟通内容，提取进展、风险、待办和需要确认的问题",
  digestInput:
    "张三：H55 本周外包角色立绘完成 6 张，剩余 2 张等主美确认。\n李四：供应商 A 报价已回，单张 1800，周五可交初稿。\n王五：合同还缺对方营业执照和开户许可证。\n赵六：昨天提交的 3 张图有两处需要改，肩甲比例和配色要收敛。",
  supplierInput:
    "供应商 A：角色立绘单张 1800，8 张一起做可到 1650。初稿本周五，终稿下周三。需要补角色设定、参考图和验收标准。主美反馈肩甲比例偏大，配色要更接近阵营色。",
  meetingInput:
    "会议结论：第一期先接 H55 美术报价群。张三本周五前完成原型，李四下周三前整理 POPO 消息接口，王五月底前确认归档字段。风险是 Muse 和 ArcoLab 的字段映射还没定。",
  processInput:
    "这个供应商报价可以走了，先立项，合同模板我晚点发。验收图主美已确认，结算时需要报价单、合同、验收确认和发票信息。",
  archiveInput:
    "@POPO AI 请归档 H55 角色立绘第 3 批材料。附件：报价单.xlsx、合同扫描.pdf、验收图.zip。缺供应商营业执照和最终验收确认截图，后续可能要同步 Muse / ArcoLab。"
};

const sceneCards = document.querySelectorAll(".scene-card");
const jumpButtons = document.querySelectorAll("[data-jump]");
const panels = document.querySelectorAll(".panel");
const activeTitle = document.querySelector("#activeTitle");
const activeSubtitle = document.querySelector("#activeSubtitle");

sceneCards.forEach((item) => {
  item.addEventListener("click", () => activatePanel(item.dataset.panel));
});

jumpButtons.forEach((button) => {
  button.addEventListener("click", () => activatePanel(button.dataset.jump));
});

document.querySelectorAll(".sample").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(`#${button.dataset.target}`).value = samples[button.dataset.target];
  });
});

document.querySelectorAll("[data-load-slice]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.querySelector(`#${button.dataset.loadSlice}`);
    target.value = await loadPopoSlice();
  });
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "digest") renderDigest();
    if (action === "supplier") renderSupplier();
    if (action === "meeting") renderMeeting();
    if (action === "process") renderProcess();
    if (action === "archive") renderArchive();
  });
});

function activatePanel(panelName) {
  panels.forEach((panel) => panel.classList.remove("active"));
  sceneCards.forEach((card) => card.classList.remove("active"));

  const panel = document.querySelector(`#panel-${panelName}`);
  const card = document.querySelector(`.scene-card[data-panel="${panelName}"]`);
  panel.classList.add("active");
  card?.classList.add("active");
  activeTitle.textContent = panel.dataset.title;
  activeSubtitle.textContent = panel.dataset.subtitle;
}

function renderDigest() {
  const command = valueOf("digestCommand");
  const input = valueOf("digestInput");
  const parsed = parseDigestCommand(command);
  const group = parsed.groupName || valueOf("digestGroup") || "当前群";
  const range = parsed.period || document.querySelector("#digestRange").value;
  const result = document.querySelector("#digestResult");

  if (!command && !input) {
    result.innerHTML = emptyState("请输入需求指令，例如“总结 H55 报价群今天的沟通内容”，或粘贴群消息。");
    return;
  }

  if (parsed.groupName) document.querySelector("#digestGroup").value = parsed.groupName;
  if (parsed.period) selectDigestRange(parsed.period);

  const cards = [
    intentCard(parsed, group, range),
    card(`${group} ${range}进展`, buildProgressItems(input, parsed)),
    card("风险", buildRiskItems(input, parsed)),
    card("待办", buildTodoItems(input, parsed)),
    card("需要确认", buildQuestionItems(input, parsed))
  ];

  result.innerHTML = cards.join("");
}

function parseDigestCommand(command) {
  const text = command.trim();
  const groupName = extractGroupName(text);
  const groupType = extractGroupType(text);
  const period = extractPeriod(text);
  const focuses = extractFocuses(text);

  return {
    raw: text,
    groupName,
    groupType,
    period,
    focuses,
    intent: text.includes("周报") ? "生成周报" : "生成日报",
    dataScope: groupName ? "指定群" : groupType ? "群类型" : "当前群"
  };
}

function extractGroupName(text) {
  const directMatch = text.match(/(?:总结|整理|看一下|看下|分析)?\s*([A-Za-z0-9\u4e00-\u9fa5【】\-_\s]{2,30}?群)/);
  if (!directMatch) return "";
  return directMatch[1].replace(/^(一下|下|帮我|请|把)/, "").trim();
}

function extractGroupType(text) {
  if (/供应商|外包|商务/.test(text)) return "供应商类群";
  if (/报价|排期|费用|预算/.test(text)) return "报价类群";
  if (/验收|交付|收稿/.test(text)) return "验收类群";
  if (/合同|立项|结算|流程/.test(text)) return "流程类群";
  if (/项目|需求|制作/.test(text)) return "项目沟通群";
  if (/所有群|全部群|相关群|哪一类群|某类群/.test(text)) return "相关群";
  return "";
}

function extractPeriod(text) {
  if (/周报|本周|这周|近一周|最近一周|过去一周/.test(text)) return "过去一周";
  if (/昨天/.test(text)) return "昨天";
  if (/今天|今日|日报|过去一天|近一天/.test(text)) return "过去一天";
  if (/最近|近几天/.test(text)) return "最近";
  return "";
}

function extractFocuses(text) {
  const focuses = [];
  if (/进展|进度|完成/.test(text)) focuses.push("进展");
  if (/风险|阻塞|问题/.test(text)) focuses.push("风险");
  if (/待办|todo|行动项|下一步/.test(text)) focuses.push("待办");
  if (/确认|待确认|需要确认/.test(text)) focuses.push("确认项");
  if (/报价|费用|排期/.test(text)) focuses.push("报价排期");
  if (/验收|交付/.test(text)) focuses.push("验收交付");
  return focuses.length ? focuses : ["进展", "风险", "待办", "确认项"];
}

function selectDigestRange(period) {
  const select = document.querySelector("#digestRange");
  [...select.options].forEach((option) => {
    option.selected = option.textContent === period || (period === "昨天" && option.textContent === "过去一天");
  });
}

function intentCard(parsed, group, range) {
  const chips = [
    `意图：${parsed.intent}`,
    `范围：${parsed.dataScope}`,
    `群：${group}`,
    parsed.groupType ? `类型：${parsed.groupType}` : "",
    `周期：${range}`,
    `关注：${parsed.focuses.join("、")}`
  ].filter(Boolean);

  return `
    <div class="result-card intent-card">
      <h3>已理解你的需求</h3>
      <div class="chip-row">${chips.map((chip) => `<span>${chip}</span>`).join("")}</div>
      <p>后续接入真实 POPO 时，会先解析群名或群类型，再按权限拉取对应时间范围内的群消息，最后生成结构化日报或周报。</p>
    </div>
  `;
}

function buildProgressItems(input, parsed) {
  if (/报价|报价单|排期/.test(input + parsed.raw)) {
    return ["报价单、报价排期或报价修改正在等待确认。", "部分供应商已反馈排期，适合进入确认或回写流程。"];
  }
  return ["群内已有明确进展信息，建议按事项归类到需求、报价、验收三个维度。", "当前切片可生成日报，接入真实 POPO 后可自动覆盖指定群和时间段。"];
}

function buildRiskItems(input, parsed) {
  const risks = [];
  if (/保密|PSD|截图/.test(input)) risks.push("涉及保密要求，验收材料不能包含 PSD 或制作内容。");
  if (/暂停|调整/.test(input)) risks.push("部分需求暂停或内部调整，报价确认前需要先确认需求是否继续。");
  if (/合同|营业执照|开户/.test(input)) risks.push("合同或供应商资质材料不完整，可能影响后续流程。");
  return risks.length ? risks : ["未发现明确阻塞，但建议继续确认报价、排期和验收材料口径。"];
}

function buildTodoItems(input, parsed) {
  const todos = [];
  if (/报价|排期/.test(input + parsed.raw)) todos.push("确认报价排期和报价单是否为最终版本。");
  if (/验收|截图|收稿/.test(input + parsed.raw)) todos.push("补充 POPO 群内项目组确认收稿截图。");
  if (/合同|营业执照|开户/.test(input)) todos.push("补齐供应商营业执照、开户许可证等合同材料。");
  return todos.length ? todos : ["按群消息继续补充负责人、截止时间和下一步动作。"];
}

function buildQuestionItems(input, parsed) {
  const questions = ["本次总结是否只覆盖当前群，还是需要扩展到同类型群？"];
  if (/报价|排期/.test(input + parsed.raw)) questions.push("报价排期是否已最终确认？");
  if (/验收|截图/.test(input + parsed.raw)) questions.push("验收记录上传入口和截图标准是否统一？");
  if (/暂停|调整/.test(input)) questions.push("暂停需求是否需要撤回供应商报价动作？");
  return questions;
}

function renderSupplier() {
  const input = valueOf("supplierInput");
  const result = document.querySelector("#supplierResult");
  if (!input) {
    result.innerHTML = "请先粘贴供应商沟通记录。";
    return;
  }
  result.innerHTML = `
    <table class="record-table">
      <tr><th>字段</th><th>整理结果</th></tr>
      <tr><td>供应商 / 群</td><td>供应商甲、供应商乙、供应商丙等报价相关群</td></tr>
      <tr><td>报价</td><td>多条消息涉及报价单、报价排期、排期报价修改</td></tr>
      <tr><td>交付时间</td><td>当前切片未出现明确日期，需要继续读取附件或上下文</td></tr>
      <tr><td>修改意见</td><td>有需求暂停、内部调整、报价需最终确认等信息</td></tr>
      <tr><td>待补材料</td><td>报价附件、项目组确认截图、验收记录上传说明</td></tr>
      <tr><td>下一步</td><td>逐群确认报价排期是否有效；对验收截图和保密要求形成统一口径</td></tr>
    </table>
  `;
}

function renderMeeting() {
  const input = valueOf("meetingInput");
  const result = document.querySelector("#meetingResult");
  if (!input) {
    result.innerHTML = emptyState("请先粘贴会议纪要或群讨论。");
    return;
  }
  result.innerHTML = `
    <div class="task-row"><strong>下一步动作</strong><strong>负责人</strong><strong>截止时间</strong></div>
    <div class="task-row"><span>完成 POPO AI 原型</span><span>张三</span><span class="tag">本周五</span></div>
    <div class="task-row"><span>整理 POPO 消息接口</span><span>李四</span><span class="tag">下周三</span></div>
    <div class="task-row"><span>确认归档字段</span><span>王五</span><span class="tag">月底前</span></div>
    <div class="task-row"><span>梳理 Muse / ArcoLab 字段映射</span><span>待定</span><span class="tag warn">需确认</span></div>
  `;
}

function renderProcess() {
  const input = valueOf("processInput");
  const result = document.querySelector("#processResult");
  if (!input) {
    result.innerHTML = emptyState("请先粘贴包含流程关键词的群聊内容。");
    return;
  }
  result.innerHTML = [
    card("报价确认", ["检测到关键词：报价、报价单、报价排期。", "建议准备：报价单附件、需求范围、排期、最终确认人。"]),
    card("需求变更", ["检测到关键词：需求暂停、内部调整。", "建议确认：是否暂停报价、是否通知供应商、是否保留当前排期。"]),
    card("验收", ["检测到关键词：验收、POPO 验收记录、确认收稿截图。", "建议准备：项目组确认收稿截图，且截图不要带制作内容。"]),
    card("保密", ["检测到关键词：保密等级高、不要交 PSD。", "建议提醒：验收材料只提交允许范围内的截图或记录。"])
  ].join("");
}

function renderArchive() {
  const input = valueOf("archiveInput");
  const result = document.querySelector("#archiveResult");
  if (!input) {
    result.innerHTML = "请先粘贴 @机器人 和附件信息。";
    return;
  }
  result.innerHTML = `
    <strong>归档检查清单</strong>
    <ul class="check-list">
      <li class="done">已检测：报价单.xlsx</li>
      <li class="done">已检测：合同扫描.pdf</li>
      <li class="done">已检测：验收图.zip</li>
      <li class="missing">缺失：供应商营业执照</li>
      <li class="missing">缺失：最终验收确认截图</li>
    </ul>
    <p class="next-step">建议动作：先补齐缺失材料；材料完整后可生成 Muse / ArcoLab 同步任务。</p>
  `;
}

function valueOf(id) {
  return document.querySelector(`#${id}`).value.trim();
}

async function loadPopoSlice() {
  const response = await fetch("./data/popo-slice.json");
  const slice = await response.json();
  return slice.messages.map((message) => `${message.sessionName} / ${message.memberName}：${message.content}`).join("\n");
}

function card(title, items) {
  return `<div class="result-card"><h3>${title}</h3><ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul></div>`;
}

function emptyState(text) {
  return `<div class="answer-box">${text}</div>`;
}
