/* =========================
 * WebLLM 初始化
 * ========================= */
let engine;
(async () => {
  try {
    engine = await webllm.CreateWebWorkerEngine(
      new Worker("https://unpkg.com/@mlc-ai/web-llm/dist/worker.js", { type: "module" }),
      { model: "Llama-3.2-1B-Instruct-q4f32_1-MLC" }
    );
  } catch (e) { console.warn("WebLLM init failed:", e); }
})();

/* =========================
 * DOM & Canvas
 * ========================= */
const messagesEl = document.getElementById("messages"),
      promptEl   = document.getElementById("prompt"),
      sendBtn    = document.getElementById("send"),
      canvas     = document.getElementById("poster"),
      ctx        = canvas.getContext("2d"),
      dlBtn      = document.getElementById("download");

function addMsg(role, text){
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "user" : "bot");
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* =========================
 * 配置（放大字体 & 自适应范围）
 * ========================= */
const SETTINGS = {
  canvas: { width: 1404, height: 993 },      // A3横向≈150dpi
  bandHeight: 160,                            // 顶部色带高度
  marginX: 60,                                // 文本左右留白
  stripe: {                                   // 斜线警示边框参数（默认值，会被 UI 覆盖）
    width: 22,
    gap: 28,
    frame: 16
  },
  solidBorderWidth: 14,                       // 实线边框线宽
  fonts: {
    jpTitle:       "800 90px 'Noto Sans JP'",
    jpSubtitle:    "600 46px 'Noto Sans JP'",
    jpNote:        "400 34px 'Noto Sans JP'",
    enTitle:       "700 42px 'Noto Sans JP'",
    enSubtitle:    "italic 36px 'Noto Sans JP'",
    enNote:        "400 32px 'Noto Sans JP'",
    zhTitle:       "700 38px 'Noto Sans JP'",
    zhBody:        "400 34px 'Noto Sans JP'"
  },
  lineHeights: {
    jpTitle: 72, jpSubtitle: 56, jpNote: 48,
    enTitle: 50, enSubtitle: 46, enNote: 42,
    zhTitle: 46, zhBody: 42
  },
  paragraphSpacing: 14,
  autoFit: {                                  // 标题字号自适应范围（放大）
    jpTitle: { minPx: 42, maxPx: 100, step: 2 },
    enTitle: { minPx: 34, maxPx: 56, step: 2 },
    zhTitle: { minPx: 34, maxPx: 54, step: 2 }
  },
  ui: {                                       // UI 面板控制的动态参数
    fontScale: 1.0,
    paragraphSpacing: 14,
    stripeWidth: 22,
    stripeGap: 28
  }
};

/* =========================
 * 安全类别配色
 * ========================= */
const SAFETY = {
  warning:     { base: "#F9A900" }, // 注意・警告（黄）
  prohibition: { base: "#C62828" }, // 禁止・停止（赤）
  mandatory:   { base: "#005387" }, // 指示・義務（青）
  safe:        { base: "#237F52" }, // 安全・避難（緑）
  fire:        { base: "#C62828" }, // 防火（赤）
  neutral:     { base: "#2B2B2C" }  // 中立（黑/灰）
};

/* =========================
 * LLM 系统提示（自由输入→结构化JSON）
 * ========================= */
const SYSTEM_PROMPT = `
あなたは倉庫安全ポスターのコピーライター兼DTP担当です。
ユーザーの要望を倉庫現場の掲示ポスターに最適化し、必ず次のJSONのみで返答してください（前後に説明や余計な文字を含めない）。

{
  "jp": { "title":"", "subtitle":"", "note":"" },
  "en": { "title":"", "subtitle":"", "note":"" },
  "zh": { "title":"", "subtitle":"", "note":"" },
  "category": "warning|prohibition|mandatory|safe|fire|neutral",
  "border": "stripes|solid|none",
  "size": "A3横|A3縦",
  "icon": "任意キーワード（例：forklift, pedestrian, exit）"
}

必須:
- jp.title は1行で簡潔（例: 通行注意 / 仮置き禁止 / 非常口）
- 内容に応じた category を選択（注意=warning, 禁止=prohibition, 安全/出口=safe, 指示=mandatory 等）
- border は 注意/禁止→stripes 推奨、情報/区域→solid 推奨、不要なら none
- EN/ZH は可能な限り補完（なければ空文字で可）
`;

/* =========================
 * 关键词预设 & 类别矫正（非常口 / 安全第一）
 * ========================= */
const PRESETS = [
  {
    match: /(非常口|emergency\s*exit|避難口)/i,
    spec: {
      jp: { title: "非常口", subtitle: "前に物を置かない" },
      en: { title: "Emergency exit", subtitle: "Do not place items here" },
      zh: { note: "紧急出口前禁止放置物品" },
      category: "safe",
      border: "solid",
      size: "A3横",
      icon: "exit"
    }
  },
  {
    match: /(安全(第一)?|safety( first)?)/i,
    spec: {
      jp: { title: "安全第一", subtitle: "指差呼称・周囲確認" },
      en: { title: "Safety First" },
      zh: { note: "安全第一，谨慎作业" },
      category: "warning",
      border: "solid",
      size: "A3横",
      icon: "helmet"
    }
  }
];

function matchPreset(userText){
  for (const p of PRESETS) {
    if (p.match.test(userText)) return structuredClone(p.spec);
  }
  return null;
}
function mergeWithPreset(llmSpec, preset){
  if (!preset) return llmSpec;
  const merged = structuredClone(llmSpec || {});
  merged.jp = { ...(llmSpec?.jp || {}), ...(preset.jp || {}) };
  merged.en = { ...(llmSpec?.en || {}), ...(preset.en || {}) };
  merged.zh = { ...(llmSpec?.zh || {}), ...(preset.zh || {}) };
  if (preset.category) merged.category = preset.category;
  if (preset.border)   merged.border   = preset.border;
  if (preset.size)     merged.size     = preset.size;
  if (preset.icon)     merged.icon     = preset.icon;
  return merged;
}

/* =========================
 * 文本工具：字号自适应 + 换行
 * ========================= */
function withFontSize(fontSpec, px){
  return fontSpec.replace(/(?<=\s)(\d+(?:\.\d+)?)px(?=\s*['"]?)/, `${px}px`);
}
function canFitSingleLine(text, fontSpec, maxWidth){
  ctx.font = fontSpec;
  return ctx.measureText(text).width <= maxWidth;
}
/** 单行自适应：考虑 fontScale，把可用宽度缩小为 maxWidth/scale，再把字号乘回 scale 输出 */
function fitSingleLine(text, baseFont, maxWidth, {minPx=28, maxPx=80, step=2}={}, scale=1){
  const available = maxWidth / Math.max(scale, 0.1);
  for(let px=maxPx; px>=minPx; px-=step){
    const f = withFontSize(baseFont, px);
    if (canFitSingleLine(text, f, available)) {
      return { font: withFontSize(baseFont, Math.round(px*scale)), size: Math.round(px*scale), wrapped: false };
    }
  }
  // 放不下：按最小字号 * scale，再换行
  const minScaled = Math.round(minPx * scale);
  return { font: withFontSize(baseFont, minScaled), size: minScaled, wrapped: true };
}
function wrapLines(text, font, maxWidth) {
  if (!text) return [];
  ctx.font = font;
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (let i=0; i<words.length; i++){
    const test = line ? line + " " + words[i] : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* =========================
 * 边框：斜线警示 & 实线
 * ========================= */
function drawStripeBorder(ctx, w, h, color){
  const stripeW = SETTINGS.ui.stripeWidth;
  const gap     = SETTINGS.ui.stripeGap;
  const frame   = SETTINGS.stripe.frame;

  ctx.save();
  // 外框
  ctx.lineWidth = frame;
  ctx.strokeStyle = color;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  // 斜纹区域
  ctx.beginPath();
  ctx.rect(28, 28, w - 56, h - 56);
  ctx.clip();
  // 斜纹
  ctx.strokeStyle = color;
  ctx.lineWidth = stripeW;
  const diag = Math.sqrt(w*w + h*h);
  ctx.rotate(-Math.PI / 6);
  for (let x = -diag; x < diag * 2; x += stripeW + gap) {
    ctx.beginPath();
    ctx.moveTo(x, -diag);
    ctx.lineTo(x, diag * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/* =========================
 * 主绘制：整体水平+垂直居中
 * ========================= */
let lastSpec = null;

function drawPoster(spec){
  lastSpec = spec;
  const W = SETTINGS.canvas.width, H = SETTINGS.canvas.height;
  canvas.width = W; canvas.height = H;

  // 背景 & 顶部色带（按类别颜色）
  const band = SAFETY[spec.category]?.base || "#999";
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = band;   ctx.fillRect(0,0,W,SETTINGS.bandHeight);

  // 边框（条纹取类别色，实线同色）
  if (spec.border === "stripes") {
    drawStripeBorder(ctx, W, H, band);
  } else if (spec.border === "solid") {
    ctx.strokeStyle = band; ctx.lineWidth = SETTINGS.solidBorderWidth;
    ctx.strokeRect(10,10,W-20,H-20);
  }

  // 文本准备（标题先单行自适应；全部块居中）
  const maxWidth = W - SETTINGS.marginX * 2;
  const centerX  = W / 2;
  const scale    = Math.max(SETTINGS.ui.fontScale, 0.1);
  const paraGap  = Math.round(SETTINGS.ui.paragraphSpacing);
  const blocks = [];
  function addBlock(lines, font, color, lh){
    if(lines && lines.length) blocks.push({lines, font, color, lineHeight: Math.round(lh * scale)});
  }

  const jp=spec.jp||{}, en=spec.en||{}, zh=spec.zh||{};

  // JP Title 单行自适应→必要时换行（考虑 scale）
  if (jp.title) {
    const fit = fitSingleLine(jp.title, SETTINGS.fonts.jpTitle, maxWidth, SETTINGS.autoFit.jpTitle, scale);
    const lines = fit.wrapped ? wrapLines(jp.title, fit.font, maxWidth) : [jp.title];
    addBlock(lines, fit.font, "#111", SETTINGS.lineHeights.jpTitle);
  }
  // 其余文本：把字号整体 * scale 再换行
  function scaleFont(fontSpec){ // 把指定字体的 px * scale
    const m = fontSpec.match(/(\d+(?:\.\d+)?)px/);
    const px = m ? parseFloat(m[1]) : 32;
    return withFontSize(fontSpec, Math.round(px * scale));
  }

  if (jp.subtitle) addBlock(wrapLines(jp.subtitle, scaleFont(SETTINGS.fonts.jpSubtitle), maxWidth), scaleFont(SETTINGS.fonts.jpSubtitle), "#333", SETTINGS.lineHeights.jpSubtitle);
  if (jp.note)     addBlock(wrapLines(jp.note,     scaleFont(SETTINGS.fonts.jpNote),     maxWidth), scaleFont(SETTINGS.fonts.jpNote),     "#444", SETTINGS.lineHeights.jpNote);

  if (en.title) {
    const fit = fitSingleLine(en.title, SETTINGS.fonts.enTitle, maxWidth, SETTINGS.autoFit.enTitle, scale);
    const lines = fit.wrapped ? wrapLines(en.title, fit.font, maxWidth) : [en.title];
    addBlock(lines, fit.font, "#1a1a1a", SETTINGS.lineHeights.enTitle);
  }
  if (en.subtitle) addBlock(wrapLines(en.subtitle, scaleFont(SETTINGS.fonts.enSubtitle), maxWidth), scaleFont(SETTINGS.fonts.enSubtitle), "#1a1a1a", SETTINGS.lineHeights.enSubtitle);
  if (en.note)     addBlock(wrapLines(en.note,     scaleFont(SETTINGS.fonts.enNote),     maxWidth), scaleFont(SETTINGS.fonts.enNote),     "#222",    SETTINGS.lineHeights.enNote);

  if (zh.title) {
    const fit = fitSingleLine(zh.title, SETTINGS.fonts.zhTitle, maxWidth, SETTINGS.autoFit.zhTitle, scale);
    const lines = fit.wrapped ? wrapLines(zh.title, fit.font, maxWidth) : [zh.title];
    addBlock(lines, fit.font, "#222", SETTINGS.lineHeights.zhTitle);
  }
  if (zh.subtitle) addBlock(wrapLines(zh.subtitle, scaleFont(SETTINGS.fonts.zhBody), maxWidth), scaleFont(SETTINGS.fonts.zhBody), "#222", SETTINGS.lineHeights.zhBody);
  if (zh.note)     addBlock(wrapLines(zh.note,     scaleFont(SETTINGS.fonts.zhBody), maxWidth), scaleFont(SETTINGS.fonts.zhBody), "#222", SETTINGS.lineHeights.zhBody);

  // 计算总高度并垂直居中
  let totalH = 0;
  for(const b of blocks){ totalH += b.lines.length*b.lineHeight + paraGap; }
  totalH -= paraGap; // 最后一个块不加间距
  let y = (H + SETTINGS.bandHeight)/2 - totalH/2;

  // 绘制（中心对齐）
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for(const b of blocks){
    ctx.font = b.font;
    ctx.fillStyle = b.color;
    for(const ln of b.lines){
      ctx.fillText(ln, centerX, y);
      y += b.lineHeight;
    }
    y += paraGap;
  }
}

/* =========================
 * JSON 解析 & 生成流程（含预设与矫正）
 * ========================= */
function parseJSONLoose(text){
  if (!text) return null;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = m ? m[1] : text;
  try { return JSON.parse(body); } catch { return null; }
}

async function generatePoster(userText){
  addMsg("user", userText);
  let data;

  if (engine) {
    const reply = await engine.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userText }
      ],
      max_tokens: 500
    });
    const raw = reply.choices?.[0]?.message?.content || "";
    data = parseJSONLoose(raw);
  }

  // 预设匹配（非常口 / 安全第一 等）
  const preset = matchPreset(userText);
  if (preset) {
    data = mergeWithPreset(data, preset);
  }

  // 类别兜底矫正
  if (/(非常口|emergency\s*exit|避難口)/i.test(userText)) {
    data = data || {};
    data.category = "safe";
    data.border = data.border || "solid";
    data.jp = data.jp || {}; data.en = data.en || {}; data.zh = data.zh || {};
    data.jp.title     = data.jp.title     || "非常口";
    data.jp.subtitle  = data.jp.subtitle  || "前に物を置かない";
    data.en.title     = data.en.title     || "Emergency exit";
    data.en.subtitle  = data.en.subtitle  || "Do not place items here";
    data.zh.note      = data.zh.note      || "紧急出口前禁止放置物品";
  }
  if (/(^|[^日])安全(第一)?([^一]|$)|safety( first)?/i.test(userText) && !/(非常口|emergency\s*exit|避難口)/i.test(userText)) {
    data = data || {};
    data.category = "warning";
    data.border = data.border || "solid";
    data.jp = data.jp || {};
    data.jp.title = data.jp.title || "安全第一";
  }

  // 回退默认
  if (!data) {
    data = {
      jp: { title: "通行注意", subtitle: "走行車両あり" },
      en: { subtitle: "Watch for vehicles" },
      zh: { note: "行人应小心行驶车辆" },
      category: "warning",
      border: "stripes",
      size: "A3横",
      icon: "forklift"
    };
  }

  // 保护字段
  const spec = {
    jp: data.jp || {},
    en: data.en || {},
    zh: data.zh || {},
    category: (["warning","prohibition","mandatory","safe","fire","neutral"].includes(data.category) ? data.category : "warning"),
    border: (["stripes","solid","none"].includes(data.border) ? data.border : "solid"),
    size: data.size || "A3横",
    icon: data.icon || ""
  };

  addMsg("bot",
    `JP: ${spec.jp.title || ""}${spec.jp.subtitle ? " / " + spec.jp.subtitle : ""}\n` +
    `EN: ${spec.en.title || ""}${spec.en.subtitle ? " / " + spec.en.subtitle : ""}\n` +
    `ZH: ${spec.zh.title || ""}${spec.zh.subtitle ? " / " + spec.zh.subtitle : ""}\n` +
    `カテゴリ: ${spec.category}, 枠: ${spec.border}`
  );

  drawPoster(spec);
}

/* =========================
 * 可折叠控制面板（右上角）
 * ========================= */
function createControlPanel(){
  // Toggle 按钮
  const btn = document.createElement("button");
  btn.textContent = "⚙︎";
  btn.title = "显示/隐藏参数面板";
  btn.style.cssText = `
    position: fixed; top: 16px; right: 16px; z-index: 1000;
    width: 40px; height: 40px; border-radius: 20px; border: none;
    background: #0a84ff; color: #fff; font-weight: 800; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,.15);
  `;
  document.body.appendChild(btn);

  // 面板
  const panel = document.createElement("div");
  panel.style.cssText = `
    position: fixed; top: 64px; right: 16px; z-index: 999;
    width: 240px; padding: 12px; border-radius: 10px;
    background: rgba(255,255,255,.98); border: 1px solid #e6e8eb;
    font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans JP", sans-serif;
    box-shadow: 0 6px 20px rgba(0,0,0,.12); display: none;
  `;
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <strong>参数调节</strong>
      <span id="ui-close" style="cursor:pointer;padding:4px 8px;border-radius:6px;background:#f3f4f6;">✕</span>
    </div>

    <label>字体缩放：<span id="v-font">${SETTINGS.ui.fontScale.toFixed(2)}</span></label>
    <input id="ui-font" type="range" min="0.6" max="1.5" step="0.05" value="${SETTINGS.ui.fontScale}" style="width:100%;margin:6px 0 10px;">

    <label>段落间距：<span id="v-para">${SETTINGS.ui.paragraphSpacing}</span></label>
    <input id="ui-para" type="range" min="6" max="40" step="2" value="${SETTINGS.ui.paragraphSpacing}" style="width:100%;margin:6px 0 10px;">

    <label>斜纹宽度：<span id="v-sw">${SETTINGS.ui.stripeWidth}</span></label>
    <input id="ui-stripeW" type="range" min="10" max="50" step="2" value="${SETTINGS.ui.stripeWidth}" style="width:100%;margin:6px 0 10px;">

    <label>斜纹间距：<span id="v-sg">${SETTINGS.ui.stripeGap}</span></label>
    <input id="ui-stripeG" type="range" min="10" max="60" step="2" value="${SETTINGS.ui.stripeGap}" style="width:100%;margin:6px 0 4px;">
  `;
  document.body.appendChild(panel);

  // 交互
  btn.onclick = () => { panel.style.display = panel.style.display === "none" ? "block" : "none"; };
  panel.querySelector("#ui-close").onclick = () => { panel.style.display = "none"; };

  const fontInput = panel.querySelector("#ui-font");
  const paraInput = panel.querySelector("#ui-para");
  const swInput   = panel.querySelector("#ui-stripeW");
  const sgInput   = panel.querySelector("#ui-stripeG");

  const vFont = panel.querySelector("#v-font");
  const vPara = panel.querySelector("#v-para");
  const vSW   = panel.querySelector("#v-sw");
  const vSG   = panel.querySelector("#v-sg");

  fontInput.oninput = e => {
    SETTINGS.ui.fontScale = parseFloat(e.target.value);
    vFont.textContent = SETTINGS.ui.fontScale.toFixed(2);
    redrawLast();
  };
  paraInput.oninput = e => {
    SETTINGS.ui.paragraphSpacing = parseInt(e.target.value, 10);
    vPara.textContent = SETTINGS.ui.paragraphSpacing;
    redrawLast();
  };
  swInput.oninput = e => {
    SETTINGS.ui.stripeWidth = parseInt(e.target.value, 10);
    vSW.textContent = SETTINGS.ui.stripeWidth;
    redrawLast();
  };
  sgInput.oninput = e => {
    SETTINGS.ui.stripeGap = parseInt(e.target.value, 10);
    vSG.textContent = SETTINGS.ui.stripeGap;
    redrawLast();
  };
}
function redrawLast(){ if(lastSpec) drawPoster(lastSpec); }
createControlPanel();

/* =========================
 * 事件 & 初始海报
 * ========================= */
sendBtn.onclick = () => {
  const t = promptEl.value.trim();
  if (t) generatePoster(t);
};
promptEl.addEventListener("keydown", e => { if (e.key === "Enter") sendBtn.click(); });

dlBtn.onclick = () => {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url; a.download = "poster.png"; a.click();
};

// 初始海报（演示）
drawPoster({
  jp: { title: "安全第一", subtitle: "指差呼称・周囲確認・事故ゼロへ" },
  en: { subtitle: "Safety First" },
  zh: { note: "安全第一，谨慎作业" },
  category: "warning",
  border: "solid",
  size: "A3横"
});
