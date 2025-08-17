/* =========================
 * WebLLM 初期化
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
 * DOM
 * ========================= */
const messagesEl = document.getElementById("messages"),
      promptEl   = document.getElementById("prompt"),
      sendBtn    = document.getElementById("send"),
      canvas     = document.getElementById("poster"),
      ctx        = canvas.getContext("2d"),
      dlBtn      = document.getElementById("download");

function addMsg(role, text){
  // 只显示机器人消息
  if (role === "user") return;
  const div = document.createElement("div");
  div.className = "msg bot";
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* =========================
 * 設定
 * ========================= */
const SETTINGS = {
  canvas: { width: 1404, height: 993 },   // 既定 A3 横
  bandHeight: 160,
  marginX: 60,
  stripe: { width: 22, gap: 28, frame: 16, ringGap: 10 }, // ringGap: 斜纹与面板的最小间距
  solidBorderWidth: 14,
  panel: { paddingX: 42, paddingY: 30, radius: 18, marginX: 40, marginY: 24, shadow: true },
  fonts: {
    jpTitle:    "800 90px 'Noto Sans JP'",
    jpSubtitle: "600 46px 'Noto Sans JP'",
    jpNote:     "400 34px 'Noto Sans JP'",
    enTitle:    "700 42px 'Noto Sans JP'",
    enSubtitle: "italic 36px 'Noto Sans JP'",
    enNote:     "400 32px 'Noto Sans JP'",
    zhTitle:    "700 38px 'Noto Sans JP'",
    zhBody:     "400 34px 'Noto Sans JP'"
  },
  lineHeights: {
    jpTitle: 72, jpSubtitle: 56, jpNote: 48,
    enTitle: 50, enSubtitle: 46, enNote: 42,
    zhTitle: 46, zhBody: 42
  },
  paragraphSpacing: 14,
  autoFit: {
    jpTitle: { minPx: 42, maxPx: 100, step: 2 },
    enTitle: { minPx: 34, maxPx: 56,  step: 2 },
    zhTitle: { minPx: 34, maxPx: 54,  step: 2 }
  },
  ui: { fontScale: 1.0, paragraphSpacing: 14, stripeWidth: 22, stripeGap: 28 }
};

/* =========================
 * カラー
 * ========================= */
const SAFETY = {
  warning:     { base: "#F9A900" },
  prohibition: { base: "#C62828" },
  mandatory:   { base: "#005387" },
  safe:        { base: "#237F52" },
  fire:        { base: "#C62828" },
  neutral:     { base: "#2B2B2C" }
};

/* =========================
 * LLM プロンプト
 * ========================= */
const SYSTEM_PROMPT = `
あなたは倉庫安全ポスターのコピーライター兼DTP担当です。
必ず次のJSONのみで返答してください。

{
  "jp": { "title":"", "subtitle":"", "note":"" },
  "en": { "title":"", "subtitle":"", "note":"" },
  "zh": { "title":"", "subtitle":"", "note":"" },
  "category": "warning|prohibition|mandatory|safe|fire|neutral",
  "border": "stripes|solid|none",
  "size": "A3横|A3縦|A4横|A4縦|A0~A5 など",
  "icon": "任意キーワード"
}

必須: jp.title は1行で簡潔（例: 通行注意 / 仮置き禁止 / 非常口 / 体温測定 / 衝突注意）
`;

/* =========================
 * 尺寸解析（自然语言）
 * ========================= */
const SQRT2 = Math.SQRT2;
const PAPER_BASE = { name:"A3", orient:"横", w:1404, h:993 };
function paperFromText(text){
  const m = text && text.match(/A([0-5])\s*(横|縦|landscape|portrait)?/i);
  if (m){
    const n = parseInt(m[1],10);
    const orient = (m[2]||"横").replace(/landscape/i,"横").replace(/portrait/i,"縦");
    const delta = 3 - n; // 相对 A3 的差
    const factor = Math.pow(SQRT2, delta);
    const baseW = PAPER_BASE.w * factor, baseH = PAPER_BASE.h * factor;
    const w = Math.round(orient==="横" ? baseW : baseH);
    const h = Math.round(orient==="横" ? baseH : baseW);
    return { name:`A${n}`, orient, w, h };
  }
  const p = text && text.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})\s*(?:px)?/i);
  if (p) return { name:"Custom", orient:"横", w:parseInt(p[1],10), h:parseInt(p[2],10) };
  return null;
}
function applyCanvasSizeBySpec(sizeStr, userText){
  const p = paperFromText(userText) || paperFromText(sizeStr);
  if (p){ SETTINGS.canvas.width = p.w; SETTINGS.canvas.height = p.h; return p; }
  return { name:PAPER_BASE.name, orient:PAPER_BASE.orient, w:SETTINGS.canvas.width, h:SETTINGS.canvas.height };
}

/* =========================
 * プリセット
 * ========================= */
const PRESETS = [
  { // 体温/健康
    match: /(体温|検温|測温|测温|temperature\s*check|health\s*check|注意身体|体調|体调|发烧|fever)/i,
    spec: {
      jp: { title: "体温測定", note: "体調に変化があれば すぐに報告してください" },
      en: { subtitle: "Have you taken your temperature?", note: "Please report any changes immediately" },
      zh: { note: "是否已测量体温？有异常请立即报告" },
      category: "mandatory", border: "stripes", size: "A3横", icon: "thermometer"
    }
  },
  { // 非常口
    match: /(非常口|emergency\s*exit|避難口)/i,
    spec: {
      jp: { title: "非常口", subtitle: "前に物を置かない" },
      en: { title: "Emergency exit", subtitle: "Do not place items here" },
      zh: { note: "紧急出口前禁止放置物品" },
      category: "safe", border: "solid", size: "A3横", icon: "exit"
    }
  },
  { // 衝突
    match: /(衝突事故|衝突|冲突|collision|接触事故|ぶつかり)/i,
    spec: {
      jp: { title: "衝突注意" },
      en: { subtitle: "Watch for collisions" },
      zh: { note: "注意冲突" },
      category: "warning", border: "stripes", size: "A3横", icon: "collision"
    }
  },
  { // 仮置き
    match: /(仮置き|临时放置|temporary\s*placement)/i,
    spec: {
      jp: { title: "仮置き禁止", subtitle: "通路・ラインを確保" },
      en: { subtitle: "No temporary placement" },
      zh: { note: "禁止临时堆放" },
      category: "prohibition", border: "stripes", size: "A3横", icon: "no-box"
    }
  },
  { // 安全第一
    match: /(安全(第一)?|safety( first)?)/i,
    spec: {
      jp: { title: "安全第一", subtitle: "指差呼称・周囲確認" },
      en: { title: "Safety First" },
      zh: { note: "安全第一，谨慎作业" },
      category: "warning", border: "solid", size: "A3横", icon: "helmet"
    }
  }
];
function matchPreset(t){ for (const p of PRESETS) if (p.match.test(t)) return structuredClone(p.spec); return null; }
function mergeWithPreset(a,b){
  if(!b) return a;
  const m = structuredClone(a||{});
  m.jp = { ...(a?.jp||{}), ...(b.jp||{}) };
  m.en = { ...(a?.en||{}), ...(b.en||{}) };
  m.zh = { ...(a?.zh||{}), ...(b.zh||{}) };
  if(b.category) m.category=b.category;
  if(b.border)   m.border=b.border;
  if(b.size)     m.size=b.size;
  if(b.icon)     m.icon=b.icon;
  return m;
}

/* =========================
 * 文本工具
 * ========================= */
function withFontSize(fontSpec, px){ return fontSpec.replace(/(?<=\s)(\d+(?:\.\d+)?)px(?=\s*['"]?)/, `${px}px`); }
function getPx(fontSpec){ const m = fontSpec.match(/(\d+(?:\.\d+)?)px/); return m ? parseFloat(m[1]) : 32; }
function canFitSingleLine(text, fontSpec, maxWidth){ ctx.font = fontSpec; return ctx.measureText(text).width <= maxWidth; }
function fitSingleLine(text, baseFont, maxWidth, {minPx=28, maxPx=80, step=2}={}, scale=1){
  const available = maxWidth / Math.max(scale, 0.1);
  for(let px=maxPx; px>=minPx; px-=step){
    const f = withFontSize(baseFont, px);
    if (canFitSingleLine(text, f, available)) return { font: withFontSize(baseFont, Math.round(px*scale)), size: Math.round(px*scale), wrapped: false };
  }
  const minScaled = Math.round(minPx * scale);
  return { font: withFontSize(baseFont, minScaled), size: minScaled, wrapped: true };
}
function wrapLines(text, font, maxWidth){
  if (!text) return [];
  ctx.font = font;
  const words = text.split(/\s+/), lines = [];
  let line = "";
  for (let i=0;i<words.length;i++){
    const test = line ? line+" "+words[i] : words[i];
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = words[i]; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/* ---- 关键改进：逐行精确测量包围盒 ---- */
function measureLine(text, font){
  ctx.font = font;
  const m = ctx.measureText(text);
  const px = getPx(font);
  const ascent  = (m.actualBoundingBoxAscent  != null) ? m.actualBoundingBoxAscent  : px*0.80;
  const descent = (m.actualBoundingBoxDescent != null) ? m.actualBoundingBoxDescent : px*0.20;
  const left    = (m.actualBoundingBoxLeft    != null) ? m.actualBoundingBoxLeft    : px*0.08;
  const right   = (m.actualBoundingBoxRight   != null) ? m.actualBoundingBoxRight   : Math.max(m.width, px*0.92);
  const width   = Math.max(m.width, left + right);
  return { ascent, descent, left, right, width };
}

/* =========================
 * 圆角矩形 & 斜纹（环形）
 * ========================= */
function roundRectPath(x,y,w,h,r=12){
  const p = new Path2D();
  const rr = Math.max(0, Math.min(r, Math.min(w,h)/2));
  p.moveTo(x+rr,y);
  p.arcTo(x+w,y,x+w,y+h,rr);
  p.arcTo(x+w,y+h,x,y+h,rr);
  p.arcTo(x,y+h,x,y,rr);
  p.arcTo(x,y,x+w,y,rr);
  p.closePath(); return p;
}
function drawStripeRingAroundRect(ctx, w, h, color, innerRect, radius){
  const stripeW = SETTINGS.ui.stripeWidth, gap = SETTINGS.ui.stripeGap, frame = SETTINGS.stripe.frame;

  // 环形裁剪：外框 - 内面板（留出 ringGap）
  const inset = SETTINGS.stripe.ringGap;
  const inner = roundRectPath(innerRect.x - inset, innerRect.y - inset, innerRect.w + inset*2, innerRect.h + inset*2, Math.max(0, radius - 4));

  ctx.save();
  const outer = new Path2D();
  outer.addPath(roundRectPath(10,10,w-20,h-20,16));
  outer.addPath(inner);
  ctx.clip(outer, "evenodd");

  ctx.strokeStyle = color; ctx.lineWidth = stripeW;
  const diag = Math.sqrt(w*w + h*h);
  ctx.translate(w/2, h/2);
  ctx.rotate(-Math.PI/6);
  ctx.translate(-w/2, -h/2);
  for(let x=-diag; x<diag*2; x+=stripeW+gap){
    ctx.beginPath(); ctx.moveTo(x, -diag); ctx.lineTo(x, diag*2); ctx.stroke();
  }
  ctx.restore();

  // 外边框
  ctx.save(); ctx.lineWidth = frame; ctx.strokeStyle = color;
  ctx.stroke(roundRectPath(10,10,w-20,h-20,16));
  ctx.restore();
}

/* =========================
 * レイアウト（返回精确包围盒参数）
 * ========================= */
function layoutBlocks(spec){
  const W = SETTINGS.canvas.width, H = SETTINGS.canvas.height;
  const maxWidth = W - SETTINGS.marginX * 2;
  const scale = Math.max(SETTINGS.ui.fontScale, 0.1);
  const paraGap = Math.round(SETTINGS.ui.paragraphSpacing);
  const blocks=[];

  function addBlock(lines, font, color, lh){ if(lines && lines.length) blocks.push({lines, font, color, lineHeight: Math.round(lh*scale)}); }
  function scaleFont(fontSpec){ const px=getPx(fontSpec); return withFontSize(fontSpec, Math.round(px*scale)); }

  const jp=spec.jp||{}, en=spec.en||{}, zh=spec.zh||{};

  if (jp.title){
    const fit = fitSingleLine(jp.title, SETTINGS.fonts.jpTitle, maxWidth, SETTINGS.autoFit.jpTitle, scale);
    const lines = fit.wrapped ? wrapLines(jp.title, fit.font, maxWidth) : [jp.title];
    addBlock(lines, fit.font, "#111", SETTINGS.lineHeights.jpTitle);
  }
  if (jp.subtitle) addBlock(wrapLines(jp.subtitle, scaleFont(SETTINGS.fonts.jpSubtitle), maxWidth), scaleFont(SETTINGS.fonts.jpSubtitle), "#333", SETTINGS.lineHeights.jpSubtitle);
  if (jp.note)     addBlock(wrapLines(jp.note,     scaleFont(SETTINGS.fonts.jpNote),     maxWidth), scaleFont(SETTINGS.fonts.jpNote),     "#444", SETTINGS.lineHeights.jpNote);

  if (en.title){
    const fit = fitSingleLine(en.title, SETTINGS.fonts.enTitle, maxWidth, SETTINGS.autoFit.enTitle, scale);
    const lines = fit.wrapped ? wrapLines(en.title, fit.font, maxWidth) : [en.title];
    addBlock(lines, fit.font, "#1a1a1a", SETTINGS.lineHeights.enTitle);
  }
  if (en.subtitle) addBlock(wrapLines(en.subtitle, scaleFont(SETTINGS.fonts.enSubtitle), maxWidth), scaleFont(SETTINGS.fonts.enSubtitle), "#1a1a1a", SETTINGS.lineHeights.enSubtitle);
  if (en.note)     addBlock(wrapLines(en.note,     scaleFont(SETTINGS.fonts.enNote),     maxWidth), scaleFont(SETTINGS.fonts.enNote),     "#222", SETTINGS.lineHeights.enNote);

  if (zh.title){
    const fit = fitSingleLine(zh.title, SETTINGS.fonts.zhTitle, maxWidth, SETTINGS.autoFit.zhTitle, scale);
    const lines = fit.wrapped ? wrapLines(zh.title, fit.font, maxWidth) : [zh.title];
    addBlock(lines, fit.font, "#222", SETTINGS.lineHeights.zhTitle);
  }
  if (zh.subtitle) addBlock(wrapLines(zh.subtitle, scaleFont(SETTINGS.fonts.zhBody), maxWidth), scaleFont(SETTINGS.fonts.zhBody), "#222", SETTINGS.lineHeights.zhBody);
  if (zh.note)     addBlock(wrapLines(zh.note,     scaleFont(SETTINGS.fonts.zhBody), maxWidth), scaleFont(SETTINGS.fonts.zhBody), "#222", SETTINGS.lineHeights.zhBody);

  // 逐行测量，精确获取最宽与上下外延
  let totalH = 0, maxLeft = 0, maxRight = 0, firstAscent = 0, lastDescent = 0;
  blocks.forEach((b, bi) => {
    ctx.font = b.font;
    b.lines.forEach((ln, li) => {
      const m = measureLine(ln, b.font);
      maxLeft  = Math.max(maxLeft,  m.left);
      maxRight = Math.max(maxRight, m.right);
      if (bi === 0 && li === 0) firstAscent = m.ascent;
      if (bi === blocks.length-1 && li === b.lines.length-1) lastDescent = m.descent;
    });
    totalH += b.lines.length * b.lineHeight;
    if (bi !== blocks.length - 1) totalH += paraGap; // 只在段落之间加间距（修正）
  });

  const textWidth = maxLeft + maxRight; // 实际左右外延
  return { blocks, totalH, textWidth, maxWidth, scale, paraGap, firstAscent, lastDescent };
}

/* =========================
 * 描画
 * ========================= */
let lastSpec = null;

function drawPoster(spec){
  lastSpec = spec;
  const W = SETTINGS.canvas.width, H = SETTINGS.canvas.height;
  canvas.width = W; canvas.height = H;

  // 背景
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,W,H);

  // 排版参数
  const L = layoutBlocks(spec);
  const bandColor = SAFETY[spec.category]?.base || "#999";

  // 顶部色带
  ctx.fillStyle = bandColor;
  ctx.fillRect(0,0,W,SETTINGS.bandHeight);

  // 计算内容面板的精确矩形（考虑 ascent / descent / 斜体外延）
  const centerX = W/2;
  // 第一行基线位置
  const firstBaselineY = (H + SETTINGS.bandHeight)/2 - L.totalH/2;
  const contentTop    = firstBaselineY - L.firstAscent;
  const contentBottom = firstBaselineY + L.totalH + L.lastDescent;
  const contentHeight = contentBottom - contentTop;

  const padX = SETTINGS.panel.paddingX;
  const padY = SETTINGS.panel.paddingY;

  let panelW = Math.min(L.textWidth + padX*2, W - SETTINGS.panel.marginX*2);
  let panelH = Math.min(contentHeight + padY*2, H - (SETTINGS.bandHeight + SETTINGS.panel.marginY) - SETTINGS.panel.marginY);

  let panelX = Math.max(SETTINGS.panel.marginX, centerX - panelW/2);
  let panelY = Math.max(SETTINGS.bandHeight + SETTINGS.panel.marginY, contentTop - padY);

  // 若底部会溢出，则整体上移
  if (panelY + panelH > H - SETTINGS.panel.marginY) {
    panelY = H - SETTINGS.panel.marginY - panelH;
  }

  const panelPath = roundRectPath(panelX, panelY, panelW, panelH, SETTINGS.panel.radius);

  // 斜纹围绕（用面板矩形做内环）
  if (spec.border === "stripes") {
    drawStripeRingAroundRect(ctx, W, H, bandColor, {x:panelX, y:panelY, w:panelW, h:panelH}, SETTINGS.panel.radius);
  } else if (spec.border === "solid") {
    ctx.strokeStyle = bandColor; ctx.lineWidth = SETTINGS.solidBorderWidth;
    ctx.stroke(roundRectPath(10,10,W-20,H-20,16));
  }

  // 白色面板（有阴影）
  ctx.save();
  if (SETTINGS.panel.shadow){
    ctx.shadowColor = "rgba(0,0,0,.06)";
    ctx.shadowBlur = 12;
  }
  ctx.fillStyle = "#fff";
  ctx.fill(panelPath);
  ctx.restore();

  // 文本（按真实基线绘制；段落间距只在段落间）
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let y = firstBaselineY;
  const cx = centerX;
  L.blocks.forEach((b, bi) => {
    ctx.font = b.font; ctx.fillStyle = b.color;
    b.lines.forEach(ln => { ctx.fillText(ln, cx, y); y += b.lineHeight; });
    if (bi !== L.blocks.length - 1) y += L.paraGap; // 只在段落间加
  });
}

/* =========================
 * 自然な日本語返信
 * ========================= */
function formatBotReply(spec, sizeInfo){
  const catMap = { warning:"黄色の警告", prohibition:"赤の禁止", mandatory:"青の指示", safe:"緑の安全", fire:"防火", neutral:"中立" };
  const jp=spec.jp||{}, en=spec.en||{}, zh=spec.zh||{};
  const bits=[];
  if(jp.title) bits.push(`見出し：「${jp.title}」${jp.subtitle?`（${jp.subtitle}）`:""}`);
  if(en.title || en.subtitle) bits.push(`英文：${[en.title,en.subtitle].filter(Boolean).join(" / ")}`);
  if(zh.title || zh.subtitle || zh.note) bits.push(`中国語：${[zh.title,zh.subtitle,zh.note].filter(Boolean).join(" / ")}`);
  const sizeTxt = sizeInfo ? `${sizeInfo.name}・${sizeInfo.orient}（${sizeInfo.w}×${sizeInfo.h}px）` : `${SETTINGS.canvas.width}×${SETTINGS.canvas.height}px`;
  return `了解しました。内容に合わせてレイアウトを最適化しました。\n- ${bits.join("\n- ")}\n- スタイル：${catMap[spec.category]||spec.category}、枠は「${spec.border==="stripes"?"斜線":"実線"}」\n- 用紙サイズ：${sizeTxt}\n右上のギアでフォント倍率・行間・斜線の太さ/間隔を調整できます。`;
}

/* =========================
 * 生成フロー
 * ========================= */
function parseJSONLoose(t){ if(!t) return null; const m=t.match(/```(?:json)?\s*([\s\S]*?)```/i); const body=m?m[1]:t; try{return JSON.parse(body);}catch{return null;} }

async function generatePoster(userText){
  let data;
  if (engine) {
    const reply = await engine.chat.completions.create({
      messages: [{ role:"system", content: SYSTEM_PROMPT }, { role:"user", content: userText }],
      max_tokens: 500
    });
    data = parseJSONLoose(reply.choices?.[0]?.message?.content || "");
  }

  // 尺寸先应用
  const sizeInfo = applyCanvasSizeBySpec(data?.size, userText);

  // 预设与补正
  const preset = matchPreset(userText); if (preset) data = mergeWithPreset(data, preset);

  if (/(体温|検温|測温|测温|temperature\s*check|health\s*check|注意身体|体調|体调|发烧|fever)/i.test(userText)) {
    data = data || {}; data.category="mandatory"; data.border = data.border || "stripes";
  }
  if (/(非常口|emergency\s*exit|避難口)/i.test(userText)) {
    data = data || {}; data.category="safe"; data.border = data.border || "solid";
    data.jp = data.jp || {}; data.jp.title = data.jp.title || "非常口"; data.jp.subtitle = data.jp.subtitle || "前に物を置かない";
    data.en = data.en || {}; data.en.title = data.en.title || "Emergency exit"; data.en.subtitle = data.en.subtitle || "Do not place items here";
    data.zh = data.zh || {}; data.zh.note = data.zh.note || "紧急出口前禁止放置物品";
  }
  if (/(衝突事故|衝突|冲突|collision|接触事故|ぶつかり)/i.test(userText)) {
    data = data || {}; data.category="warning"; data.border = data.border || "stripes";
    data.jp = data.jp || {}; data.jp.title = data.jp.title || "衝突注意";
  }
  if (/(仮置き|临时放置|temporary\s*placement)/i.test(userText)) {
    data = data || {}; data.category="prohibition"; data.border = data.border || "stripes";
    data.jp = data.jp || {}; data.jp.title = data.jp.title || "仮置き禁止"; data.jp.subtitle = data.jp.subtitle || "通路・ラインを確保";
  }

  if (!data) {
    data = { jp:{title:"通行注意", subtitle:"走行車両あり"}, en:{subtitle:"Watch for vehicles"}, zh:{note:"行人应小心行驶车辆"}, category:"warning", border:"stripes", size:"A3横", icon:"forklift" };
  }

  const spec = {
    jp: data.jp || {}, en: data.en || {}, zh: data.zh || {},
    category: (["warning","prohibition","mandatory","safe","fire","neutral"].includes(data.category) ? data.category : "warning"),
    border: (["stripes","solid","none"].includes(data.border) ? data.border : "solid"),
    size: data.size || "A3横", icon: data.icon || ""
  };

  addMsg("bot", formatBotReply(spec, sizeInfo));
  drawPoster(spec);
}

/* =========================
 * 控制面板（可折叠）
 * ========================= */
function createControlPanel(){
  const btn = document.createElement("button");
  btn.textContent = "⚙︎"; btn.title = "設定";
  btn.style.cssText = `
    position: fixed; top: 16px; right: 16px; z-index: 1000;
    width: 56px; height: 56px; border-radius: 28px; border: none;
    background: #0a84ff; color: #fff; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 28px; line-height: 1;
    box-shadow: 0 6px 18px rgba(10,132,255,.35);
  `;
  document.body.appendChild(btn);

  const panel = document.createElement("div");
  panel.style.cssText = `
    position: fixed; top: 84px; right: 16px; z-index: 999;
    width: 270px; padding: 12px; border-radius: 12px;
    background: rgba(255,255,255,.98); border: 1px solid #e6e8eb;
    font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans JP", sans-serif;
    box-shadow: 0 10px 24px rgba(0,0,0,.12); display: none;
  `;
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <strong>表示設定</strong>
      <span id="ui-close" style="cursor:pointer;padding:4px 8px;border-radius:6px;background:#f3f4f6;">✕</span>
    </div>

    <label>フォント倍率：<span id="v-font">${SETTINGS.ui.fontScale.toFixed(2)}</span></label>
    <input id="ui-font" type="range" min="0.6" max="1.5" step="0.05" value="${SETTINGS.ui.fontScale}" style="width:100%;margin:6px 0 10px;">

    <label>段落スペース：<span id="v-para">${SETTINGS.ui.paragraphSpacing}</span></label>
    <input id="ui-para" type="range" min="6" max="40" step="2" value="${SETTINGS.ui.paragraphSpacing}" style="width:100%;margin:6px 0 10px;">

    <label>斜線の太さ：<span id="v-sw">${SETTINGS.ui.stripeWidth}</span></label>
    <input id="ui-stripeW" type="range" min="10" max="50" step="2" value="${SETTINGS.ui.stripeWidth}" style="width:100%;margin:6px 0 10px;">

    <label>斜線の間隔：<span id="v-sg">${SETTINGS.ui.stripeGap}</span></label>
    <input id="ui-stripeG" type="range" min="10" max="60" step="2" value="${SETTINGS.ui.stripeGap}" style="width:100%;margin:6px 0 4px;">

    <label>面板左右余白(px)：<span id="v-padx">${SETTINGS.panel.paddingX}</span></label>
    <input id="ui-padx" type="range" min="12" max="100" step="2" value="${SETTINGS.panel.paddingX}" style="width:100%;margin:6px 0 10px;">

    <label>面板上下余白(px)：<span id="v-pady">${SETTINGS.panel.paddingY}</span></label>
    <input id="ui-pady" type="range" min="8" max="100" step="2" value="${SETTINGS.panel.paddingY}" style="width:100%;margin:6px 0 10px;">
  `;
  document.body.appendChild(panel);

  btn.onclick = () => { panel.style.display = panel.style.display === "none" ? "block" : "none"; };
  panel.querySelector("#ui-close").onclick = () => { panel.style.display = "none"; };

  const $ = s => panel.querySelector(s);
  const update = () => redrawLast();

  $("#ui-font").oninput    = e => { SETTINGS.ui.fontScale        = parseFloat(e.target.value); $("#v-font").textContent = SETTINGS.ui.fontScale.toFixed(2); update(); };
  $("#ui-para").oninput    = e => { SETTINGS.ui.paragraphSpacing = parseInt(e.target.value,10); $("#v-para").textContent = SETTINGS.ui.paragraphSpacing;    update(); };
  $("#ui-stripeW").oninput = e => { SETTINGS.ui.stripeWidth      = parseInt(e.target.value,10); $("#v-sw").textContent   = SETTINGS.ui.stripeWidth;         update(); };
  $("#ui-stripeG").oninput = e => { SETTINGS.ui.stripeGap        = parseInt(e.target.value,10); $("#v-sg").textContent   = SETTINGS.ui.stripeGap;           update(); };
  $("#ui-padx").oninput    = e => { SETTINGS.panel.paddingX      = parseInt(e.target.value,10); $("#v-padx").textContent = SETTINGS.panel.paddingX;         update(); };
  $("#ui-pady").oninput    = e => { SETTINGS.panel.paddingY      = parseInt(e.target.value,10); $("#v-pady").textContent = SETTINGS.panel.paddingY;         update(); };
}
function redrawLast(){ if(lastSpec) drawPoster(lastSpec); }
createControlPanel();

/* =========================
 * 输入/下载/键盘
 * ========================= */
let composing = false;
promptEl.addEventListener("compositionstart", () => composing = true);
promptEl.addEventListener("compositionend",   () => composing = false);
promptEl.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    if (e.isComposing || composing) return;
    if (e.shiftKey) return;               // Shift+Enter 换行
    e.preventDefault(); sendBtn.click();  // Enter 送信
  }
});
sendBtn.onclick = () => {
  const t = promptEl.value.trim();
  if (t) { generatePoster(t); }
  promptEl.value = "";
};
dlBtn.onclick = () => {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a"); a.href = url; a.download = "poster.png"; a.click();
};

/* =========================
 * 初期表示
 * ========================= */
drawPoster({
  jp: { title: "安全第一", subtitle: "指差呼称・周囲確認・事故ゼロへ" },
  en: { subtitle: "Safety First" },
  zh: { note: "安全第一，谨慎作业" },
  category: "warning",
  border: "solid",
  size: "A3横"
});
