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
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "user" : "bot");
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* =========================
 * 設定
 * ========================= */
const SETTINGS = {
  canvas: { width: 1404, height: 993 },   // 既定 A3 横
  band: { height: 160, followCategory: true, colorOverride: null }, // 顶部色带
  marginX: 60,
  stripe: { width: 22, gap: 28, frame: 16, ringGap: 10 },
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
    const delta = 3 - n;
    const factor = Math.pow(SQRT2, delta);
    const baseW = PAPER_BASE.w * factor, baseH = PAPER_BASE.h * factor;
    const w = Math.round(orient==="横" ? baseW : baseH);
    const h = Math.round(orient==="横" ? baseH : baseW);
    return { name:`A${n}`, orient, w, h };
  }
  const p = text && text.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})\s*(?:px|ピクセル)?/i);
  if (p) return { name:"Custom", orient:"横", w:parseInt(p[1],10), h:parseInt(p[2],10) };
  return null;
}
function applyCanvasSizeBySpec(sizeStr, userText){
  const p = paperFromText(userText) || paperFromText(sizeStr);
  if (p){ SETTINGS.canvas.width = p.w; SETTINGS.canvas.height = p.h; return p; }
  return null;
}

/* =========================
 * 顶部色带：自然语言控制（中/日/英）
 * ========================= */
const COLOR_MAP = {
  "red":"#C62828","黄":"#F9A900","yellow":"#F9A900","blue":"#005387","green":"#237F52",
  "black":"#000000","white":"#ffffff","公司蓝":"#0a84ff","企业蓝":"#0a84ff","品牌蓝":"#0a84ff",
  "赤":"#C62828","レッド":"#C62828","イエロー":"#F9A900",
  "青":"#005387","ブルー":"#005387",
  "緑":"#237F52","グリーン":"#237F52",
  "黒":"#000000","ブラック":"#000000",
  "白":"#ffffff","ホワイト":"#ffffff",
  "会社ブルー":"#0a84ff","企業ブルー":"#0a84ff","コーポレートカラー":"#0a84ff","ブランドブルー":"#0a84ff"
};
function resolveColor(word){
  if (!word) return null;
  const hex = word.match(/#([0-9a-f]{3,8})/i);
  if (hex) return "#" + hex[1];
  const norm = word.replace(/(颜色?|色|カラー)$/i, "").toLowerCase();
  return COLOR_MAP[norm] || COLOR_MAP[word] || null;
}
function applyBandNaturalLanguage(text){
  if (!text) return null;
  let changed = false, info = {};
  const bandKW = "(?:色带|色塊|色块|顶部色块|顶端色带|上部色帯|ヘッダー帯|ヘッダー|ヘッダ|ヘッダー バンド|上部の帯|バンド)";

  if (new RegExp("(去掉|取消|不要|关闭|關閉|去除|隠す|非表示|無し|外す|オフ).*" + bandKW, "i").test(text)){
    SETTINGS.band.height = 0; changed = true; info.off = true;
  }
  if (new RegExp("(开启|打开|显示|顯示|表示|オン|出す|付ける).*" + bandKW, "i").test(text)){
    if (SETTINGS.band.height === 0) SETTINGS.band.height = 160;
    changed = true; info.off = false;
  }
  const h1 = text.match(new RegExp(bandKW + ".*?(?:高度|厚度|高さ|height)\\s*([0-9]{2,4})\\s*(?:px|ピクセル|像素)?", "i"));
  if (h1){ SETTINGS.band.height = Math.max(0, Math.min(400, parseInt(h1[1],10))); changed = true; info.height = SETTINGS.band.height; }
  if (new RegExp(bandKW + ".*?(加厚|更厚|厚一点|厚一些|厚く|太く|もっと厚く)", "i").test(text)){
    SETTINGS.band.height = Math.min(400, (SETTINGS.band.height||0) + 30); changed = true; info.height = SETTINGS.band.height;
  }
  if (new RegExp(bandKW + ".*?(更薄|变薄|薄く|細く|薄め|少し薄く)", "i").test(text)){
    SETTINGS.band.height = Math.max(0, (SETTINGS.band.height||0) - 30); changed = true; info.height = SETTINGS.band.height;
  }
  const c1 = text.match(new RegExp(bandKW + ".*?(?:颜色|色|カラー|color)\\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)", "i"));
  if (c1){
    const col = resolveColor(c1[1]);
    if (col){ SETTINGS.band.colorOverride = col; SETTINGS.band.followCategory = false; changed = true; info.color = col; }
  }
  if (/(跟随|隨|按|回到|恢复|還原|元に戻す|デフォルト|既定|カテゴリ連動|カテゴリー連動)/i.test(text)){
    SETTINGS.band.followCategory = true; SETTINGS.band.colorOverride = null; changed = true; info.follow = true;
  }
  return changed ? info : null;
}

/* =========================
 * プリセット（生成时兜底）
 * ========================= */
const PRESETS = [
  {
    match: /(体温|検温|測温|测温|temperature\s*check|health\s*check|注意身体|体調|体调|发烧|fever)/i,
    spec: {
      jp: { title: "体温測定", note: "体調に変化があれば すぐに報告してください" },
      en: { subtitle: "Have you taken your temperature?", note: "Please report any changes immediately" },
      zh: { note: "是否已测量体温？有异常请立即报告" },
      category: "mandatory", border: "stripes", size: "A3横", icon: "thermometer"
    }
  },
  {
    match: /(非常口|emergency\s*exit|避難口)/i,
    spec: {
      jp: { title: "非常口", subtitle: "前に物を置かない" },
      en: { title: "Emergency exit", subtitle: "Do not place items here" },
      zh: { note: "紧急出口前禁止放置物品" },
      category: "safe", border: "solid", size: "A3横", icon: "exit"
    }
  },
  {
    match: /(衝突事故|衝突|冲突|collision|接触事故|ぶつかり)/i,
    spec: {
      jp: { title: "衝突注意" },
      en: { subtitle: "Watch for collisions" },
      zh: { note: "注意冲突" },
      category: "warning", border: "stripes", size: "A3横", icon: "collision"
    }
  },
  {
    match: /(仮置き|临时放置|temporary\s*placement)/i,
    spec: {
      jp: { title: "仮置き禁止", subtitle: "通路・ラインを確保" },
      en: { subtitle: "No temporary placement" },
      zh: { note: "禁止临时堆放" },
      category: "prohibition", border: "stripes", size: "A3横", icon: "no-box"
    }
  },
  {
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
 * 文本工具 & 精确测量
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

  ctx.save(); ctx.lineWidth = frame; ctx.strokeStyle = color;
  ctx.stroke(roundRectPath(10,10,w-20,h-20,16));
  ctx.restore();
}

/* =========================
 * 排版（返回精确包围盒）
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
    if (bi !== blocks.length - 1) totalH += paraGap;
  });

  const textWidth = maxLeft + maxRight;
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

  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,W,H);

  const L = layoutBlocks(spec);
  const bandH = SETTINGS.band.height || 0;
  const bandColor = SETTINGS.band.followCategory
    ? (SAFETY[spec.category]?.base || "#999")
    : (SETTINGS.band.colorOverride || "#999");

  if (bandH > 0){ ctx.fillStyle = bandColor; ctx.fillRect(0,0,W,bandH); }

  const centerX = W/2;
  const firstBaselineY = (H + bandH)/2 - L.totalH/2;
  const contentTop    = firstBaselineY - L.firstAscent;
  const contentBottom = firstBaselineY + L.totalH + L.lastDescent;
  const contentHeight = contentBottom - contentTop;

  const padX = SETTINGS.panel.paddingX, padY = SETTINGS.panel.paddingY;

  let panelW = Math.min(L.textWidth + padX*2, W - SETTINGS.panel.marginX*2);
  let panelH = Math.min(contentHeight + padY*2, H - (bandH + SETTINGS.panel.marginY) - SETTINGS.panel.marginY);

  let panelX = Math.max(SETTINGS.panel.marginX, centerX - panelW/2);
  let panelY = Math.max(bandH + SETTINGS.panel.marginY, contentTop - padY);
  if (panelY + panelH > H - SETTINGS.panel.marginY) panelY = H - SETTINGS.panel.marginY - panelH;

  const panelPath = roundRectPath(panelX, panelY, panelW, panelH, SETTINGS.panel.radius);

  if (spec.border === "stripes") {
    drawStripeRingAroundRect(ctx, W, H, bandColor, {x:panelX, y:panelY, w:panelW, h:panelH}, SETTINGS.panel.radius);
  } else if (spec.border === "solid") {
    ctx.strokeStyle = bandColor; ctx.lineWidth = SETTINGS.solidBorderWidth;
    ctx.stroke(roundRectPath(10,10,W-20,H-20,16));
  }

  ctx.save();
  if (SETTINGS.panel.shadow){ ctx.shadowColor = "rgba(0,0,0,.06)"; ctx.shadowBlur = 12; }
  ctx.fillStyle = "#fff"; ctx.fill(panelPath);
  ctx.restore();

  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  let y = firstBaselineY, cx = centerX;
  L.blocks.forEach((b, bi) => {
    ctx.font = b.font; ctx.fillStyle = b.color;
    b.lines.forEach(ln => { ctx.fillText(ln, cx, y); y += b.lineHeight; });
    if (bi !== L.blocks.length - 1) y += L.paraGap;
  });
}

/* =========================
 * 编辑：自然语言对当前海报做修改
 * ========================= */
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
function pickLangKey(t){
  if (/(日文|日語|日本語|JP)/i.test(t)) return "jp";
  if (/(英文|英語|EN)/i.test(t)) return "en";
  if (/(中文|中国語|ZH)/i.test(t)) return "zh";
  return "jp"; // 默认改日文
}
function ensureLang(obj,k){ obj[k] = obj[k] || {}; return obj[k]; }
function quoted(text){
  const m = text.match(/[「『“"']([^「『“"']+)[」』”"']/);
  return m ? m[1].trim() : null;
}
function applyTextEdits(text, spec, changes){
  let changed = false;

  // 删除整种语言或字段
  if (/(去掉|删除|不要|消す|削除)(英文|英語|EN)/i.test(text)){ spec.en = {}; changes.push("英語を削除"); changed = true; }
  if (/(去掉|删除|不要|消す|削除)(中文|中国語|ZH)/i.test(text)){ spec.zh = {}; changes.push("中国語を削除"); changed = true; }
  if (/(去掉|删除|不要|消す|削除)(日文|日本語|JP)/i.test(text)){ spec.jp = {}; changes.push("日本語を削除"); changed = true; }

  // 具体字段：标题/副标题/备注
  const fieldRegs = [
    { key:"title",    cn:/(标题|標題|見出し|タイトル)/, jp:/(見出し|タイトル)/ },
    { key:"subtitle", cn:/(副标题|副題|サブタイトル)/,   jp:/(サブタイトル|副題)/ },
    { key:"note",     cn:/(备注|注记|注釈|ノート|注記)/,   jp:/(注記|注釈|ノート)/ }
  ];

  for (const field of fieldRegs){
    // 设置为某内容（带引号）
    let rgSetCN = new RegExp("(?:把)?(?:(日文|日語|日本語|JP|英文|英語|EN|中文|中国語|ZH))?.*?"+field.cn.source+".*?(改成|改为|换成|设置为|设为)", "i");
    let rgSetJP = new RegExp("(?:(日本語|英語|中国語|JP|EN|ZH))?.*?"+field.jp.source+".*?(?:を)?\\s*[「『“\"\']([^「『“\"']+)[」』”\"\']\\s*に(?:する|変更|変える|して)", "i");

    const q = quoted(text);
    if (rgSetJP.test(text) && q){
      const lang = pickLangKey(text.match(rgSetJP)[1] || "");
      ensureLang(spec,lang)[field.key] = q;
      changes.push(`${lang.toUpperCase()}の${field.key}を「${q}」に`);
      changed = true; continue;
    }
    if (rgSetCN.test(text) && q){
      const lang = pickLangKey(text.match(rgSetCN)[1] || "");
      ensureLang(spec,lang)[field.key] = q;
      changes.push(`${lang.toUpperCase()} ${field.key} を更新`);
      changed = true; continue;
    }

    // “把…改成 …” （无引号时，尽量抓取“改成/改为/にする”后的尾部）
    const tailCN = new RegExp(field.cn.source + ".*?(?:改成|改为|换成|设置为|设为)\\s*([^。！!\\n]+)", "i");
    const m1 = text.match(tailCN);
    if (m1){
      const lang = pickLangKey(text);
      const val = m1[1].trim();
      ensureLang(spec,lang)[field.key] = val;
      changes.push(`${lang.toUpperCase()} ${field.key} を更新`);
      changed = true;
    }

    const tailJP = new RegExp(field.jp.source + ".*?(?:を)?\\s*([^\\s「『]+)\\s*に(?:する|変更|変える|して)", "i");
    const m2 = text.match(tailJP);
    if (m2 && !q){
      const lang = pickLangKey(text);
      const val = m2[1].trim();
      ensureLang(spec,lang)[field.key] = val;
      changes.push(`${lang.toUpperCase()} ${field.key} を更新`);
      changed = true;
    }
  }

  // 追加一行（落到 note）
  if (/(追加|加上一句|加一行|追記)/i.test(text)){
    const lang = pickLangKey(text);
    const qv = quoted(text);
    if (qv){
      const L = ensureLang(spec, lang);
      L.note = L.note ? (L.note + " / " + qv) : qv;
      changes.push(`${lang.toUpperCase()} に一文を追記`);
      changed = true;
    }
  }

  return changed;
}

function applyStyleEdits(text, spec, changes){
  let changed = false;

  // 边框
  if (/(无边框|不要边框|枠なし|縁なし)/i.test(text)){ spec.border = "none"; changes.push("枠：なし"); changed = true; }
  if (/(边框|框|枠).*(斜纹|斜線|ストライプ)/i.test(text)){ spec.border = "stripes"; changes.push("枠：斜線"); changed = true; }
  if (/(边框|框|枠).*(实线|實線|実線|ソリッド)/i.test(text)){ spec.border = "solid"; changes.push("枠：実線"); changed = true; }

  // 类别
  if (/(警告|注意|warning)/i.test(text)){ spec.category = "warning"; changes.push("カテゴリ：警告"); changed = true; }
  if (/(禁止|不可|prohibition)/i.test(text)){ spec.category = "prohibition"; changes.push("カテゴリ：禁止"); changed = true; }
  if (/(指示|必须|必須|mandatory)/i.test(text)){ spec.category = "mandatory"; changes.push("カテゴリ：指示"); changed = true; }
  if (/(安全|避難|safe)/i.test(text)){ spec.category = "safe"; changes.push("カテゴリ：安全"); changed = true; }
  if (/(防火|fire)/i.test(text)){ spec.category = "fire"; changes.push("カテゴリ：防火"); changed = true; }

  // 斜纹粗细/间隔（影响 SETTINGS）
  if (/(斜纹|斜線|ストライプ).*(粗|太|厚|太く)/i.test(text)){ SETTINGS.ui.stripeWidth = Math.min(50, SETTINGS.ui.stripeWidth + 4); changes.push(`斜線の太さ：${SETTINGS.ui.stripeWidth}`); }
  if (/(斜纹|斜線|ストライプ).*(细|薄|細|薄く)/i.test(text)){ SETTINGS.ui.stripeWidth = Math.max(10, SETTINGS.ui.stripeWidth - 4); changes.push(`斜線の太さ：${SETTINGS.ui.stripeWidth}`); }
  const gapN = text.match(/(间隔|間隔)\s*([0-9]{1,3})\s*(px|ピクセル)?/i);
  if (gapN){ SETTINGS.ui.stripeGap = Math.max(10, Math.min(60, parseInt(gapN[2],10))); changes.push(`斜線の間隔：${SETTINGS.ui.stripeGap}`); }

  // 字号/倍率
  if (/(字号|文字|フォント).*(大|大きく|増や|放大)/i.test(text)){ SETTINGS.ui.fontScale = Math.min(1.5, SETTINGS.ui.fontScale + 0.1); changes.push(`フォント倍率：${SETTINGS.ui.fontScale.toFixed(2)}`); }
  if (/(字号|文字|フォント).*(小|小さく|減ら|缩小)/i.test(text)){ SETTINGS.ui.fontScale = Math.max(0.6, SETTINGS.ui.fontScale - 0.1); changes.push(`フォント倍率：${SETTINGS.ui.fontScale.toFixed(2)}`); }
  const mag = text.match(/(倍率|スケール|scale)\s*([0-9.]{1,4})/i);
  if (mag){ SETTINGS.ui.fontScale = Math.max(0.6, Math.min(1.5, parseFloat(mag[2]))); changes.push(`フォント倍率：${SETTINGS.ui.fontScale.toFixed(2)}`); }

  // 面板留白
  if (/(留白|余白|パディング|内側余白).*(多|大|増や|広く)/i.test(text)){ SETTINGS.panel.paddingX += 6; SETTINGS.panel.paddingY += 6; changes.push("面板余白：増"); }
  if (/(留白|余白|パディング|内側余白).*(少|小|減ら|狭く)/i.test(text)){ SETTINGS.panel.paddingX = Math.max(12, SETTINGS.panel.paddingX - 6); SETTINGS.panel.paddingY = Math.max(8, SETTINGS.panel.paddingY - 6); changes.push("面板余白：減"); }

  // 大小/纸型
  const p = paperFromText(text);
  if (p){ SETTINGS.canvas.width = p.w; SETTINGS.canvas.height = p.h; changes.push(`サイズ：${p.name}${p.orient}`); }

  // 顶部色带自然语言
  const bandInfo = applyBandNaturalLanguage(text);
  if (bandInfo){
    if (bandInfo.off === true) changes.push("上部の色帯：なし");
    if (bandInfo.off === false) changes.push(`上部の色帯：表示, 高さ${SETTINGS.band.height}px`);
    if (bandInfo.height) changes.push(`上部の色帯 高さ：${bandInfo.height}px`);
    if (bandInfo.color)  changes.push(`上部の色帯 色：${bandInfo.color}`);
    if (bandInfo.follow) changes.push("上部の色帯：カテゴリ連動");
  }

  return changed || !!p || !!bandInfo;
}

// 识别“这是编辑而不是新建”
function looksLikeEdit(text){
  return /(改|换|換|删除|去掉|不要|追加|追記|调整|調整|设置|设为|變更|変更|にする|に変更|サイズ|A[0-5]|px|枠|ストライプ|実線|斜线|斜紋|色帯|ヘッダー帯|字体|フォント|余白)/i.test(text);
}

function applyEditsNaturalLanguage(userText){
  if (!lastSpec) return null;
  const spec = deepClone(lastSpec);
  const changes = [];

  const textChanged = applyTextEdits(userText, spec, changes);
  const styleChanged = applyStyleEdits(userText, spec, changes);

  if (textChanged || styleChanged){
    return { spec, summary: changes };
  }
  return null;
}

/* =========================
 * 日本語の自然な返信
 * ========================= */
function formatBotReply(spec, sizeInfo, bandInfo){
  const catMap = { warning:"黄色の警告", prohibition:"赤の禁止", mandatory:"青の指示", safe:"緑の安全", fire:"防火", neutral:"中立" };
  const jp=spec.jp||{}, en=spec.en||{}, zh=spec.zh||{};
  const bits=[];
  if(jp.title) bits.push(`見出し：「${jp.title}」${jp.subtitle?`（${jp.subtitle}）`:""}`);
  if(en.title || en.subtitle) bits.push(`英文：${[en.title,en.subtitle].filter(Boolean).join(" / ")}`);
  if(zh.title || zh.subtitle || zh.note) bits.push(`中国語：${[zh.title,zh.subtitle,zh.note].filter(Boolean).join(" / ")}`);
  const sizeTxt = sizeInfo ? `${sizeInfo.name}・${sizeInfo.orient}（${sizeInfo.w}×${sizeInfo.h}px）` : `${SETTINGS.canvas.width}×${SETTINGS.canvas.height}px`;
  let bandTxt = "";
  if (SETTINGS.band.height === 0) bandTxt = "上部の色帯：なし";
  else if (SETTINGS.band.followCategory) bandTxt = `上部の色帯：カテゴリ連動，高さ ${SETTINGS.band.height}px`;
  else bandTxt = `上部の色帯：固定色 ${SETTINGS.band.colorOverride}，高さ ${SETTINGS.band.height}px`;
  return `了解しました。内容に合わせてレイアウトを最適化しました。\n- ${bits.join("\n- ")}\n- スタイル：${catMap[spec.category]||spec.category}、枠は「${spec.border==="stripes"?"斜線":"実線"}」\n- 用紙サイズ：${sizeTxt}\n- ${bandTxt}\n右上のギアでフォント倍率・行間・斜線の太さ/間隔を調整できます。`;
}
function formatEditReply(changes){
  if (!changes || !changes.length) return "ご指定の修正内容を確認しました（変更はありませんでした）。別の指示もどうぞ。";
  return "承知しました。次の点を反映してポスターを更新しました：\n- " + changes.join("\n- ");
}

/* =========================
 * 生成フロー（先尝试“编辑”，否则“新建”）
 * ========================= */
function parseJSONLoose(t){ if(!t) return null; const m=t.match(/```(?:json)?\s*([\s\S]*?)```/i); const body=m?m[1]:t; try{return JSON.parse(body);}catch{return null;} }

async function generatePoster(userText){
  // —— 先尝试对当前海报做“编辑” —— //
  if (lastSpec && looksLikeEdit(userText)) {
    const edited = applyEditsNaturalLanguage(userText);
    if (edited){
      addMsg("bot", formatEditReply(edited.summary));
      drawPoster(edited.spec);
      return;
    }
  }

  // —— 否则走“新建生成”流程 —— //
  let data;
  if (engine) {
    const reply = await engine.chat.completions.create({
      messages: [{ role:"system", content: SYSTEM_PROMPT }, { role:"user", content: userText }],
      max_tokens: 500
    });
    data = parseJSONLoose(reply.choices?.[0]?.message?.content || "");
  }

  const sizeInfo = applyCanvasSizeBySpec(data?.size, userText);
  const bandInfo = applyBandNaturalLanguage(userText);
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

  addMsg("bot", formatBotReply(spec, sizeInfo, bandInfo));
  drawPoster(spec);
}

/* =========================
 * 控制面板（保持）
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
  if (t) { addMsg("user", t); generatePoster(t); }
  promptEl.value = ""; // 发送后清空输入栏
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
