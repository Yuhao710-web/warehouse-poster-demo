/* =========================================================
 * Poster Generator — 安定版 app.js（最稳妥修复）
 * 重点：背景色/斜線色 指令稳妥生效（見える化＆自動切替）
 * 返信は日本語。設定はポスター完了/新規時に既定へリセット。
 * ========================================================= */

/* WebLLM（任意）: 可用则生成更聪明的文案；不可用也不影响基本功能 */
let engine;
(async () => {
  try {
    engine = await webllm.CreateWebWorkerEngine(
      new Worker("https://unpkg.com/@mlc-ai/web-llm/dist/worker.js", { type: "module" }),
      { model: "Llama-3.2-1B-Instruct-q4f32_1-MLC" }
    );
  } catch (e) { console.warn("WebLLM init failed:", e); }
})();

/* DOM */
const messagesEl = document.getElementById("messages");
const promptEl   = document.getElementById("prompt");
const sendBtn    = document.getElementById("send");
const canvas     = document.getElementById("poster");
const ctx        = canvas.getContext("2d");
const dlBtn      = document.getElementById("download");

function addMsg(role, text){
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "user" : "bot");
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ---------- 基本设置（含初始为斜線） ---------- */
const SETTINGS = {
  canvas: { width: 1404, height: 993 },   // A3 横
  band: { height: 160, followCategory: true, colorOverride: null },
  marginX: 60,
  stripe: { width: 22, gap: 28, frame: 16, ringGap: 10 },
  panel: { paddingX: 42, paddingY: 30, radius: 18, marginX: 40, marginY: 24, shadow: true },
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
  ui: { fontScale: 1.0, paragraphSpacing: 14, stripeWidth: 22, stripeGap: 28 },
  colors: { canvasBg: "#ffffff", panelBg: "#ffffff", ringBg: "#ffffff" }, // ringBg = 斜線の隙間（白地）
  borderColorOverride: null
};
const SAFETY = {
  warning:     { base: "#F9A900" },
  prohibition: { base: "#C62828" },
  mandatory:   { base: "#005387" },
  safe:        { base: "#237F52" },
  fire:        { base: "#C62828" },
  neutral:     { base: "#2B2B2C" }
};
const DEFAULT_THEME  = structuredClone ? structuredClone(SAFETY) : JSON.parse(JSON.stringify(SAFETY));
let   CURRENT_THEME  = structuredClone ? structuredClone(SAFETY) : JSON.parse(JSON.stringify(SAFETY));
const DEFAULT_COLORS = { canvasBg: "#ffffff", panelBg: "#ffffff", ringBg: "#ffffff" };

/* ---------- 工具 ---------- */
function sc(o){ return (typeof structuredClone==="function") ? structuredClone(o) : JSON.parse(JSON.stringify(o)); }
function norm(s){
  if (!s) return "";
  return s.replace(/[“”„‟＂]/g, '"')
          .replace(/[‘’＇]/g, "'")
          .replace(/[「『]/g, '"').replace(/[」』]/g, '"')
          .replace(/\s+/g, " ")
          .trim();
}

/* ---------- 颜色解析（超稳妥：支持 に/を/は、にしたい 等尾缀；命名色/#HEX/rgb/hsl） ---------- */
const COLOR_MAP = {
  red:"#C62828", yellow:"#F9A900", blue:"#005387", green:"#237F52", black:"#000000", white:"#ffffff", gray:"#9e9e9e", grey:"#9e9e9e",
  orange:"#FFA500", purple:"#800080", pink:"#FFC0CB", brown:"#8B4513", cyan:"#00BCD4", magenta:"#FF00FF", navy:"#000080", teal:"#008080",
  maroon:"#800000", lime:"#00FF00", gold:"#FFD700", silver:"#C0C0C0", beige:"#F5F5DC", indigo:"#4B0082", violet:"#8A2BE2", skyblue:"#87CEEB",
  // 中文
  "红":"#C62828","红色":"#C62828","黄":"#F9A900","黄色":"#F9A900","蓝":"#005387","蓝色":"#005387","绿":"#237F52","绿色":"#237F52",
  "黑":"#000000","黑色":"#000000","白":"#ffffff","白色":"#ffffff","灰":"#9e9e9e","灰色":"#9e9e9e",
  // 日文
  "赤":"#C62828","レッド":"#C62828","黄":"#F9A900","黄色":"#F9A900","イエロー":"#F9A900","青":"#005387","ブルー":"#005387",
  "緑":"#237F52","グリーン":"#237F52","黒":"#000000","ブラック":"#000000","白":"#ffffff","ホワイト":"#ffffff","グレー":"#9e9e9e"
};
function cleanColorWord(s){
  if (!s) return "";
  return s.trim()
    .replace(/(にして|に変更|にする|にしたい(?:です)?|したい(?:です)?|にしてください|してください|でお願いします|ください|下さい|お願いします?)$/i, "")
    .replace(/[にへでをはがもやとか、。．，,！!？?\s~〜]+$/g, "")
    .trim();
}
function resolveColor(word){
  if (!word) return null;
  word = cleanColorWord(word);

  const hex = word.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) return "#"+hex[1].toLowerCase();

  let m = word.match(/^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*(0|0?\.\d+|1))?\s*\)$/i);
  if (m){
    const toHex = n => Math.max(0, Math.min(255, n|0)).toString(16).padStart(2,"0");
    return `#${toHex(+m[1])}${toHex(+m[2])}${toHex(+m[3])}`;
  }

  m = word.match(/^hsla?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})%\s*,\s*([0-9]{1,3})%(?:\s*,\s*(0|0?\.\d+|1))?\s*\)$/i);
  if (m){
    let h=(+m[1]%360+360)%360, s=Math.max(0,Math.min(100,+m[2]))/100, l=Math.max(0,Math.min(100,+m[3]))/100;
    const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs(((h/60)%2)-1)), m0=l-c/2;
    let r1=0,g1=0,b1=0;
    if (h<60){ r1=c; g1=x; } else if (h<120){ r1=x; g1=c; }
    else if (h<180){ g1=c; b1=x; } else if (h<240){ g1=x; b1=c; }
    else if (h<300){ r1=x; b1=0; } else { r1=c; b1=0; }
    const toHex = n => Math.round((n+m0)*255).toString(16).padStart(2,"0");
    return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
  }

  const norm = word.toLowerCase();
  return COLOR_MAP[norm] || COLOR_MAP[word] || null;
}

/* ---------- 规格/预设 ---------- */
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

const PRESETS = [
  { match: /(非常口|emergency\s*exit|避難口)/i,
    spec: { jp:{title:"非常口",subtitle:"前に物を置かない"}, en:{title:"Emergency exit",subtitle:"Do not place items here"}, zh:{note:"紧急出口前禁止放置物品"}, category:"safe", border:"solid", size:"A3横", icon:"exit" } },
  { match: /(衝突事故|衝突|冲突|collision|接触事故|ぶつかり)/i,
    spec: { jp:{title:"衝突注意"}, en:{subtitle:"Watch for collisions"}, zh:{note:"注意冲突"}, category:"warning", border:"stripes", size:"A3横", icon:"collision" } },
  { match: /(仮置き|临时放置|temporary\s*placement)/i,
    spec: { jp:{title:"仮置き禁止",subtitle:"通路・ラインを確保"}, en:{subtitle:"No temporary placement"}, zh:{note:"禁止临时堆放"}, category:"prohibition", border:"stripes", size:"A3横", icon:"no-box" } },
  { match: /(体温|検温|測温|测温|temperature\s*check|health\s*check|注意身体|体調|体调|发烧|fever)/i,
    spec: { jp:{title:"体温測定",note:"体調に変化があれば すぐに報告してください"}, en:{subtitle:"Have you taken your temperature?",note:"Please report any changes immediately"}, zh:{note:"是否已测量体温？有异常请立即报告"}, category:"mandatory", border:"stripes", size:"A3横", icon:"thermometer" } },
  { match: /(安全(第一)?|safety( first)?)/i,
    spec: { jp:{title:"安全第一",subtitle:"指差呼称・周囲確認"}, en:{title:"Safety First"}, zh:{note:"安全第一，谨慎作业"}, category:"warning", border:"stripes", size:"A3横", icon:"helmet" } }
];
function matchPreset(t){ for (const p of PRESETS) if (p.match.test(t)) return sc(p.spec); return null; }

/* ---------- 纸型/尺寸解析 ---------- */
const SQRT2 = Math.SQRT2;
const PAPER_BASE = { name:"A3", orient:"横", w:1404, h:993 };
function paperFromText(text){
  const m = text && text.match(/A([0-5])\s*(横|縦|landscape|portrait)?/i);
  if (m){
    const n = parseInt(m[1],10);
    const orient = (m[2]||"横").replace(/landscape/i,"横").replace(/portrait/i,"縦");
    const delta = 3 - n, factor = Math.pow(SQRT2, delta);
    const baseW = PAPER_BASE.w * factor, baseH = PAPER_BASE.h * factor;
    const w = Math.round(orient==="横" ? baseW : baseH);
    const h = Math.round(orient==="横" ? baseH : baseW);
    return { name:`A${n}`, orient, w, h };
  }
  const p = text && text.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})\s*(?:px|ピクセル|像素)?/i);
  if (p) return { name:"Custom", orient:"横", w:parseInt(p[1],10), h:parseInt(p[2],10) };
  return null;
}
function applyCanvasSizeBySpec(sizeStr, userText){
  const p = paperFromText(userText) || paperFromText(sizeStr);
  if (p){ SETTINGS.canvas.width = p.w; SETTINGS.canvas.height = p.h; return p; }
  return null;
}

/* ---------- 版面与绘制 ---------- */
function withFontSize(fontSpec, px){ return fontSpec.replace(/(?<=\s)(\d+(?:\.\d+)?)px(?=\s*['"]?)/, `${px}px`); }
function getPx(fontSpec){ const m=fontSpec.match(/(\d+(?:\.\d+)?)px/); return m?+m[1]:32; }
function canFitSingleLine(text, fontSpec, maxWidth){ ctx.font=fontSpec; return ctx.measureText(text).width<=maxWidth; }
function fitSingleLine(text, baseFont, maxWidth, opt={}, scale=1){
  const cfg=Object.assign({minPx:42,maxPx:100,step:2}, opt||{});
  const avail=maxWidth/Math.max(scale,0.1);
  for(let px=cfg.maxPx; px>=cfg.minPx; px-=cfg.step){
    const f=withFontSize(baseFont, px);
    if (canFitSingleLine(text, f, avail)) return { font:withFontSize(baseFont, Math.round(px*scale)), size:Math.round(px*scale), wrapped:false };
  }
  return { font:withFontSize(baseFont, Math.round(cfg.minPx*scale)), size:Math.round(cfg.minPx*scale), wrapped:true };
}
function wrapLines(text, font, maxWidth){
  if (!text) return [];
  ctx.font=font; const words=text.split(/\s+/), lines=[]; let line="";
  for (let i=0;i<words.length;i++){
    const test = line ? line+" "+words[i] : words[i];
    if (ctx.measureText(test).width > maxWidth && line){ lines.push(line); line=words[i]; }
    else line=test;
  }
  if (line) lines.push(line);
  return lines;
}
function measureLine(text, font){
  ctx.font=font;
  const m=ctx.measureText(text), px=getPx(font);
  const ascent =(m.actualBoundingBoxAscent!=null)?m.actualBoundingBoxAscent:px*0.80;
  const descent=(m.actualBoundingBoxDescent!=null)?m.actualBoundingBoxDescent:px*0.20;
  const left   =(m.actualBoundingBoxLeft!=null)?m.actualBoundingBoxLeft:px*0.08;
  const right  =(m.actualBoundingBoxRight!=null)?m.actualBoundingBoxRight:Math.max(m.width,px*0.92);
  const width  =Math.max(m.width,left+right);
  return {ascent,descent,left,right,width};
}
function roundRectPath(x,y,w,h,r=12){
  const p=new Path2D(); const rr=Math.max(0, Math.min(r, Math.min(w,h)/2));
  p.moveTo(x+rr,y);
  p.arcTo(x+w,y,x+w,y+h,rr);
  p.arcTo(x+w,y+h,x,y+h,rr);
  p.arcTo(x,y+h,x,y,rr);
  p.arcTo(x,y,x+w,y,rr);
  p.closePath(); return p;
}
function drawStripeRingAroundRect(ctx, w, h, color, innerRect, radius){
  const stripeW=SETTINGS.ui.stripeWidth, gap=SETTINGS.ui.stripeGap, frame=SETTINGS.stripe.frame;
  const inset=SETTINGS.stripe.ringGap;
  const inner=roundRectPath(innerRect.x - inset, innerRect.y - inset, innerRect.w + inset*2, innerRect.h + inset*2, Math.max(0, radius - 4));

  ctx.save();
  const outer = new Path2D();
  outer.addPath(roundRectPath(10,10,w-20,h-20,16));
  outer.addPath(inner);
  ctx.clip(outer, "evenodd");

  ctx.fillStyle = SETTINGS.colors.ringBg || "#fff"; // 斜線の隙間（白地）
  ctx.fillRect(0,0,w,h);

  ctx.strokeStyle=color; ctx.lineWidth=stripeW;
  const diag=Math.sqrt(w*w + h*h);
  ctx.translate(w/2,h/2); ctx.rotate(-Math.PI/6); ctx.translate(-w/2,-h/2);
  for(let x=-diag; x<diag*2; x+=stripeW+gap){
    ctx.beginPath(); ctx.moveTo(x,-diag); ctx.lineTo(x, diag*2); ctx.stroke();
  }
  ctx.restore();

  ctx.save(); ctx.lineWidth=frame; ctx.strokeStyle=color;
  ctx.stroke(roundRectPath(10,10,w-20,h-20,16)); // 外枠
  ctx.restore();
}

/* 文块布局 */
function layoutBlocks(spec){
  const W=SETTINGS.canvas.width, H=SETTINGS.canvas.height, maxWidth=W-SETTINGS.marginX*2;
  const scale=Math.max(SETTINGS.ui.fontScale,0.1), paraGap=Math.round(SETTINGS.ui.paragraphSpacing);
  const blocks=[]; const jp=spec.jp||{}, en=spec.en||{}, zh=spec.zh||{};
  const add=(lines,font,color,lh)=>{ if(lines && lines.length) blocks.push({lines,font,color,lineHeight:Math.round(lh*scale)}); };
  const sfont=fs=>withFontSize(fs, Math.round(getPx(fs)*scale));

  if (jp.title){
    const fit=fitSingleLine(jp.title, SETTINGS.fonts.jpTitle, maxWidth, {minPx:42,maxPx:100,step:2}, scale);
    add(fit.wrapped?wrapLines(jp.title, fit.font, maxWidth):[jp.title], fit.font, "#111", SETTINGS.lineHeights.jpTitle);
  }
  if (jp.subtitle) add(wrapLines(jp.subtitle, sfont(SETTINGS.fonts.jpSubtitle), maxWidth), sfont(SETTINGS.fonts.jpSubtitle), "#333", SETTINGS.lineHeights.jpSubtitle);
  if (jp.note)     add(wrapLines(jp.note,     sfont(SETTINGS.fonts.jpNote),     maxWidth), sfont(SETTINGS.fonts.jpNote),     "#444", SETTINGS.lineHeights.jpNote);

  if (en.title){
    const fit=fitSingleLine(en.title, SETTINGS.fonts.enTitle, maxWidth, {minPx:34,maxPx:56,step:2}, scale);
    add(fit.wrapped?wrapLines(en.title, fit.font, maxWidth):[en.title], fit.font, "#1a1a1a", SETTINGS.lineHeights.enTitle);
  }
  if (en.subtitle) add(wrapLines(en.subtitle, sfont(SETTINGS.fonts.enSubtitle), maxWidth), sfont(SETTINGS.fonts.enSubtitle), "#1a1a1a", SETTINGS.lineHeights.enSubtitle);
  if (en.note)     add(wrapLines(en.note,     sfont(SETTINGS.fonts.enNote),     maxWidth), sfont(SETTINGS.fonts.enNote),     "#222", SETTINGS.lineHeights.enNote);

  if (zh.title){
    const fit=fitSingleLine(zh.title, SETTINGS.fonts.zhTitle, maxWidth, {minPx:34,maxPx:54,step:2}, scale);
    add(fit.wrapped?wrapLines(zh.title, fit.font, maxWidth):[zh.title], fit.font, "#222", SETTINGS.lineHeights.zhTitle);
  }
  if (zh.subtitle) add(wrapLines(zh.subtitle, sfont(SETTINGS.fonts.zhBody), maxWidth), sfont(SETTINGS.fonts.zhBody), "#222", SETTINGS.lineHeights.zhBody);
  if (zh.note)     add(wrapLines(zh.note,     sfont(SETTINGS.fonts.zhBody),     maxWidth), sfont(SETTINGS.fonts.zhBody),     "#222", SETTINGS.lineHeights.zhBody);

  let totalH=0,maxLeft=0,maxRight=0,firstAscent=0,lastDescent=0;
  blocks.forEach((b,bi)=>{
    ctx.font=b.font;
    b.lines.forEach((ln,li)=>{
      const m=measureLine(ln,b.font);
      maxLeft=Math.max(maxLeft,m.left); maxRight=Math.max(maxRight,m.right);
      if (bi===0 && li===0) firstAscent=m.ascent;
      if (bi===blocks.length-1 && li===b.lines.length-1) lastDescent=m.descent;
    });
    totalH += b.lines.length * b.lineHeight;
    if (bi!==blocks.length-1) totalH += paraGap;
  });
  const textWidth=maxLeft+maxRight;
  return { blocks,totalH,textWidth,maxWidth,scale,paraGap,firstAscent,lastDescent };
}

/* 绘制主函数 */
let lastSpec=null;
function drawPoster(spec){
  lastSpec=spec;
  const W=SETTINGS.canvas.width,H=SETTINGS.canvas.height;
  canvas.width=W; canvas.height=H;

  // 背景（外侧）
  ctx.fillStyle=SETTINGS.colors.canvasBg||"#fff";
  ctx.fillRect(0,0,W,H);

  const L=layoutBlocks(spec);

  // 上部色带
  const bandH=SETTINGS.band.height||0;
  const bandColor=SETTINGS.band.followCategory
    ? (CURRENT_THEME[spec.category]?.base||"#999")
    : (SETTINGS.band.colorOverride||"#999");
  const borderColor=SETTINGS.borderColorOverride || bandColor;
  if (bandH>0){ ctx.fillStyle=bandColor; ctx.fillRect(0,0,W,bandH); }

  // 中心居中
  const firstBaselineY=(H+bandH)/2 - L.totalH/2;
  const contentTop    = firstBaselineY - L.firstAscent;
  const contentBottom = firstBaselineY + L.totalH + L.lastDescent;
  const contentHeight = contentBottom - contentTop;
  const padX=SETTINGS.panel.paddingX, padY=SETTINGS.panel.paddingY;

  let panelW=Math.min(L.textWidth + padX*2, W - SETTINGS.panel.marginX*2);
  let panelH=Math.min(contentHeight + padY*2, H - (bandH + SETTINGS.panel.marginY) - SETTINGS.panel.marginY);
  let panelX=Math.max(SETTINGS.panel.marginX, W/2 - panelW/2);
  let panelY=Math.max(bandH + SETTINGS.panel.marginY, contentTop - padY);
  if (panelY + panelH > H - SETTINGS.panel.marginY) panelY = H - SETTINGS.panel.marginY - panelH;

  const panelPath=roundRectPath(panelX, panelY, panelW, panelH, SETTINGS.panel.radius);

  // 枠（先画斜線リング/实线框）
  if (spec.border==="stripes"){ drawStripeRingAroundRect(ctx, W,H, borderColor, {x:panelX,y:panelY,w:panelW,h:panelH}, SETTINGS.panel.radius); }
  else if (spec.border==="solid"){ ctx.strokeStyle=borderColor; ctx.lineWidth=SETTINGS.solidBorderWidth; ctx.stroke(roundRectPath(10,10,W-20,H-20,16)); }

  // 面板
  ctx.save();
  if (SETTINGS.panel.shadow){ ctx.shadowColor="rgba(0,0,0,.06)"; ctx.shadowBlur=12; }
  ctx.fillStyle=SETTINGS.colors.panelBg||"#fff";
  ctx.fill(panelPath);
  ctx.restore();

  // 文本
  ctx.textAlign="center"; ctx.textBaseline="alphabetic";
  let y=firstBaselineY; const cx=W/2;
  L.blocks.forEach((b,bi)=>{ ctx.font=b.font; ctx.fillStyle=b.color; b.lines.forEach(ln=>{ ctx.fillText(ln, cx, y); y+=b.lineHeight; }); if (bi!==L.blocks.length-1) y += L.paraGap; });
}

/* ---------- 自然语言编辑（最稳妥修复核心） ---------- */
function applyBackgroundColorNaturalLanguage(text, changes){
  // 目标：用户说“背景色を黄色にしたい”时，不管你能否看见，都要“看得见变化”
  // 策略：模糊“背景/背景色” → 默认同时改【面板背景 + 画布外侧】
  const token = "([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)";
  let changed=false;

  // 斜線の隙間（白地）
  let m = text.match(new RegExp("(白い部分|白地|隙間|スキマ|斜線の隙間|縞の隙間|縞のすき間|斜線の白地|ストライプの隙間).*?(?:を|は|に|にして|に変更|にする|で)?\\s*"+token, "i"));
  if (m){ const col=resolveColor(m[2]); if(col){ SETTINGS.colors.ringBg=col; changes&&changes.push(`斜線の隙間：${col}`); changed=true; } }

  // 外側/キャンバス
  m = text.match(new RegExp("(キャンバス|canvas|外側|背景全体|外周).*?(?:を|は|に|にして|に変更|にする|で)?\\s*"+token, "i"));
  if (m){ const col=resolveColor(m[2]); if(col){ SETTINGS.colors.canvasBg=col; changes&&changes.push(`背景全体：${col}`); changed=true; } }

  // 面板/内側
  m = text.match(new RegExp("(パネル|面の背景|内側|中身|panel).*?(?:を|は|に|にして|に変更|にする|で)?\\s*"+token, "i"));
  if (m){ const col=resolveColor(m[2]); if(col){ SETTINGS.colors.panelBg=col; changes&&changes.push(`パネル背景：${col}`); changed=true; } }

  // 模糊“背景/背景色” → 双改（面板+外侧），确保可见
  m = text.match(new RegExp("(背景|背景色|バックグラウンド).*?(?:を|は|に|にして|に変更|にする|で)?\\s*"+token, "i"));
  if (m){
    const col=resolveColor(m[2]);
    if (col){
      SETTINGS.colors.panelBg  = col;
      SETTINGS.colors.canvasBg = col;
      changes&&changes.push(`背景色：${col}（面の背景＋外側）`);
      changed=true;
    }
  }
  return changed;
}

function applyStyleEdits(text, spec, changes){
  let changed=false;

  // 先处理颜色主题与背景（使“背景色…”马上可见）
  const themeChanged  = applyThemeNaturalLanguage(text, changes);
  const bgChanged     = applyBackgroundColorNaturalLanguage(text, changes);
  changed = changed || themeChanged || bgChanged;

  // 边框有无/类型
  if (
    /(枠線|枠|縁|ふち|フチ|ボーダー).*(入れて|入れ|付けて|付け|つけて|つけ|追加|足して|欲しい|ほしい|付与|あり)/i.test(text) ||
    /(加(上)?边框|要边框|加框|需要边框|加邊框)/i.test(text) ||
    /add\s+(a\s+)?(border|frame)/i.test(text)
  ){
    if (!spec.border || spec.border==="none"){ spec.border="solid"; changes.push("枠：追加（実線）"); }
    else { changes.push("枠：保持（既にあり）"); }
    changed=true;
  }
  if (/(斜线|斜線|斜紋|ストライプ)/i.test(text) && !/(不要|去掉|去除|無し|いらない)/i.test(text)){
    if (spec.border!=="stripes"){ spec.border="stripes"; changes.push("枠：斜線に切替"); changed=true; }
  }
  if (/(无边框|不要边框|枠なし|縁なし)/i.test(text)){ spec.border="none"; changes.push("枠：なし"); changed=true; }
  if (/(边框|框|枠).*(斜纹|斜線|ストライプ)/i.test(text)){ spec.border="stripes"; changes.push("枠：斜線"); changed=true; }
  if (/(边框|框|枠).*(实线|實線|実線|ソリッド)/i.test(text)){ spec.border="solid"; changes.push("枠：実線"); changed=true; }

  // —— 斜線/枠の色（“斜線を黄色にしたい”はここで必ず命中）——
  const token="([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)";
  let mc = text.match(new RegExp("(斜线|斜線|斜紋|ストライプ|枠線|枠).*?(?:を|は)?\\s*"+token+"(?:にしたい|に|にして|に変更|にする)?", "i"));
  if (mc){
    const col=resolveColor(mc[2]);
    if (col){
      if (/斜|ストライプ/.test(mc[1]) && spec.border!=="stripes"){ spec.border="stripes"; changes.push("枠：斜線に切替"); }
      SETTINGS.borderColorOverride = col;
      changes.push(`枠（斜線/実線）カラー：${col}`);
      changed=true;
    }
  } else {
    // 有色词的保底匹配（包含「色/カラー」）
    let bcMatch =
      text.match(new RegExp("(斜纹|斜線|ストライプ|枠線|枠).*?(?:颜色|色|カラー|color).*?(?:改成|改为|变成|にして|に変更|にする|で|は|を|に)?\\s*"+token, "i")) ||
      text.match(new RegExp("(斜纹|斜線|ストライプ|枠線|枠).*?(?:を|は|に|にして|に変更|にする|で|改成|改为|变成)\\s*"+token, "i"));
    if (bcMatch){
      const col=resolveColor(bcMatch[2]);
      if (col){
        if (/斜|ストライプ/.test(bcMatch[1]) && spec.border!=="stripes"){ spec.border="stripes"; changes.push("枠：斜線に切替"); }
        SETTINGS.borderColorOverride = col;
        changes.push(`枠（斜線/実線）カラー：${col}`);
        changed=true;
      }
    }
  }

  // カテゴリ直指定（色帯連動色にも影響）
  if (/(警告|注意|warning)/i.test(text)){ spec.category="warning";     changes.push("カテゴリ：警告");     changed=true; }
  if (/(禁止|不可|prohibition)/i.test(text)){ spec.category="prohibition"; changes.push("カテゴリ：禁止");     changed=true; }
  if (/(指示|必须|必須|mandatory)/i.test(text)){ spec.category="mandatory";   changes.push("カテゴリ：指示");     changed=true; }
  if (/(安全|避難|safe)/i.test(text)){ spec.category="safe";        changes.push("カテゴリ：安全");     changed=true; }
  if (/(防火|fire)/i.test(text)){ spec.category="fire";             changes.push("カテゴリ：防火");     changed=true; }

  // 斜線太さ/間隔
  if (/(斜纹|斜線|ストライプ).*(粗|太|厚|太く)/i.test(text)){ SETTINGS.ui.stripeWidth=Math.min(50, SETTINGS.ui.stripeWidth+4); changes.push(`斜線の太さ：${SETTINGS.ui.stripeWidth}`); changed=true; }
  if (/(斜纹|斜線|ストライプ).*(细|薄|細|薄く)/i.test(text)){ SETTINGS.ui.stripeWidth=Math.max(10, SETTINGS.ui.stripeWidth-4); changes.push(`斜線の太さ：${SETTINGS.ui.stripeWidth}`); changed=true; }
  const gapN = text.match(/(间隔|間隔)\s*([0-9]{1,3})\s*(px|ピクセル)?/i);
  if (gapN){ SETTINGS.ui.stripeGap=Math.max(10, Math.min(60, +gapN[2])); changes.push(`斜線の間隔：${SETTINGS.ui.stripeGap}`); changed=true; }

  // フォント倍率/面板余白
  if (/(字号|文字|フォント).*(大|大きく|増や|放大)/i.test(text)){ SETTINGS.ui.fontScale=Math.min(1.5, SETTINGS.ui.fontScale+0.1); changes.push(`フォント倍率：${SETTINGS.ui.fontScale.toFixed(2)}`); changed=true; }
  if (/(字号|文字|フォント).*(小|小さく|減ら|缩小)/i.test(text)){ SETTINGS.ui.fontScale=Math.max(0.6, SETTINGS.ui.fontScale-0.1); changes.push(`フォント倍率：${SETTINGS.ui.fontScale.toFixed(2)}`); changed=true; }

  // 用紙尺寸
  const p = paperFromText(text);
  if (p){ SETTINGS.canvas.width=p.w; SETTINGS.canvas.height=p.h; changes.push(`サイズ：${p.name}${p.orient}`); changed=true; }

  // 色帯
  const bandInfo = applyBandNaturalLanguage(text);
  if (bandInfo){
    if (bandInfo.off===true)  changes.push("上部の色帯：なし");
    if (bandInfo.off===false) changes.push(`上部の色帯：表示, 高さ${SETTINGS.band.height}px`);
    if (bandInfo.height)      changes.push(`上部の色帯 高さ：${SETTINGS.band.height}px`);
    if (bandInfo.color)       changes.push(`上部の色帯 色：${bandInfo.color}`);
    if (bandInfo.follow)      changes.push("上部の色帯：カテゴリ連動");
    changed=true;
  }

  return changed;
}

/* 主题色/色帯/背景颜色（辅助） */
function matchCategoryFromText(text){
  const dict = {
    warning:["警告","注意","warning","黄标","黄色類"],
    prohibition:["禁止","不可","prohibition"],
    mandatory:["指示","必须","必須","mandatory","着用"],
    safe:["安全","避難","safe","非常口"],
    fire:["防火","消防","火気","fire","火災"],
    neutral:["中立","一般","情報","neutral"]
  };
  for (const [key, arr] of Object.entries(dict)){
    const re=new RegExp(arr.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|"),"i");
    if (re.test(text)) return key;
  }
  return null;
}
function applyThemeNaturalLanguage(text, changes){
  let changed=false;
  // 单类颜色
  let m=text.match(/(警告|注意|禁止|不可|指示|必须|必須|安全|避難|防火|消防|中立|一般|情報|warning|prohibition|mandatory|safe|fire|neutral).*?(?:の)?(?:色|颜色|カラー|color)?\s*(?:を|为|に|改为|換成|设为|设置为)?\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)/i);
  if (m){ const cat=matchCategoryFromText(m[1]); const col=resolveColor(m[2]); if(cat&&col){ CURRENT_THEME[cat].base=col; changes&&changes.push(`${cat} の色：${col}`); changed=true; } }

  // 全カテゴリ
  const all = text.match(/(全部|所有|すべて|全て).*(カテゴリ|类别|海报|ポスター).*(?:の)?(?:色|颜色|カラー|color).*(?:を|为|に)?\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)/i);
  if (all){ const col=resolveColor(all[2]); if(col){ for(const k of Object.keys(CURRENT_THEME)) CURRENT_THEME[k].base=col; changes&&changes.push(`全カテゴリ基調：${col}`); changed=true; } }

  // 重置
  if (/(恢复|還原|还原|リセット|初期化|デフォルト|既定).*(配色|颜色|色|カラー)/i.test(text)){ CURRENT_THEME=sc(DEFAULT_THEME); changes&&changes.push("カテゴリ色：既定に戻す"); changed=true; }
  return changed;
}
function applyBandNaturalLanguage(text){
  if (!text) return null; let changed=false, info={};
  const bandKW="(?:色帯|色塊|色块|顶部色块|顶端色带|上部色帯|ヘッダー帯|ヘッダー|ヘッダ|ヘッダーバンド|上部の帯|バンド)";
  if (new RegExp("(去掉|取消|不要|关闭|關閉|去除|隠す|非表示|無し|外す|オフ).*"+bandKW,"i").test(text)){ SETTINGS.band.height=0; changed=true; info.off=true; }
  if (new RegExp("(开启|打开|显示|顯示|表示|オン|出す|付ける).*"+bandKW,"i").test(text)){ if(SETTINGS.band.height===0) SETTINGS.band.height=160; changed=true; info.off=false; }
  const h1=text.match(new RegExp(bandKW+".*?(?:高度|厚度|高さ|height)\\s*([0-9]{2,4})\\s*(?:px|ピクセル|像素)?","i"));
  if (h1){ SETTINGS.band.height=Math.max(0, Math.min(400,+h1[1])); changed=true; info.height=SETTINGS.band.height; }
  if (new RegExp(bandKW+".*?(加厚|更厚|厚一点|厚一些|厚く|太く|もっと厚く)","i").test(text)){ SETTINGS.band.height=Math.min(400, (SETTINGS.band.height||0)+30); changed=true; info.height=SETTINGS.band.height; }
  if (new RegExp(bandKW+".*?(更薄|变薄|薄く|細く|薄め|少し薄く)","i").test(text)){ SETTINGS.band.height=Math.max(0, (SETTINGS.band.height||0)-30); changed=true; info.height=SETTINGS.band.height; }
  const c1=text.match(new RegExp(bandKW+".*?(?:颜色|色|カラー|color)\\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)","i"));
  if (c1){ const col=resolveColor(c1[1]); if(col){ SETTINGS.band.colorOverride=col; SETTINGS.band.followCategory=false; changed=true; info.color=col; } }
  if (/(跟随|隨|按|回到|恢复|還原|元に戻す|デフォルト|既定|カテゴリ連動|カテゴリー連動)/i.test(text)){ SETTINGS.band.followCategory=true; SETTINGS.band.colorOverride=null; changed=true; info.follow=true; }
  return changed ? info : null;
}

/* ---------- 意图（新建/编辑/完成/加枠） ---------- */
const FINALIZE_RE = /(完成(了|啦)?|这张就这样|保存完成|导出完成|结束|结束吧|确定|確定|確定する|完了|完了です|終了|終わり|次へ|下一张|next one|finalize|done|finish|finished)/i;

function isBorderAddRequest(text){
  return (
    /(枠線|枠|縁|ふち|フチ|ボーダー).*(入れて|入れ|付けて|付け|つけて|つけ|追加|足して|欲しい|ほしい|付与|あり)/i.test(text) ||
    /(加(上)?边框|要边框|加框|需要边框|加邊框)/i.test(text) ||
    /add\s+(a\s+)?(border|frame)/i.test(text)
  );
}
const NEW_POSTER_WORD = /(海报|ポスター|poster)/i;
const NEW_VERB_OBJECT_PATTERN = /(?:(?:作る|作成|生成).*(?:海报|ポスター|poster)|(?:海报|ポスター|poster).*(?:作っ?て(?:ください|下さい|くれ|ほしい|欲しい)|作成して|生成して))/i;
const NO_POS_POSTER_RE = /(.+?)のポスター(?!.*(直す|修正|編集|変更|調整|手直し))/i;
const EDIT_TARGETS_RE = /(背景|背景色|canvas|外側|パネル|面の背景|白地|隙間|スキマ|斜線|ストライプ|枠|枠線|ボーダー|実線|颜色|色|カラー|色帯|ヘッダー帯|サイズ|用紙|A[0-5]|px|フォント|倍率|スケール|行間|余白|パディング|間隔|太さ|厚さ|細さ)/i;

function textHasNewCue(text){
  if (!text) return false;
  return NEW_VERB_OBJECT_PATTERN.test(text) || NO_POS_POSTER_RE.test(text) ||
         (NEW_POSTER_WORD.test(text) && /(作って|作成して|生成して|ください|下さい|欲しい|ほしい|お願いします?)/i.test(text));
}
function textHasEditCue(text){
  if (!text) return false;
  if (!EDIT_TARGETS_RE.test(text)) return false; // 必须出现“可编辑对象”
  return /(改|换|換|设置|设为|變更|変更|にする|に変更|直す|修正|編集|調整|追加|追記|削除|消す|増や|減ら|大きく|小さく|太く|細く|厚く|薄く)/i.test(text) || true;
}
function topicLooksDifferent(text, lastSpec){
  if (!lastSpec) return false;
  const TOPIC_TRIGGER_RE=/(非常口|emergency\s*exit|避難口|仮置き|临时放置|temporary\s*placement|衝突事故|衝突|冲突|collision|体温|検温|測温|测温|temperature\s*check|health\s*check|安全第一|safety\s*first|通行注意|走行車両|forklift)/i;
  if (!TOPIC_TRIGGER_RE.test(text)) return false;
  const titles = `${lastSpec?.jp?.title||""} ${lastSpec?.en?.title||""} ${lastSpec?.zh?.title||""}`;
  return !TOPIC_TRIGGER_RE.test(titles);
}
function classifyIntent(text, lastSpec){
  const t = norm(text);
  if (FINALIZE_RE.test(t)) return { type:"finalize" };
  if (isBorderAddRequest(t)) return { type:"border" };
  const newScore  = textHasNewCue(t)  ? 2 : 0;
  const editScore = textHasEditCue(t) ? 2 : 0;
  const bias = topicLooksDifferent(t, lastSpec) ? 1 : 0;
  if (newScore + bias > editScore) return { type:"new" };
  if (editScore > newScore + bias) return { type:"edit" };
  if (!lastSpec) return { type:"new" };
  return { type: EDIT_TARGETS_RE.test(t) ? "edit" : "new" };
}

/* ---------- 文案编辑（少量必要） ---------- */
function quoted(text){ const m=text.match(/[「『“"']([^「『“"']+)[」』”"']/); return m?m[1].trim():null; }
function pickLangKey(t){ if (/(日文|日語|日本語|JP)/i.test(t)) return "jp"; if (/(英文|英語|EN)/i.test(t)) return "en"; if (/(中文|中国語|ZH)/i.test(t)) return "zh"; return "jp"; }
function ensureLang(obj,k){ obj[k]=obj[k]||{}; return obj[k]; }
function applyTextEdits(text, spec, changes){
  let changed=false;
  const fields=[
    { key:"title", jp:/(見出し|タイトル)/, cn:/(标题|標題)/ },
    { key:"subtitle", jp:/(サブタイトル|副題)/, cn:/(副标题|副題)/ },
    { key:"note", jp:/(注記|注釈|ノート)/, cn:/(备注|注记)/ }
  ];
  for (const f of fields){
    const q=quoted(text);
    const rgJP=new RegExp(f.jp.source+".*?(?:を)?\\s*[「『“\"\']([^「『“\"']+)[」『”\"\']\\s*に(?:する|変更|変える|して)","i");
    const rgCN=new RegExp(f.cn.source+".*?(?:改成|改为|换成|设置为|设为)\\s*([^。！!\\n]+)","i");
    let m=text.match(rgJP);
    if (m || (m=text.match(rgCN))){
      const lang=pickLangKey(text); const val=(q||m[1]).trim(); ensureLang(spec,lang)[f.key]=val;
      changes.push(`${lang.toUpperCase()} ${f.key} を更新`); changed=true;
    }
  }
  return changed;
}

/* ---------- 完成/重置 ---------- */
function resetRuntimeSettings(){
  CURRENT_THEME  = sc(SAFETY);
  SETTINGS.colors= sc(DEFAULT_COLORS);
  SETTINGS.borderColorOverride=null;
  SETTINGS.band.height=160; SETTINGS.band.followCategory=true; SETTINGS.band.colorOverride=null;
  SETTINGS.ui.fontScale=1.0; SETTINGS.ui.paragraphSpacing=14; SETTINGS.ui.stripeWidth=22; SETTINGS.ui.stripeGap=28;
  SETTINGS.panel.paddingX=42; SETTINGS.panel.paddingY=30; SETTINGS.panel.radius=18; SETTINGS.panel.marginX=40; SETTINGS.panel.marginY=24; SETTINGS.panel.shadow=true;
  SETTINGS.solidBorderWidth=14;
  SETTINGS.canvas.width=1404; SETTINGS.canvas.height=993;
}

/* ---------- 友好的系统回复（日本語） ---------- */
function formatBotReply(spec, sizeInfo, bandInfo){
  const catMap={ warning:"黄色の警告", prohibition:"赤の禁止", mandatory:"青の指示", safe:"緑の安全", fire:"防火", neutral:"中立" };
  const jp=spec.jp||{}, en=spec.en||{}, zh=spec.zh||{};
  const bits=[];
  if(jp.title) bits.push(`見出し：「${jp.title}」${jp.subtitle?`（${jp.subtitle}）`:""}`);
  if(en.title || en.subtitle) bits.push(`英文：${[en.title,en.subtitle].filter(Boolean).join(" / ")}`);
  if(zh.title || zh.subtitle || zh.note) bits.push(`中国語：${[zh.title,zh.subtitle,zh.note].filter(Boolean).join(" / ")}`);
  const sizeTxt=sizeInfo ? `${sizeInfo.name}・${sizeInfo.orient}（${sizeInfo.w}×${sizeInfo.h}px）` : `${SETTINGS.canvas.width}×${SETTINGS.canvas.height}px`;
  let bandTxt="";
  if (SETTINGS.band.height===0) bandTxt="上部の色帯：なし";
  else if (SETTINGS.band.followCategory) bandTxt=`上部の色帯：カテゴリ連動，高さ ${SETTINGS.band.height}px`;
  else bandTxt=`上部の色帯：固定色 ${SETTINGS.band.colorOverride}，高さ ${SETTINGS.band.height}px`;
  return `了解しました。内容に合わせてレイアウトを整えました。
- ${bits.join("\n- ")}
- スタイル：${catMap[spec.category]||spec.category}、枠は「${spec.border==="stripes"?"斜線":"実線"}」
- 用紙サイズ：${sizeTxt}
- ${bandTxt}
今回の配色変更はこのポスターのみに適用されます。完了・書き出し・新規作成のあと自動で既定に戻ります。`;
}
function formatEditReply(changes){
  if (!changes || !changes.length) return "ご指定の変更内容は見つかりませんでした。ほかの指示もどうぞ。";
  return "次の内容でポスターを更新しました：\n- " + changes.join("\n- ");
}

/* ---------- 生成主流程 ---------- */
function parseJSONLoose(t){ if(!t) return null; const m=t.match(/```(?:json)?\s*([\s\S]*?)```/i); const body=m?m[1]:t; try{return JSON.parse(body);}catch{return null;} }

async function generatePoster(userText){
  const text = norm(userText);
  const intent = classifyIntent(text, lastSpec);

  if (intent.type === "finalize"){
    resetRuntimeSettings();
    addMsg("bot", "ポスターの仕上げを確認しました。設定を初期状態に戻しました。");
    return;
  }

  if (intent.type === "border"){
    if (lastSpec){
      const spec=sc(lastSpec);
      if (!spec.border || spec.border==="none") spec.border="solid";
      drawPoster(spec);
      addMsg("bot","既存のポスターに枠線（実線）を追加しました。");
      return;
    } else {
      const spec={ jp:{title:"通行注意",subtitle:"走行車両あり"}, en:{subtitle:"Watch for vehicles"}, zh:{note:"行人应小心行驶车辆"}, category:"warning", border:"solid", size:"A3横" };
      drawPoster(spec);
      addMsg("bot","ポスターを作成し、枠線（実線）を適用しました。");
      return;
    }
  }

  // 编辑：在当前图上修改
  if (intent.type === "edit" && lastSpec){
    const spec=sc(lastSpec), changes=[];
    const textChanged = applyTextEdits(text, spec, changes);
    const styleChanged= applyStyleEdits(text, spec, changes);
    if (textChanged || styleChanged){ drawPoster(spec); addMsg("bot", formatEditReply(changes)); }
    else { addMsg("bot", formatEditReply([])); }
    return;
  }

  // 新建：重置设定
  if (intent.type === "new" || !lastSpec){
    resetRuntimeSettings();
  }

  // —— 新建生成（LLM→预设→兜底）——
  let data;
  if (engine){
    try{
      const reply = await engine.chat.completions.create({
        messages: [{ role:"system", content: SYSTEM_PROMPT }, { role:"user", content: text }],
        max_tokens: 500
      });
      data = parseJSONLoose(reply.choices?.[0]?.message?.content || "");
    }catch{}
  }

  // 叠加预设（优先保证主题准确）
  const preset = matchPreset(text);
  if (preset) data = mergeWithPreset(data, preset);

  // 常见兜底：未命中时也给合理分类与枠
  if (!data) {
    data = { jp:{title:"通行注意", subtitle:"走行車両あり"}, en:{subtitle:"Watch for vehicles"}, zh:{note:"行人应小心行驶车辆"}, category:"warning", border:"stripes", size:"A3横", icon:"forklift" };
  }

  // 大小
  const sizeInfo = applyCanvasSizeBySpec(data.size, text);
  // 上部色带、主题色/背景（即使在新建阶段，也允许自然语言先改色）
  applyThemeNaturalLanguage(text);
  applyBackgroundColorNaturalLanguage(text);
  const bandInfo = applyBandNaturalLanguage(text);

  const spec = {
    jp: data.jp || {}, en: data.en || {}, zh: data.zh || {},
    category: (["warning","prohibition","mandatory","safe","fire","neutral"].includes(data.category) ? data.category : "warning"),
    border: (["stripes","solid","none"].includes(data.border) ? data.border : "stripes"),
    size: data.size || "A3横", icon: data.icon || ""
  };

  drawPoster(spec);
  addMsg("bot", formatBotReply(spec, sizeInfo, bandInfo));
}
function mergeWithPreset(a,b){
  if(!b) return a;
  const m=sc(a||{});
  m.jp={...(a?.jp||{}),...(b.jp||{})};
  m.en={...(a?.en||{}),...(b.en||{})};
  m.zh={...(a?.zh||{}),...(b.zh||{})};
  if(b.category) m.category=b.category;
  if(b.border)   m.border=b.border;
  if(b.size)     m.size=b.size;
  if(b.icon)     m.icon=b.icon;
  return m;
}

/* ---------- 控制面板（齿轮更大，不挡标题） ---------- */
function createControlPanel(){
  const btn=document.createElement("button");
  btn.textContent="⚙︎"; btn.title="設定";
  btn.style.cssText=`
    position: fixed; top: 16px; right: 16px; z-index: 1000;
    width: 56px; height: 56px; border-radius: 28px; border: none;
    background: #0a84ff; color: #fff; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 28px; line-height: 1;
    box-shadow: 0 6px 18px rgba(10,132,255,.35);
  `;
  document.body.appendChild(btn);

  const panel=document.createElement("div");
  panel.style.cssText=`
    position: fixed; top: 84px; right: 16px; z-index: 999;
    width: 270px; padding: 12px; border-radius: 12px;
    background: rgba(255,255,255,.98); border: 1px solid #e6e8eb;
    font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans JP", sans-serif;
    box-shadow: 0 10px 24px rgba(0,0,0,.12); display: none;
  `;
  panel.innerHTML=`
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

  btn.onclick=()=>{ panel.style.display = panel.style.display==="none" ? "block" : "none"; };
  panel.querySelector("#ui-close").onclick=()=>{ panel.style.display="none"; };

  const $=s=>panel.querySelector(s);
  const update=()=> redrawLast();
  $("#ui-font").oninput    = e=>{ SETTINGS.ui.fontScale        = parseFloat(e.target.value); $("#v-font").textContent=SETTINGS.ui.fontScale.toFixed(2); update(); };
  $("#ui-para").oninput    = e=>{ SETTINGS.ui.paragraphSpacing = parseInt(e.target.value,10); $("#v-para").textContent=SETTINGS.ui.paragraphSpacing;    update(); };
  $("#ui-stripeW").oninput = e=>{ SETTINGS.ui.stripeWidth      = parseInt(e.target.value,10); $("#v-sw").textContent  =SETTINGS.ui.stripeWidth;         update(); };
  $("#ui-stripeG").oninput = e=>{ SETTINGS.ui.stripeGap        = parseInt(e.target.value,10); $("#v-sg").textContent  =SETTINGS.ui.stripeGap;           update(); };
  $("#ui-padx").oninput    = e=>{ SETTINGS.panel.paddingX      = parseInt(e.target.value,10); $("#v-padx").textContent=SETTINGS.panel.paddingX;         update(); };
  $("#ui-pady").oninput    = e=>{ SETTINGS.panel.paddingY      = parseInt(e.target.value,10); $("#v-pady").textContent=SETTINGS.panel.paddingY;         update(); };
}
function redrawLast(){ if(lastSpec) drawPoster(lastSpec); }
createControlPanel();

/* ---------- 指令履历（左上按钮下移，不遮标题） ---------- */
(function createHistory(){
  const btn=document.createElement("button");
  btn.textContent="📜"; btn.title="指令履歴";
  btn.style.cssText=`
    position: fixed; top: 16px; left: 16px; z-index: 1000;
    width: 56px; height: 56px; border-radius: 28px; border: none;
    background:#111827;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;
    font-weight:800;font-size:26px;line-height:1; box-shadow:0 6px 18px rgba(17,24,39,.35);
  `;
  document.body.appendChild(btn);

  const wrap=document.createElement("div");
  wrap.style.cssText=`
    position: fixed; top: 84px; left: 16px; z-index: 999;
    width: 320px; max-height: 80vh; padding: 12px; border-radius: 12px;
    background: rgba(255,255,255,.98); border: 1px solid #e6e8eb;
    font: 13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans JP",sans-serif;
    box-shadow: 0 10px 24px rgba(0,0,0,.12); display: none;
  `;
  wrap.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
    <strong>指令履歴</strong>
    <button id="h-close" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;background:#f3f4f6;cursor:pointer;">✕</button>
  </div>
  <div id="h-list" style="overflow:auto;max-height:calc(80vh - 90px);"></div>`;
  document.body.appendChild(wrap);

  function push(text){
    const row=document.createElement("div");
    row.style.cssText="border:1px solid #e5e7eb;border-radius:10px;padding:8px 10px;margin-bottom:8px;background:#fff;font-size:13px;color:#111827;";
    row.textContent=text;
    const list=wrap.querySelector("#h-list"); list.prepend(row);
  }
  btn.onclick=()=>{ wrap.style.display = wrap.style.display==="none" ? "block":"none"; };
  wrap.querySelector("#h-close").onclick=()=> wrap.style.display="none";

  // 暴露一个简易记录器
  window.__pushHistorySimple = push;
})();

/* ---------- 输入/键盘（IME 友好；回车发送/Shift+回车换行） ---------- */
let composing=false;
promptEl.addEventListener("compositionstart", ()=> composing=true);
promptEl.addEventListener("compositionend",   ()=> composing=false);
promptEl.addEventListener("keydown", e => {
  if (e.key==="Enter"){ if (e.isComposing || composing) return; if (e.shiftKey) return; e.preventDefault(); sendBtn.click(); }
});
sendBtn.onclick=()=>{
  const t=promptEl.value.trim();
  if (t){ addMsg("user", t); window.__pushHistorySimple && window.__pushHistorySimple(t); generatePoster(t); }
  promptEl.value="";
};
dlBtn.onclick=()=>{
  const url=canvas.toDataURL("image/png");
  const a=document.createElement("a"); a.href=url; a.download="poster.png"; a.click();
  resetRuntimeSettings();
  addMsg("bot","書き出しが完了しました。次のポスターは既定の配色・サイズから開始します。");
};

/* ---------- 初期表示：斜線（要求通り） ---------- */
drawPoster({
  jp: { title: "安全第一", subtitle: "指差呼称・周囲確認・事故ゼロへ" },
  en: { subtitle: "Safety First" },
  zh: { note: "安全第一，谨慎作业" },
  category: "warning",
  border: "stripes",
  size: "A3横"
});
