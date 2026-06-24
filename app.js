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

const sunbinRiskRules = [
  {
    id: "quote-reviewable",
    level: "高",
    scene: ["digest", "supplier", "process", "archive"],
    title: "报价材料不可复核",
    keywords: ["报价", "报价单", "报价表", "截图", "糊", "源文件", "合计", "数量", "资源", "单号", "PDF"],
    concern: "报价表需要能让不熟项目的审核同学独立核对需求名、资源、数量、环节、人天、合计和单号。",
    action: "补清晰报价表或 PDF，截图标注资源对应关系，并把确认记录补到任务详情。"
  },
  {
    id: "reuse-model",
    level: "中",
    scene: ["digest", "supplier", "process"],
    title: "复用模型或 AI 模型影响人天判断",
    keywords: ["复用", "白模", "AI", "模型", "高模", "低模", "中模", "贴图", "烘焙", "粘连", "对称"],
    concern: "有模型不等于自动降人天，需要确认复用比例、拆分难度、贴图和重新制作工作量。",
    action: "请接口或制作负责人确认复用比例，再让供应商按实际工作量重报或备注。"
  },
  {
    id: "change-supplement",
    level: "高",
    scene: ["digest", "supplier", "process", "archive"],
    title: "需求变更、取消或增补未同步报价",
    keywords: ["变更", "增补", "补充", "取消", "暂停", "删减", "返修", "重报", "重新报价", "原单", "关单"],
    concern: "范围减少未改零会多付，范围增加未走增补会影响结算依据。",
    action: "确认原单是否已关单；未关单优先原单变更，已关单则判断新单、拆单或增补。"
  },
  {
    id: "arcolab-apc-split",
    level: "中",
    scene: ["digest", "supplier", "process", "archive"],
    title: "ArcoLab / APC 单据和报价口径混淆",
    keywords: ["ArcoLab", "APC", "单独任务", "拆单", "总报价", "任务详情", "人天数", "限制", "上限"],
    concern: "独立 ArcoLab 任务要单独确认排期报价；APC 总报价、人天和任务详情不一致会影响审核。",
    action: "把整单报价表、任务详情标记和 APC 单号对齐，超过限制时走特批或最新 APC 指引。"
  },
  {
    id: "contract-validity",
    level: "高",
    scene: ["digest", "supplier", "process", "archive"],
    title: "合同或主体材料未就绪",
    keywords: ["合同", "电子签", "签署", "营业执照", "开户", "主体", "框架", "单笔", "补充协议", "额度", "倒签"],
    concern: "合同不存在、主体不一致或额度不足时，不建议继续发包、入场或结款。",
    action: "先确认有效合同、签署状态、合同额度和主体信息；缺资质材料先补齐。"
  },
  {
    id: "settlement-quality",
    level: "高",
    scene: ["digest", "supplier", "process", "archive"],
    title: "结算金额、人天和质量扣款不一致",
    keywords: ["结算", "结款", "金额", "人天", "扣款", "质量", "验收比例", "操作日志", "发票", "开单金额"],
    concern: "质量验收比例会同时影响金额和最终结算人天，系统页面和操作日志必须说清楚。",
    action: "核对报价单、APC 单、验收记录、扣款比例和发票信息，异常时带单号找支持同事确认。"
  },
  {
    id: "acceptance-confidential",
    level: "中",
    scene: ["digest", "process", "archive"],
    title: "验收与保密材料口径不清",
    keywords: ["验收", "收稿", "确认截图", "PSD", "保密", "高保", "制作内容", "Muse", "QC"],
    concern: "验收材料需要可追溯，但高保或制作内容不能随意出现在截图、PSD 或归档附件里。",
    action: "保留项目组确认收稿截图，按保密要求裁剪或替换敏感画面，再同步 Muse / QC / ArcoLab。"
  },
  {
    id: "dispatch-before-order",
    level: "高",
    scene: ["digest", "supplier", "process"],
    title: "外派 / 驻场先入场后补单",
    keywords: ["外派", "驻场", "入场", "续期", "替换", "招聘", "派工", "开单", "报价完成", "三级经理"],
    concern: "驻场外包应先确认制作内容、开单和供应商报价，不能先入场后补单。",
    action: "核对是否替换、单次是否超过 1 个月、累计是否超过 3 个月；长周期需三级经理确认。"
  },
  {
    id: "guide-price",
    level: "中",
    scene: ["digest", "supplier", "process"],
    title: "单价超过指导价或职级不明",
    keywords: ["指导价", "超上限", "职级", "单价", "OP", "特批", "报备", "乘系数"],
    concern: "外派单价不能只看姓名和岗位，需核对项目、环节、PM、入场时间、职级和乘系数后单价。",
    action: "补齐指导价超上限模板字段，邮件报备审批后再推进入场或报价确认。"
  },
  {
    id: "supplier-compliance",
    level: "中",
    scene: ["supplier", "process", "archive"],
    title: "供应商准入和派工材料不完整",
    keywords: ["供应商", "简历", "身份证", "在职", "委派函", "NDA", "手机号", "照片", "银行", "账户"],
    concern: "供应商人员、银行信息、委派函、NDA 或账号权限缺失，会影响入场、保密协议和结算效率。",
    action: "补齐供应商风险确认、真实手机号、无美颜照片、委派函、高保 NDA 和银行信息变更材料。"
  },
  {
    id: "price-private-chat",
    level: "中",
    scene: ["supplier", "process"],
    title: "供应商绕开采购谈价",
    keywords: ["私聊", "议价", "价格", "采购", "接口", "PM", "谈价"],
    concern: "供应商不应绕开采购和项目接口私下确认价格，避免报价依据不可追溯。",
    action: "把议价和确认口径拉回报价群或采购 BP 记录，保留最终确认截图。"
  },
  {
    id: "review-ownership",
    level: "中",
    scene: ["digest", "meeting", "process"],
    title: "责任人或下一步不清",
    keywords: ["谁", "负责人", "对接人", "PM", "接口", "确认", "待定", "跟进", "下周", "月底"],
    concern: "流程推进要落到责任人、时间点和下一步，否则日报只能描述现象，不能推动闭环。",
    action: "补负责人、截止时间和需要谁确认；跨系统问题带单号、字段和异常现象同步支持同事。"
  }
];

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
  const analysis = analyzeWithSunbinSkill(`${command}\n${input}`, "digest");

  if (!command && !input) {
    result.innerHTML = emptyState("请输入需求指令，例如“总结 H55 报价群今天的沟通内容”，或粘贴群消息。");
    return;
  }

  if (parsed.groupName) document.querySelector("#digestGroup").value = parsed.groupName;
  if (parsed.period) selectDigestRange(parsed.period);

  const cards = [
    intentCard(parsed, group, range),
    sunbinInsightCard(analysis),
    card(`${group} ${range}进展`, buildProgressItems(input, parsed)),
    card("风险", buildRiskItems(input, parsed, analysis)),
    card("待办", buildTodoItems(input, parsed, analysis)),
    card("需要确认", buildQuestionItems(input, parsed, analysis))
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

function buildRiskItems(input, parsed, analysis = analyzeWithSunbinSkill(input + parsed.raw, "digest")) {
  const risks = analysis.matches.slice(0, 4).map((item) => `${item.title}：${item.concern}`);
  return risks.length ? risks : ["未发现明确阻塞；仍建议按报价、合同、APC、验收、结算五项做一次复核。"];
}

function buildTodoItems(input, parsed, analysis = analyzeWithSunbinSkill(input + parsed.raw, "digest")) {
  const todos = analysis.matches.slice(0, 4).map((item) => item.action);
  if (!todos.length && /报价|排期/.test(input + parsed.raw)) todos.push("确认报价排期和报价单是否为最终版本。");
  if (!todos.length && /验收|截图|收稿/.test(input + parsed.raw)) todos.push("补充 POPO 群内项目组确认收稿截图。");
  return todos.length ? todos : ["按群消息继续补充负责人、截止时间、单号和下一步动作。"];
}

function buildQuestionItems(input, parsed, analysis = analyzeWithSunbinSkill(input + parsed.raw, "digest")) {
  const questions = ["本次总结是否只覆盖当前群，还是需要扩展到同类型群？"];
  analysis.questions.slice(0, 4).forEach((question) => questions.push(question));
  if (/报价|排期/.test(input + parsed.raw)) questions.push("报价排期是否已最终确认？");
  if (/验收|截图/.test(input + parsed.raw)) questions.push("验收记录上传入口和截图标准是否统一？");
  if (/暂停|调整/.test(input)) questions.push("暂停需求是否需要撤回供应商报价动作？");
  return [...new Set(questions)].slice(0, 6);
}

function renderSupplier() {
  const input = valueOf("supplierInput");
  const result = document.querySelector("#supplierResult");
  if (!input) {
    result.innerHTML = "请先粘贴供应商沟通记录。";
    return;
  }
  const analysis = analyzeWithSunbinSkill(input, "supplier");
  result.innerHTML = `
    ${sunbinInsightCard(analysis)}
    <table class="record-table">
      <tr><th>字段</th><th>整理结果</th></tr>
      <tr><td>供应商 / 群</td><td>供应商甲、供应商乙、供应商丙等报价相关群</td></tr>
      <tr><td>报价</td><td>多条消息涉及报价单、报价排期、排期报价修改</td></tr>
      <tr><td>交付时间</td><td>当前切片未出现明确日期，需要继续读取附件或上下文</td></tr>
      <tr><td>修改意见</td><td>有需求暂停、内部调整、报价需最终确认等信息</td></tr>
      <tr><td>待补材料</td><td>${analysis.archiveItems.join("、")}</td></tr>
      <tr><td>下一步</td><td>${analysis.nextActions.slice(0, 3).join("；")}</td></tr>
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
  const analysis = analyzeWithSunbinSkill(input, "process");
  result.innerHTML = [
    sunbinInsightCard(analysis),
    ...analysis.matches.slice(0, 5).map((item) => card(item.title, [`风险等级：${item.level}`, item.concern, item.action]))
  ].join("");
}

function renderArchive() {
  const input = valueOf("archiveInput");
  const result = document.querySelector("#archiveResult");
  if (!input) {
    result.innerHTML = "请先粘贴 @机器人 和附件信息。";
    return;
  }
  const analysis = analyzeWithSunbinSkill(input, "archive");
  result.innerHTML = `
    ${sunbinInsightCard(analysis)}
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

function analyzeWithSunbinSkill(text, scene) {
  const source = normalizeText(text);
  const matches = sunbinRiskRules
    .filter((rule) => rule.scene.includes(scene))
    .map((rule) => ({ ...rule, score: scoreRule(rule, source) }))
    .filter((rule) => rule.score > 0)
    .sort((a, b) => levelWeight(b.level) - levelWeight(a.level) || b.score - a.score);

  const fallback = [
    "报价表是否能被不熟项目的审核同学独立复核？",
    "合同、APC/OA、供应商资质和结算材料是否已齐？",
    "是否已明确负责人、截止时间、单号和下一步？"
  ];

  const questions = matches.length
    ? matches.map((item) => questionForRule(item)).filter(Boolean)
    : fallback;

  const nextActions = matches.length
    ? [...new Set(matches.map((item) => item.action))]
    : ["先按报价、合同、APC、验收、结算五项做基础复核。"];

  return {
    matches,
    questions: [...new Set(questions)],
    nextActions,
    archiveItems: buildArchiveItems(source, matches)
  };
}

function normalizeText(text) {
  return (text || "").toLowerCase();
}

function scoreRule(rule, text) {
  return rule.keywords.reduce((score, keyword) => {
    return text.includes(keyword.toLowerCase()) ? score + 1 : score;
  }, 0);
}

function levelWeight(level) {
  if (level === "高") return 3;
  if (level === "中") return 2;
  return 1;
}

function questionForRule(rule) {
  const questions = {
    "quote-reviewable": "报价表是否已有需求名、资源、数量、环节、人天、合计和对应单号？",
    "reuse-model": "复用模型、白模或 AI 模型是否真的减少工作量，复用比例由谁确认？",
    "change-supplement": "这次变更是原单修改、增补、新开单，还是需要把取消项改零？",
    "arcolab-apc-split": "APC 单、ArcoLab 任务、人天合计和报价表是否完全一致？",
    "contract-validity": "当前是否有有效合同，主体、额度、签署状态和资质材料是否齐全？",
    "settlement-quality": "结算金额、人天、质量扣款比例和操作日志是否能相互对上？",
    "acceptance-confidential": "验收截图是否既能证明收稿，又不暴露高保或制作内容？",
    "dispatch-before-order": "外派或驻场是否已先完成制作内容确认、开单和供应商报价？",
    "guide-price": "单价是否超过指导价，职级、PM、入场时间和特批原因是否已补齐？",
    "supplier-compliance": "供应商准入、委派函、NDA、银行信息和账号权限是否已齐？",
    "price-private-chat": "议价和最终确认是否已回到采购可追溯的群或记录中？",
    "review-ownership": "负责人、确认人、截止时间和单号是否已明确？"
  };
  return questions[rule.id];
}

function buildArchiveItems(text, matches) {
  const items = ["报价表", "合同或有效签署记录", "验收确认截图"];
  if (/营业执照|开户|供应商|银行/.test(text)) items.push("供应商资质和银行信息");
  if (/apc|arcolab|muse|qc/i.test(text)) items.push("APC / ArcoLab / Muse 对照关系");
  if (matches.some((item) => item.id === "settlement-quality")) items.push("结算金额、人天和扣款依据");
  return [...new Set(items)];
}

function sunbinInsightCard(analysis) {
  const topMatches = analysis.matches.slice(0, 4);
  const body = topMatches.length
    ? topMatches.map((item) => `
        <li>
          <span class="risk-pill level-${item.level === "高" ? "high" : "mid"}">${item.level}风险</span>
          <strong>${item.title}</strong>
          <p>${item.concern}</p>
        </li>
      `).join("")
    : `<li><strong>未命中强风险</strong><p>仍按孙斌采购 BP 口径检查报价、合同、APC、验收、结算和责任人。</p></li>`;

  return `
    <div class="result-card sunbin-card">
      <h3>孙斌采购 BP 风险识别</h3>
      <ul class="risk-list">${body}</ul>
    </div>
  `;
}
