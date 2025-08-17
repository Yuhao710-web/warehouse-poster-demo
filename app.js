let engine;
(async () => {
  try {
    engine = await webllm.CreateWebWorkerEngine(
      new Worker("https://unpkg.com/@mlc-ai/web-llm/dist/worker.js", { type: "module" }),
      { model: "Llama-3.2-1B-Instruct-q4f32_1-MLC" }
    );
  } catch (e) { console.warn("WebLLM init failed:", e); }
})();

const messagesEl = document.getElementById("messages"),
      promptEl   = document.getElementById("prompt"),
      sendBtn    = document.getElementById("send"),
      canvas     = document.getElementById("poster"),
      ctx        = canvas.getContext("2d"),
      dlBtn      = document.getElementById("download");

/** --- 可配置参数（你可以按需调整） --- **/
const SETTINGS = {
  canvas: { width: 1404, height: 993 },      // A3横向≈150dpi
  bandHeight: 160,                            // 顶部色带高度
  marginX: 60,                                // 文本左右留白
  stripe: {
    width: 22,                                // 斜纹宽度
    gap: 28,                                  // 斜纹间距
    frame: 16                                 // 外框线宽（条纹边框时）
  },
  solidBorderWidth: 14,                       // 实线边框线宽
  fonts: {
    jpTitle:       "800 72px 'Noto Sans JP'",
    jpSubtitle:    "600 38px 'Noto Sans JP'",
    jpNote:        "400 30px 'Noto Sans JP'",
    enTitle:       "700 34px 'Noto Sans JP'",
    enSubtitle:    "italic 30px 'Noto Sans JP'",
    enNote:        "400 28px 'Noto Sans JP'",
    zhTitle:       "700 30px 'Noto Sans JP'",
    zhBody:        "400 28px 'Noto Sans JP'"
  },
  lineHeights: {
    jpTitle: 64, jpSubtitle: 50, jpNote: 44,
    enTitle: 42, enSubtitle: 40, enNote: 38,
    zhTitle: 38, zhBody: 36
  },
  paragraphSpacing: 12                        // 不同语言块之间的额外间距
};

/** 消息气泡 **/
function addMsg(role, text){
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "user" : "bot");
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/** 安全类别 → 主色（保持原有语义） **/
const SAFETY = {
  warning:     { base: "#F9A900" }, // 注意・警告（黄）
  prohibition: { base: "#C62828" }, // 禁止・停止（赤）
  mandatory:   { base: "#005387" }, // 指示・義務（青）
  safe:        { base: "#237F52" }, // 安全・避難（緑）
  fire:        { base: "#C62828" }, // 防火（赤）
  neutral:     { base: "#2B2B2C" }  // 中立（黑/灰）
};

/** 系统提示（自由输入模式 + 多语言字段 + 类别/边框） **/
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

/** 文本换行绘制（居中） **/
function wrapAndDrawText(text, font, color, centerX, startY, maxWidth, lineHeight){
  if (!text) return startY;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const words = text.split(/\\s+/);
  const lines = [];
  let line = "";

  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i];
    const w = ctx.measureText(test).width;
    if (w > maxWidth && line) {
      lines.push(line);
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  // 逐行居中绘制
  let y = startY;
  for (const ln of lines) {
    ctx.fillText(ln, centerX, y);
    y += lineHeight;
  }
  return y;
}

/** 画斜线警示边框（可配置） **/
function drawStripeBorder(ctx, w, h, color){
  const { width: stripeW, gap, frame } = SETTINGS.stripe;

  ctx.save();
  // 外框
  ctx.lineWidth = frame;
  ctx.strokeStyle = color;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  // 内侧斜纹区域
  ctx.beginPath();
  ctx.rect(28, 28, w - 56, h - 56);
  ctx.clip();

  // 斜纹
  ctx.strokeStyle = color;
  ctx.lineWidth = stripeW;
  const diag = Math.sqrt(w*w + h*h);
  ctx.translate(0, 0);
  ctx.rotate(-Math.PI / 6);
  for (let x = -diag; x < diag * 2; x += stripeW + gap) {
    ctx.beginPath();
    ctx.moveTo(x, -diag);
    ctx.lineTo(x, diag * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** 主绘制：居中 + 自动换行 + 可配置条纹/边框 **/
function drawPoster(spec){
  const { width: W, height: H } = SETTINGS.canvas;
  canvas.width = W; canvas.height = H;

  // 背景
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,W,H);

  // 顶部色带
  const band = SAFETY[spec.category]?.base || "#999";
  ctx.fillStyle = band;
  ctx.fillRect(0,0,W,SETTINGS.bandHeight);

  // 边框
  if (spec.border === "stripes") {
    drawStripeBorder(ctx, W, H, band);
  } else if (spec.border === "solid") {
    ctx.strokeStyle = band; ctx.lineWidth = SETTINGS.solidBorderWidth;
    ctx.strokeRect(10,10,W-20,H-20);
  }

  // 文案绘制（居中）
  const maxWidth = W - SETTINGS.marginX * 2;
  const centerX  = W / 2;
  let y = SETTINGS.bandHeight + 60; // 从色带下方开始

  // JP
  const jp = spec.jp || {};
  if (jp.title)   y = wrapAndDrawText(jp.title,    SETTINGS.fonts.jpTitle,    "#111", centerX, y, maxWidth, SETTINGS.lineHeights.jpTitle);
  if (jp.subtitle) y = wrapAndDrawText(jp.subtitle, SETTINGS.fonts.jpSubtitle, "#333", centerX, y, maxWidth, SETTINGS.lineHeights.jpSubtitle);
  if (jp.note)     y = wrapAndDrawText(jp.note,     SETTINGS.fonts.jpNote,     "#444", centerX, y, maxWidth, SETTINGS.lineHeights.jpNote);

  // block spacing
  y += SETTINGS.paragraphSpacing;

  // EN
  const en = spec.en || {};
  if (en.title)    y = wrapAndDrawText(en.title,    SETTINGS.fonts.enTitle,    "#1a1a1a", centerX, y, maxWidth, SETTINGS.lineHeights.enTitle);
  if (en.subtitle) y = wrapAndDrawText(en.subtitle, SETTINGS.fonts.enSubtitle, "#1a1a1a", centerX, y, maxWidth, SETTINGS.lineHeights.enSubtitle);
  if (en.note)     y = wrapAndDrawText(en.note,     SETTINGS.fonts.enNote,     "#222",    centerX, y, maxWidth, SETTINGS.lineHeights.enNote);

  // block spacing
  y += SETTINGS.paragraphSpacing;

  // ZH
  const zh = spec.zh || {};
  if (zh.title)    y = wrapAndDrawText(zh.title,    SETTINGS.fonts.zhTitle, "#222", centerX, y, maxWidth, SETTINGS.lineHeights.zhTitle);
  if (zh.subtitle) y = wrapAndDrawText(zh.subtitle, SETTINGS.fonts.zhBody,  "#222", centerX, y, maxWidth, SETTINGS.lineHeights.zhBody);
  if (zh.note)     y = wrapAndDrawText(zh.note,     SETTINGS.fonts.zhBody,  "#222", centerX, y, maxWidth, SETTINGS.lineHeights.zhBody);
}

/** 解析 JSON（兼容 ``` 或纯文本返回） **/
function parseJSONLoose(text){
  if (!text) return null;
  const m = text.match(/```(?:json)?\\s*([\\s\\S]*?)```/i);
  const body = m ? m[1] : text;
  try { return JSON.parse(body); } catch { return null; }
}

/** 生成流程（自由输入） **/
async function generatePoster(userText){
  addMsg("user", userText);
  let data;

  if (engine) {
    const reply = await engine.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userText }
      ],
      max_tokens: 400
    });
    const raw = reply.choices?.[0]?.message?.content || "";
    data = parseJSONLoose(raw);
  }

  // 合理回退
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

/** 事件绑定与下载 **/
sendBtn.onclick = () => { const t = promptEl.value.trim(); if (t) generatePoster(t); };
promptEl.addEventListener("keydown", e => { if (e.key === "Enter") sendBtn.click(); });
dlBtn.onclick = () => { const url = canvas.toDataURL("image/png"); const a = document.createElement("a"); a.href = url; a.download = "poster.png"; a.click(); };

/** 初始海报（居中+换行） **/
drawPoster({
  jp: { title: "安全第一", subtitle: "指差呼称・周囲確認・事故ゼロへ" },
  en: { subtitle: "Safety First" },
  zh: { note: "安全第一，谨慎作业" },
  category: "warning",
  border: "solid",
  size: "A3横"
});
