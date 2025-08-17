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
 * 設定（フォント拡大 & 自動調整）
 * ========================= */
const SETTINGS = {
  canvas: { width: 1404, height: 993 },   // A3横 ≈150dpi
  bandHeight: 160,
  marginX: 60,
  stripe: {
    width: 22, gap: 28, frame: 16,
    ringPadding: 40   // 文字ブロックの周囲に確保する余白（斜線の内側パディング）
  },
  solidBorderWidth: 14,
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
 * カテゴリ配色
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
 * LLM システムプロンプト（JSON 返却）
 * ========================= */
const SYSTEM_PROMPT = `
あなたは倉庫安全ポスターのコピーライター兼DTP担当です。
ユーザーの要望を現場向けの掲示ポスターに整え、次のJSONのみで返答してください（説明文や余計な文字は不要）。

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
- jp.title は1行で簡潔（例: 通行注意 / 仮置き禁止 / 非常口 / 体温測定 / 衝突注意）
- category は内容に応じて適切に（注意=warning, 禁止=prohibition, 指示=mandatory, 安全= safe）
- border は 注意/禁止→stripes を推奨、区域/情報→solid、不要なら none
- EN/ZH も可能な範囲で補完（なければ空文字で可）
`;

/* =========================
 * キーワード・プリセット & 補正
 * ========================= */
const PRESETS = [
  // 体温/健康 → mandatory
  {
    match: /(体温|検温|測温|测温|temperature\s*check|health\s*check|注意身体|体調|体调|发烧|fever)/i,
    spec: {
      jp: { title: "体温測定", note: "体調に変化があれば すぐに報告してください" },
      en: { subtitle: "Have you taken your temperature?", note: "Please report any changes immediately" },
      zh: { note: "是否已测量体温？有异常请立即报告" },
      category: "mandatory", border: "stripes", size: "A3横", icon: "thermometer"
    }
  },
  // 非常口 → safe
  {
    match: /(非常口|emergency\s*exit|避難口)/i,
    spec: {
      jp: { title: "非常口", subtitle: "前に物を置かない" },
      en: { title: "Emergency exit", subtitle: "Do not place items here" },
      zh: { note: "紧急出口前禁止放置物品" },
      category: "safe", border: "solid", size: "A3横", icon: "exit"
    }
  },
  // 衝突 → warning
  {
    match: /(衝突事故|衝突|冲突|collision|接触事故|ぶつかり)/i,
    spec: {
      jp: { title: "衝突注意" },
      en: { subtitle: "Watch for collisions" },
      zh: { note: "注意冲突" },
      category: "warning", border: "stripes", size: "A3横", icon: "collision"
    }
  },
  // 仮置き → prohibition
  {
    match: /(仮置き|临时放置|temporary\s*placement)/i,
    spec: {
      jp: { title: "仮置き禁止", subtitle: "通路・ラインを確保" },
      en: { subtitle: "No temporary placement" },
      zh: { note: "禁止临时堆放" },
      category: "prohibition", border: "stripes", size: "A3横", icon: "no-box"
    }
  },
  // 安全第一 → warning（黄色）
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

function matchPreset(userText){
  for (const p of PRESETS) { if (p.match.test(userText)) return structuredClone(p.spec); }
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
 * テキスト計測/改行/自動フィット
 * ========================= */
function withFontSize(fontSpec, px){ return fontSpec.replace(/(?<=\s)(\d+(?:\.\d+)?)px(?=\s*['"]?)/, `${px}px`); }
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

/* =========================
 * 斜線ボーダー（文字ブロックを避けて“環状”に描く）
 * ========================= */
function drawStripeRingAroundContent(ctx, w, h, color, innerRect){
  const stripeW = SETTINGS.ui.stripeWidth, gap = SETTINGS.ui.stripeGap, frame = SETTINGS.stripe.frame;
  ctx.save();
  // 1) 外⇄内の“リング”をクリップ（evenodd）
  const path = new Path2D();
  path.rect(10, 10, w - 20, h - 20); // outer
  path.rect(innerRect.x, innerRect.y, innerRect.w, innerRect.h); // inner
  ctx.clip(path, "evenodd");
  // 2) 斜線を描画
  ctx.strokeStyle = color; ctx.lineWidth = stripeW;
  const diag = Math.sqrt(w*w + h*h);
  ctx.rotate(-Math.PI/6);
  for(let x=-diag; x<diag*2; x+=stripeW+gap){
    ctx.beginPath(); ctx.moveTo(x, -diag); ctx.lineTo(x, diag*2); ctx.stroke();
  }
  ctx.restore();
  // 3) 外枠
  ctx.save();
  ctx.lineWidth = frame; ctx.strokeStyle = color;
  ctx.strokeRect(10,10,w-20,h-20);
  ctx.restore();
}

/* =========================
 * レイアウト計算（ブロック & バウンディング）
 * ========================= */
function layoutBlocks(spec){
  const W = SETTINGS.canvas.width, H = SETTINGS.canvas.height;
  const maxWidth = W - SETTINGS.marginX * 2;
  const scale = Math.max(SETTINGS.ui.fontScale, 0.1);
  const paraGap = Math.round(SETTINGS.ui.paragraphSpacing);
  const blocks=[];

  function addBlock(lines, font, color, lh){
    if(lines && lines.length) blocks.push({lines, font, color, lineHeight: Math.round(lh*scale)});
  }
  function scaleFont(fontSpec){
    const m = fontSpec.match(/(\d+(?:\.\d+)?)px/);
    const px = m ? parseFloat(m[1]) : 32;
    return withFontSize(fontSpec, Math.round(px*scale));
  }

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
  if (en.note)     addBlock(wrapLines(en.note,     scaleFont(SETTINGS.fonts.enNote),     maxWidth), scaleFont(SETTINGS.fonts.enNote),     "#222",    SETTINGS.lineHeights.enNote);

  if (zh.title){
    const fit = fitSingleLine(zh.title, SETTINGS.fonts.zhTitle, maxWidth, SETTINGS.autoFit.zhTitle, scale);
    const lines = fit.wrapped ? wrapLines(zh.title, fit.font, maxWidth) : [zh.title];
    addBlock(lines, fit.font, "#222", SETTINGS.lineHeights.zhTitle);
  }
  if (zh.subtitle) addBlock(wrapLines(zh.subtitle, scaleFont(SETTINGS.fonts.zhBody), maxWidth), scaleFont(SETTINGS.fonts.zhBody), "#222", SETTINGS.lineHeights.zhBody);
  if (zh.note)     addBlock(wrapLines(zh.note,     scaleFont(SETTINGS.fonts.zhBody), maxWidth), scaleFont(SETTINGS.fonts.zhBody), "#222", SETTINGS.lineHeights.zhBody);

  // 総高・最大幅（実測）を算出
  let totalH = 0, maxLineW = 0;
  for(const b of blocks){
    ctx.font = b.font;
    for(const ln of b.lines){ maxLineW = Math.max(maxLineW, ctx.measureText(ln).width); }
    totalH += b.lines.length*b.lineHeight + SETTINGS.ui.paragraphSpacing;
  }
  totalH -= SETTINGS.ui.paragraphSpacing; // 最後の段落は間隔なし

  return { blocks, totalH, maxLineW, maxWidth, scale, paraGap };
}

/* =========================
 * 描画（斜線は文字ブロックの外側のみ）
 * ========================= */
let lastSpec = null;

function drawPoster(spec){
  lastSpec = spec;
  const W = SETTINGS.canvas.width, H = SETTINGS.canvas.height;
  canvas.width = W; canvas.height = H;

  // 背景
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,W,H);

  // 先にレイアウトを計算（斜線の内側矩形に使う）
  const L = layoutBlocks(spec);
  const centerX = W/2;
  const topY = (H + SETTINGS.bandHeight)/2 - L.totalH/2;
  const innerW = Math.min(L.maxLineW + SETTINGS.stripe.ringPadding*2, W - 120);
  const innerX = centerX - innerW/2;
  const innerY = Math.max(topY - SETTINGS.stripe.ringPadding, SETTINGS.bandHeight + 12);
  const innerH = Math.min(L.totalH + SETTINGS.stripe.ringPadding*2, H - innerY - 24);

  // 斜線リング（文字ブロックを避ける）
  const bandColor = SAFETY[spec.category]?.base || "#999";
  if (spec.border === "stripes") {
    drawStripeRingAroundContent(ctx, W, H, bandColor, { x: innerX, y: innerY, w: innerW, h: innerH });
  } else if (spec.border === "solid") {
    ctx.strokeStyle = bandColor; ctx.lineWidth = SETTINGS.solidBorderWidth;
    ctx.strokeRect(10,10,W-20,H-20);
  }

  // 上部色帯は最後に重ねて描く（トップの斜線を隠す）
  ctx.fillStyle = bandColor;
  ctx.fillRect(0,0,W,SETTINGS.bandHeight);

  // 文字描画（中央寄せ）
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let y = topY;
  for(const b of L.blocks){
    ctx.font = b.font; ctx.fillStyle = b.color;
    for(const ln of b.lines){ ctx.fillText(ln, centerX, y); y += b.lineHeight; }
    y += L.paraGap;
  }
}

/* =========================
 * 日本語での自然な返信
 * ========================= */
function formatBotReply(spec){
  const catMap = { warning:"黄色の警告", prohibition:"赤の禁止", mandatory:"青の指示", safe:"緑の安全", fire:"防火", neutral:"中立" };
  const jp=spec.jp||{}, en=spec.en||{}, zh=spec.zh||{};
  const pieces=[];
  if(jp.title) pieces.push(`見出し：「${jp.title}」${jp.subtitle?`（${jp.subtitle}）`: ""}`);
  if(en.title || en.subtitle) pieces.push(`英語：${[en.title,en.subtitle].filter(Boolean).join(" / ")}`);
  if(zh.title || zh.subtitle || zh.note) pieces.push(`中国語：${[zh.title,zh.subtitle,zh.note].filter(Boolean).join(" / ")}`);
  const style = `スタイルは ${catMap[spec.category]||spec.category}、枠は「${spec.border==="stripes"?"斜線":"実線"/* none の場合は実線の代わりに */}」です。`;
  return `ポスターを作成しました。\n- ${pieces.join("\n- ")}\n- ${style}\n右上のギアからフォント・行間・斜線の太さ/間隔を微調整できます。`;
}

/* =========================
 * JSON 解析 & 生成（プリセット/補正込み）
 * ========================= */
function parseJSONLoose(text){ if(!text) return null; const m=text.match(/```(?:json)?\s*([\s\S]*?)```/i); const body=m?m[1]:text; try{return JSON.parse(body);}catch{return null;} }

async function generatePoster(userText){
  addMsg("user", userText);
  let data;

  if (engine) {
    const reply = await engine.chat.completions.create({
      messages: [{ role:"system", content: SYSTEM_PROMPT }, { role:"user", content: userText }],
      max_tokens: 500
    });
    const raw = reply.choices?.[0]?.message?.content || "";
    data = parseJSONLoose(raw);
  }

  // プリセット適用
  const preset = matchPreset(userText);
  if (preset) data = mergeWithPreset(data, preset);

  // 追加の補正（安全網）
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
    data.jp = data.jp || {}; data.jp.title = data.jp.title || "仮置き禁止";
  }

  // フォールバック
  if (!data) {
    data = { jp:{title:"通行注意", subtitle:"走行車両あり"}, en:{subtitle:"Watch for vehicles"}, zh:{note:"行人应小心行驶车辆"}, category:"warning", border:"stripes", size:"A3横", icon:"forklift" };
  }

  const spec = {
    jp: data.jp || {}, en: data.en || {}, zh: data.zh || {},
    category: (["warning","prohibition","mandatory","safe","fire","neutral"].includes(data.category) ? data.category : "warning"),
    border: (["stripes","solid","none"].includes(data.border) ? data.border : "solid"),
    size: data.size || "A3横", icon: data.icon || ""
  };

  addMsg("bot", formatBotReply(spec));
  drawPoster(spec);
}

/* =========================
 * 折りたたみ式コントロールパネル（大きいギア）
 * ========================= */
function createControlPanel(){
  const btn = document.createElement("button");
  btn.textContent = "⚙︎";
  btn.title = "設定";
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
    width: 260px; padding: 12px; border-radius: 12px;
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

  const vFont = panel.querySelector("#v-font"), vPara = panel.querySelector("#v-para"),
        vSW = panel.querySelector("#v-sw"), vSG = panel.querySelector("#v-sg");
  panel.querySelector("#ui-font").oninput    = e => { SETTINGS.ui.fontScale        = parseFloat(e.target.value); vFont.textContent = SETTINGS.ui.fontScale.toFixed(2); redrawLast(); };
  panel.querySelector("#ui-para").oninput    = e => { SETTINGS.ui.paragraphSpacing = parseInt(e.target.value,10); vPara.textContent = SETTINGS.ui.paragraphSpacing; redrawLast(); };
  panel.querySelector("#ui-stripeW").oninput = e => { SETTINGS.ui.stripeWidth      = parseInt(e.target.value,10); vSW.textContent   = SETTINGS.ui.stripeWidth;      redrawLast(); };
  panel.querySelector("#ui-stripeG").oninput = e => { SETTINGS.ui.stripeGap        = parseInt(e.target.value,10); vSG.textContent   = SETTINGS.ui.stripeGap;        redrawLast(); };
}
function redrawLast(){ if(lastSpec) drawPoster(lastSpec); }
createControlPanel();

/* =========================
 * 送信動作（Enter 判定：IME中は送信しない）
 * ========================= */
let composing = false;
promptEl.addEventListener("compositionstart", () => composing = true);
promptEl.addEventListener("compositionend",   () => composing = false);
promptEl.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    if (e.isComposing || composing) return;          // 変換中の Enter は送信しない
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); sendBtn.click(); } // Ctrl/⌘+Enter で送信
    else { e.preventDefault(); sendBtn.click(); }    // 通常 Enter でも送信（必要ならここを変えてもOK）
  }
});

sendBtn.onclick = () => {
  const t = promptEl.value.trim();
  if (t) generatePoster(t);
};
dlBtn.onclick = () => {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url; a.download = "poster.png"; a.click();
};

/* =========================
 * 初期サンプル
 * ========================= */
function formatBotReply(spec){ /* 上で定義済み。下のダミー呼び出し用 */ return `ポスターを作成しました。`; }

drawPoster({
  jp: { title: "安全第一", subtitle: "指差呼称・周囲確認・事故ゼロへ" },
  en: { subtitle: "Safety First" },
  zh: { note: "安全第一，谨慎作业" },
  category: "warning",
  border: "solid",
  size: "A3横"
});
