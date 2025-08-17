/* =========================================================
 * Poster Generator — 完整版 app.js（含可选增强）
 *  - 调试开关（UI + URL + localStorage）
 *  - NLU词表外置（易扩展）
 *  - 日志采样（console.debug + 本地缓存 + 导出）
 *  - 回归测试套件（window.__debug_*）
 *  - 保持此前所有修复：颜色“は”解析、斜线环绕、指令履历、IME回车、初始斜线等
 * ========================================================= */

/* =========================
 * WebLLM（可失败；不影响基本功能）
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
 * 可选增强：调试 & 日志
 * ========================= */
const DEBUG_STORE_KEY = "poster_debug_on";
const DEBUG_LOG_KEY   = "poster_intent_logs";
const DEBUG = {
  on: (new URL(location.href).searchParams.get("debug") === "1") || (localStorage.getItem(DEBUG_STORE_KEY) === "1"),
  sampleRate: 0.35,         // 采样概率（0~1）
  maxLogs: 300              // 本地最多缓存条数
};
function debugSet(on){
  DEBUG.on = !!on;
  try{ localStorage.setItem(DEBUG_STORE_KEY, DEBUG.on ? "1":"0"); }catch{}
  badge && (badge.style.display = DEBUG.on ? "flex":"none");
  if (DEBUG.on) console.debug("[DEBUG] intent debug ON");
}
function debugMaybeLogIntent(payload){
  if (!DEBUG.on) return;
  if (Math.random() > DEBUG.sampleRate) return;
  try{
    console.debug("[intent]", payload);
    const raw = localStorage.getItem(DEBUG_LOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    arr.push(Object.assign({ ts: Date.now() }, payload));
    while (arr.length > DEBUG.maxLogs) arr.shift();
    localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(arr));
  }catch(e){ /* ignore */ }
}
function debugExportLogs(){
  try{
    const raw = localStorage.getItem(DEBUG_LOG_KEY) || "[]";
    const blob = new Blob([raw], {type:"application/json"});
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "poster_intent_logs.json"; a.click();
    setTimeout(()=> URL.revokeObjectURL(url), 500);
  }catch(e){ alert("导出失败"); }
}
function debugClearLogs(){
  try{ localStorage.removeItem(DEBUG_LOG_KEY); alert("已清除意图日志"); }catch{}
}

/* 调试徽标+按钮（左下） */
let badge;
(function createDebugBadge(){
  const btn = document.createElement("button");
  btn.textContent = "🐞";
  btn.title = "调试开关（点击开关 / Shift+点 导出日志 / Alt+点 清空日志）";
  btn.style.cssText = `
    position: fixed; left: 16px; bottom: 16px; z-index: 1200;
    width: 46px; height: 46px; border-radius: 23px; border: none;
    background:#111827; color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center;
    font-size:22px; box-shadow:0 6px 18px rgba(0,0,0,.28);
  `;
  btn.onclick = (e)=>{
    if (e.shiftKey){ debugExportLogs(); return; }
    if (e.altKey){ debugClearLogs(); return; }
    debugSet(!DEBUG.on);
  };
  document.body.appendChild(btn);

  badge = document.createElement("div");
  badge.style.cssText = `
    position: fixed; left: 72px; bottom: 16px; z-index: 1200;
    height: 28px; padding: 0 10px; align-items:center; justify-content:center;
    display:${DEBUG.on?"flex":"none"}; border-radius:999px; background:#10b981; color:#fff; font:12px/1.1 system-ui;
    box-shadow:0 6px 18px rgba(16,185,129,.35);
  `;
  badge.textContent = "DEBUG ON";
  document.body.appendChild(badge);
})();

/* =========================
 * 词表外置（NLU）
 * ========================= */
const NLU_WORDS = {
  editTargets: [
    "背景","背景色","canvas","面板","パネル","面の背景","白地","隙間","スキマ",
    "斜線","斜纹","ストライプ","枠","枠線","ボーダー","実線","颜色","色","カラー",
    "色帯","ヘッダー帯","band","header","サイズ","用紙","A[0-5]","px",
    "フォント","字体","倍率","スケール","行間","余白","パディング","間隔","太さ","厚さ","細さ","太く","細く","厚く","薄く"
  ],
  newVerbPhrases: [
    "作ってください","作って下さい","作ってくれ","作ってほしい","作って欲しい",
    "作成して","生成して","お願いします","お願い","頼む",
    "create","make","generate","创建","生成","做","制作"
  ],
  topicTriggers: [
    "非常口","emergency\\s*exit","避難口","仮置き","临时放置","temporary\\s*placement",
    "衝突事故","衝突","冲突","collision","体温","検温","測温","测温","temperature\\s*check","health\\s*check",
    "安全第一","safety\\s*first","通行注意","走行車両","forklift"
  ],
  editVerbs: [
    "改","换","換","设置","设为","變更","変更","にする","に変更","直す","修正","編集","調整","調節",
    "追加","追記","削除","消す","増や","減ら","大きく","小さく","太く","細く","厚く","薄く"
  ]
};
function makeReFromList(list, flags="i", asAlt=false){
  const src = asAlt ? list.join("|") : list.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(src, flags);
}
// 编译正则（仅一次）
const EDIT_TARGETS_RE = makeReFromList(NLU_WORDS.editTargets, "i", true);
const EDIT_VERBS_RE   = makeReFromList(NLU_WORDS.editVerbs,   "i", true);
const TOPIC_TRIGGER_RE= makeReFromList(NLU_WORDS.topicTriggers,"i", true);
// 新建意图的组合规则
const NEW_POSTER_WORD = /(海报|ポスター|poster)/i;
const NEW_VERB_PHRASES_RE = makeReFromList(NLU_WORDS.newVerbPhrases, "i", true);
const NEW_VERB_OBJECT_PATTERN = new RegExp(
  "(?:" + [
    "(?:作る|作成|生成).*(?:海报|ポスター|poster)",
    "(?:海报|ポスター|poster).*?(?:作っ?て(?:ください|下さい|くれ|ほしい|欲しい)|作成して|生成して)"
  ].join("|") + ")", "i"
);
const NO_POS_POSTER_RE = /(.+?)のポスター(?!.*(直す|修正|編集|変更|調整|手直し))/i;

function norm(s){
  if (!s) return "";
  return s.replace(/[“”„‟＂]/g, '"')
          .replace(/[‘’＇]/g, "'")
          .replace(/[「『]/g, '"').replace(/[」』]/g, '"')
          .replace(/\s+/g, " ")
          .trim();
}

/* =========================
 * 设定与主题色
 * ========================= */
const SETTINGS = {
  canvas: { width: 1404, height: 993 },   // A3 横
  band: { height: 160, followCategory: true, colorOverride: null },
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
  ui: { fontScale: 1.0, paragraphSpacing: 14, stripeWidth: 22, stripeGap: 28 },
  colors: { canvasBg: "#ffffff", panelBg: "#ffffff", ringBg: "#ffffff" },
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
const DEFAULT_THEME  = JSON.parse(JSON.stringify(SAFETY));
let   CURRENT_THEME  = JSON.parse(JSON.stringify(DEFAULT_THEME));
const DEFAULT_COLORS = { canvasBg: "#ffffff", panelBg: "#ffffff", ringBg: "#ffffff" };
const COLOR_SCOPE_NOTE = "※ 配色の変更は「今回のポスター」のみ有効です。次回の新規作成時に既定色へ自動的に戻ります。";

/* =========================
 * LLM 系统提示
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

/* 工具 */
function sc(o){ return (typeof structuredClone === "function") ? structuredClone(o) : JSON.parse(JSON.stringify(o)); }

/* 纸型/尺寸解析 */
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

/* 颜色解析（含“は”支持） */
function cleanColorWord(s){
  if (!s) return s;
  s = s.trim();
  s = s.replace(/(にして|に変更|にする|にしたい(?:です)?|したい(?:です)?|にしてください|してください|でお願いします|ください|下さい|お願いします?|お願い|です|だ)$/i, "");
  s = s.replace(/[にへでをはがもやとか、。．，,！!？?\s~〜]+$/g, "");
  return s.trim();
}
const COLOR_MAP = {
  red:"#C62828", yellow:"#F9A900", blue:"#005387", green:"#237F52", black:"#000000", white:"#ffffff", gray:"#9e9e9e", grey:"#9e9e9e",
  orange:"#FFA500", purple:"#800080", pink:"#FFC0CB", brown:"#8B4513", cyan:"#00BCD4", magenta:"#FF00FF", navy:"#000080", teal:"#008080",
  maroon:"#800000", lime:"#00FF00", gold:"#FFD700", silver:"#C0C0C0", beige:"#F5F5DC", indigo:"#4B0082", violet:"#8A2BE2", skyblue:"#87CEEB",
  "红":"#C62828","红色":"#C62828","赤色":"#C62828","酒红":"#800000","棕色":"#8B4513",
  "黄":"#F9A900","黄色":"#F9A900","橙":"#FFA500","橙色":"#FFA500","金色":"#FFD700",
  "蓝":"#005387","蓝色":"#005387","天蓝":"#87CEEB","海军蓝":"#000080",
  "绿":"#237F52","绿色":"#237F52","青色":"#008080","青绿":"#008080","青綠":"#008080",
  "紫":"#800080","紫色":"#800080","紫罗兰":"#8A2BE2","粉":"#FFC0CB","粉色":"#FFC0CB",
  "黑":"#000000","黑色":"#000000","白":"#ffffff","白色":"#ffffff","灰":"#9e9e9e","灰色":"#9e9e9e","银色":"#C0C0C0","銀色":"#C0C0C0","米色":"#F5F5DC",
  "赤":"#C62828","レッド":"#C62828","エンジ":"#800000","黄":"#F9A900","黄色":"#F9A900","イエロー":"#F9A900","ゴールド":"#FFD700",
  "橙色":"#FFA500","オレンジ":"#FFA500","青":"#005387","青色":"#005387","ブルー":"#005387","水色":"#87CEEB","紺":"#000080","ネイビー":"#000080",
  "緑":"#237F52","緑色":"#237F52","グリーン":"#237F52","ティール":"#008080","青緑":"#008080","紫":"#800080","パープル":"#800080","バイオレット":"#8A2BE2",
  "インディゴ":"#4B0082","ピンク":"#FFC0CB","マゼンタ":"#FF00FF","茶色":"#8B4513","ブラウン":"#8B4513","黒":"#000000","黒色":"#000000","ブラック":"#000000",
  "白":"#ffffff","白色":"#ffffff","ホワイト":"#ffffff","灰色":"#9e9e9e","グレー":"#9e9e9e","シルバー":"#C0C0C0","ベージュ":"#F5F5DC",
  "公司蓝":"#0a84ff","企业蓝":"#0a84ff","品牌蓝":"#0a84ff","会社ブルー":"#0a84ff","企業ブルー":"#0a84ff","コーポレートカラー":"#0a84ff","ブランドブルー":"#0a84ff"
};
function resolveColor(word){
  if (!word) return null;
  word = cleanColorWord(word);
  const hex = word.match(/#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})/i);
  if (hex) return "#" + hex[1].toLowerCase();
  let m = word.match(/rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*(0|0?\.\d+|1))?\s*\)/i);
  if (m){
    const toHex = n => Math.max(0, Math.min(255, n|0)).toString(16).padStart(2,"0");
    return `#${toHex(+m[1])}${toHex(+m[2])}${toHex(+m[3])}`;
  }
  m = word.match(/hsla?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})%\s*,\s*([0-9]{1,3})%(?:\s*,\s*(0|0?\.\d+|1))?\s*\)/i);
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
  const norm = word.replace(/(颜色?|色|カラー)$/i, "").toLowerCase();
  return COLOR_MAP[norm] || COLOR_MAP[word] || null;
}

/* 类别别名 */
const CAT_ALIASES = {
  warning:     ["警告","注意","warning","黄标","黄色类"],
  prohibition: ["禁止","不可","prohibition","止まれ","停止"],
  mandatory:   ["指示","必须","必須","mandatory","着用"],
  safe:        ["安全","避難","疏散","safe","非常口"],
  fire:        ["防火","消防","火気","fire","火災"],
  neutral:     ["中立","一般","情報","neutral"]
};
function matchCategoryFromText(text){
  for (const [key, arr] of Object.entries(CAT_ALIASES)) {
    const re = new RegExp(arr.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|"), "i");
    if (re.test(text)) return key;
  }
  return null;
}

/* 主题配色（当前海报） & 背景/面板/斜纹空隙颜色：自然语言 */
function applyThemeNaturalLanguage(text, changes){
  let changed=false;
  const all = text.match(/(全部|所有|すべて|全て).*(カテゴリ|类别|海报|ポスター).*(?:の)?(?:色|颜色|カラー|color).*(?:を|为|に)?\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)/i);
  if (all){ const col=resolveColor(all[2]); if(col){ for (const k of Object.keys(CURRENT_THEME)) CURRENT_THEME[k].base = col; changes&&changes.push(`全カテゴリの基調色を ${col} に`); changed=true; } }
  if (/(恢复|還原|还原|リセット|初期化|デフォルト|既定).*(配色|颜色|色|カラー)/i.test(text)){ CURRENT_THEME=sc(DEFAULT_THEME); changes&&changes.push("カテゴリ色を既定に戻す"); changed=true; }
  let m=text.match(/(警告|注意|禁止|不可|指示|必须|必須|安全|避難|防火|消防|中立|一般|情報|warning|prohibition|mandatory|safe|fire|neutral).*?(?:の)?(?:色|颜色|カラー|color)?\s*(?:を|为|に|改为|換成|设为|设置为)?\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)/i);
  if (m){ const cat=matchCategoryFromText(m[1]); const col=resolveColor(m[2]); if(cat&&col){ CURRENT_THEME[cat].base=col; changed=true; changes&&changes.push(`${cat} の色を ${col} に`);} }
  let m2=text.match(/(警告|注意|禁止|指示|必須|安全|避難|防火|消防|中立|一般|情報)\s*(?:の)?色?\s*を\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)\s*に/i);
  if (m2){ const cat=matchCategoryFromText(m2[1]); const col=resolveColor(m2[2]); if(cat&&col){ CURRENT_THEME[cat].base=col; changed=true; changes&&changes.push(`${cat} の色を ${col} に`);} }
  return changed;
}
function applyBackgroundColorNaturalLanguage(text, changes){
  let changed=false;
  let mRing=text.match(/(白色部分|白色区域|空隙|缝隙|間隙|斜纹间隙|斜線間隙|斜線の隙間|斜纹的空白|斜線の白地|白地|白い部分|隙間|すき間|スキマ|ストライプの隙間|縞の隙間|縞のすき間|縞の間).*?(?:改成|改为|变成|に|にして|に変更|にする|で|を|は)?\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)/i);
  if (mRing){ const col=resolveColor(mRing[2]); if(col){ SETTINGS.colors.ringBg = col; changed=true; changes&&changes.push(`斜線の隙間色：${col}`);} }
  let mBg=text.match(/(背景|背景色|バックグラウンド|background|canvas).*?(?:改成|改为|变成|に|にして|に変更|にする|で|を|は)?\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)/i);
  if (mBg){ const col=resolveColor(mBg[2]); if(col){ SETTINGS.colors.canvasBg = col; changed=true; changes&&changes.push(`背景色：${col}`);} }
  let mPanel=text.match(/(面板|面盤|パネル|內側|内側|内容面|面の背景|panel).*?(?:改成|改为|变成|に|にして|に変更|にする|で|を|は)?\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)/i);
  if (mPanel){ const col=resolveColor(mPanel[2]); if(col){ SETTINGS.colors.panelBg = col; changed=true; changes&&changes.push(`パネル背景：${col}`);} }
  return changed;
}

/* 顶部色带 */
function applyBandNaturalLanguage(text){
  if (!text) return null;
  let changed=false, info={};
  const bandKW="(?:色带|色塊|色块|顶部色块|顶端色带|上部色帯|ヘッダー帯|ヘッダー|ヘッダ|ヘッダーバンド|上部の帯|バンド)";
  if (new RegExp("(去掉|取消|不要|关闭|關閉|去除|隠す|非表示|無し|外す|オフ).*"+bandKW, "i").test(text)){ SETTINGS.band.height=0; changed=true; info.off=true; }
  if (new RegExp("(开启|打开|显示|顯示|表示|オン|出す|付ける).*"+bandKW, "i").test(text)){ if(SETTINGS.band.height===0) SETTINGS.band.height=160; changed=true; info.off=false; }
  const h1=text.match(new RegExp(bandKW+".*?(?:高度|厚度|高さ|height)\\s*([0-9]{2,4})\\s*(?:px|ピクセル|像素)?","i"));
  if (h1){ SETTINGS.band.height=Math.max(0, Math.min(400, +h1[1])); changed=true; info.height=SETTINGS.band.height; }
  if (new RegExp(bandKW+".*?(加厚|更厚|厚一点|厚一些|厚く|太く|もっと厚く)","i").test(text)){ SETTINGS.band.height=Math.min(400, (SETTINGS.band.height||0)+30); changed=true; info.height=SETTINGS.band.height; }
  if (new RegExp(bandKW+".*?(更薄|变薄|薄く|細く|薄め|少し薄く)","i").test(text)){ SETTINGS.band.height=Math.max(0, (SETTINGS.band.height||0)-30); changed=true; info.height=SETTINGS.band.height; }
  const c1=text.match(new RegExp(bandKW+".*?(?:颜色|色|カラー|color)\\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)","i"));
  if (c1){ const col=resolveColor(c1[1]); if(col){ SETTINGS.band.colorOverride=col; SETTINGS.band.followCategory=false; changed=true; info.color=col; } }
  if (/(跟随|隨|按|回到|恢复|還原|元に戻す|デフォルト|既定|カテゴリ連動|カテゴリー連動)/i.test(text)){ SETTINGS.band.followCategory=true; SETTINGS.band.colorOverride=null; changed=true; info.follow=true; }
  return changed ? info : null;
}

/* 预设 */
const PRESETS = [
  { match: /(体温|検温|測温|测温|temperature\s*check|health\s*check|注意身体|体調|体调|发烧|fever)/i,
    spec: { jp:{title:"体温測定",note:"体調に変化があれば すぐに報告してください"}, en:{subtitle:"Have you taken your temperature?",note:"Please report any changes immediately"}, zh:{note:"是否已测量体温？有异常请立即报告"}, category:"mandatory", border:"stripes", size:"A3横", icon:"thermometer" } },
  { match: /(非常口|emergency\s*exit|避難口)/i,
    spec: { jp:{title:"非常口",subtitle:"前に物を置かない"}, en:{title:"Emergency exit",subtitle:"Do not place items here"}, zh:{note:"紧急出口前禁止放置物品"}, category:"safe", border:"solid", size:"A3横", icon:"exit" } },
  { match: /(衝突事故|衝突|冲突|collision|接触事故|ぶつかり)/i,
    spec: { jp:{title:"衝突注意"}, en:{subtitle:"Watch for collisions"}, zh:{note:"注意冲突"}, category:"warning", border:"stripes", size:"A3横", icon:"collision" } },
  { match: /(仮置き|临时放置|temporary\s*placement)/i,
    spec: { jp:{title:"仮置き禁止",subtitle:"通路・ラインを確保"}, en:{subtitle:"No temporary placement"}, zh:{note:"禁止临时堆放"}, category:"prohibition", border:"stripes", size:"A3横", icon:"no-box" } },
  { match: /(安全(第一)?|safety( first)?)/i,
    spec: { jp:{title:"安全第一",subtitle:"指差呼称・周囲確認"}, en:{title:"Safety First"}, zh:{note:"安全第一，谨慎作业"}, category:"warning", border:"stripes", size:"A3横", icon:"helmet" } }
];
function matchPreset(t){ for (const p of PRESETS) if (p.match.test(t)) return sc(p.spec); return null; }
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

/* 文本测量与排版 */
function withFontSize(fontSpec, px){ return fontSpec.replace(/(?<=\s)(\d+(?:\.\d+)?)px(?=\s*['"]?)/, `${px}px`); }
function getPx(fontSpec){ const m=fontSpec.match(/(\d+(?:\.\d+)?)px/); return m?+m[1]:32; }
function canFitSingleLine(text, fontSpec, maxWidth){ ctx.font=fontSpec; return ctx.measureText(text).width<=maxWidth; }
function fitSingleLine(text, baseFont, maxWidth, cfg={}, scale=1){
  const opt = Object.assign({minPx:28,maxPx:80,step:2}, cfg||{});
  const available = maxWidth/Math.max(scale,0.1);
  for(let px=opt.maxPx; px>=opt.minPx; px-=opt.step){
    const f=withFontSize(baseFont, px);
    if (canFitSingleLine(text, f, available)) return { font:withFontSize(baseFont, Math.round(px*scale)), size:Math.round(px*scale), wrapped:false };
  }
  const minScaled=Math.round(opt.minPx*scale);
  return { font:withFontSize(baseFont,minScaled), size:minScaled, wrapped:true };
}
function wrapLines(text, font, maxWidth){
  if (!text) return [];
  ctx.font=font;
  const words=text.split(/\s+/), lines=[]; let line="";
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

/* 圆角 & 斜纹环 */
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

  ctx.fillStyle = SETTINGS.colors.ringBg || "#fff";
  ctx.fillRect(0,0,w,h);

  ctx.strokeStyle=color; ctx.lineWidth=stripeW;
  const diag=Math.sqrt(w*w + h*h);
  ctx.translate(w/2,h/2); ctx.rotate(-Math.PI/6); ctx.translate(-w/2,-h/2);
  for(let x=-diag; x<diag*2; x+=stripeW+gap){
    ctx.beginPath(); ctx.moveTo(x,-diag); ctx.lineTo(x, diag*2); ctx.stroke();
  }
  ctx.restore();

  ctx.save(); ctx.lineWidth=frame; ctx.strokeStyle=color;
  ctx.stroke(roundRectPath(10,10,w-20,h-20,16));
  ctx.restore();
}

/* 布局测量 */
function layoutBlocks(spec){
  const W=SETTINGS.canvas.width, H=SETTINGS.canvas.height, maxWidth=W-SETTINGS.marginX*2;
  const scale=Math.max(SETTINGS.ui.fontScale,0.1), paraGap=Math.round(SETTINGS.ui.paragraphSpacing);
  const blocks=[]; const jp=spec.jp||{}, en=spec.en||{}, zh=spec.zh||{};
  const add=(lines,font,color,lh)=>{ if(lines && lines.length) blocks.push({lines,font,color,lineHeight:Math.round(lh*scale)}); };
  const sfont=fs=>withFontSize(fs, Math.round(getPx(fs)*scale));

  if (jp.title){
    const fit=fitSingleLine(jp.title, SETTINGS.fonts.jpTitle, maxWidth, SETTINGS.autoFit.jpTitle, scale);
    add(fit.wrapped?wrapLines(jp.title, fit.font, maxWidth):[jp.title], fit.font, "#111", SETTINGS.lineHeights.jpTitle);
  }
  if (jp.subtitle) add(wrapLines(jp.subtitle, sfont(SETTINGS.fonts.jpSubtitle), maxWidth), sfont(SETTINGS.fonts.jpSubtitle), "#333", SETTINGS.lineHeights.jpSubtitle);
  if (jp.note)     add(wrapLines(jp.note,     sfont(SETTINGS.fonts.jpNote),     maxWidth), sfont(SETTINGS.fonts.jpNote),     "#444", SETTINGS.lineHeights.jpNote);

  if (en.title){
    const fit=fitSingleLine(en.title, SETTINGS.fonts.enTitle, maxWidth, SETTINGS.autoFit.enTitle, scale);
    add(fit.wrapped?wrapLines(en.title, fit.font, maxWidth):[en.title], fit.font, "#1a1a1a", SETTINGS.lineHeights.enTitle);
  }
  if (en.subtitle) add(wrapLines(en.subtitle, sfont(SETTINGS.fonts.enSubtitle), maxWidth), sfont(SETTINGS.fonts.enSubtitle), "#1a1a1a", SETTINGS.lineHeights.enSubtitle);
  if (en.note)     add(wrapLines(en.note,     sfont(SETTINGS.fonts.enNote),     maxWidth), sfont(SETTINGS.fonts.enNote),     "#222", SETTINGS.lineHeights.enNote);

  if (zh.title){
    const fit=fitSingleLine(zh.title, SETTINGS.fonts.zhTitle, maxWidth, SETTINGS.autoFit.zhTitle, scale);
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
    if (bi !== blocks.length-1) totalH += paraGap;
  });
  const textWidth=maxLeft+maxRight;
  return { blocks,totalH,textWidth,maxWidth,scale,paraGap,firstAscent,lastDescent };
}

/* 绘制 */
let lastSpec=null;
function drawPoster(spec){
  lastSpec=spec;
  const W=SETTINGS.canvas.width,H=SETTINGS.canvas.height;
  canvas.width=W; canvas.height=H;

  ctx.fillStyle=SETTINGS.colors.canvasBg||"#fff";
  ctx.fillRect(0,0,W,H);

  const L=layoutBlocks(spec);

  const bandH=SETTINGS.band.height||0;
  const bandColor=SETTINGS.band.followCategory
    ? (CURRENT_THEME[spec.category]?.base||"#999")
    : (SETTINGS.band.colorOverride||"#999");

  const borderColor=SETTINGS.borderColorOverride || bandColor;

  if (bandH>0){ ctx.fillStyle=bandColor; ctx.fillRect(0,0,W,bandH); }

  const centerX=W/2;
  const firstBaselineY=(H+bandH)/2 - L.totalH/2;
  const contentTop    = firstBaselineY - L.firstAscent;
  const contentBottom = firstBaselineY + L.totalH + L.lastDescent;
  const contentHeight = contentBottom - contentTop;

  const padX=SETTINGS.panel.paddingX, padY=SETTINGS.panel.paddingY;
  let panelW=Math.min(L.textWidth + padX*2, W - SETTINGS.panel.marginX*2);
  let panelH=Math.min(contentHeight + padY*2, H - (bandH + SETTINGS.panel.marginY) - SETTINGS.panel.marginY);

  let panelX=Math.max(SETTINGS.panel.marginX, centerX - panelW/2);
  let panelY=Math.max(bandH + SETTINGS.panel.marginY, contentTop - padY);
  if (panelY + panelH > H - SETTINGS.panel.marginY) panelY = H - SETTINGS.panel.marginY - panelH;

  const panelPath=roundRectPath(panelX, panelY, panelW, panelH, SETTINGS.panel.radius);

  if (spec.border==="stripes"){ drawStripeRingAroundRect(ctx, W,H, borderColor, {x:panelX,y:panelY,w:panelW,h:panelH}, SETTINGS.panel.radius); }
  else if (spec.border==="solid"){ ctx.strokeStyle=borderColor; ctx.lineWidth=SETTINGS.solidBorderWidth; ctx.stroke(roundRectPath(10,10,W-20,H-20,16)); }

  ctx.save();
  if (SETTINGS.panel.shadow){ ctx.shadowColor="rgba(0,0,0,.06)"; ctx.shadowBlur=12; }
  ctx.fillStyle=SETTINGS.colors.panelBg||"#fff"; ctx.fill(panelPath);
  ctx.restore();

  ctx.textAlign="center"; ctx.textBaseline="alphabetic";
  let y=firstBaselineY; const cx=W/2;
  L.blocks.forEach((b,bi)=>{ ctx.font=b.font; ctx.fillStyle=b.color; b.lines.forEach(ln=>{ ctx.fillText(ln, cx, y); y+=b.lineHeight; }); if (bi!==L.blocks.length-1) y += L.paraGap; });
}

/* 文本编辑 */
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
function pickLangKey(t){ if (/(日文|日語|日本語|JP)/i.test(t)) return "jp"; if (/(英文|英語|EN)/i.test(t)) return "en"; if (/(中文|中国語|ZH)/i.test(t)) return "zh"; return "jp"; }
function ensureLang(obj,k){ obj[k]=obj[k]||{}; return obj[k]; }
function quoted(text){ const m=text.match(/[「『“"']([^「『“"']+)[」』”"']/); return m?m[1].trim():null; }

function applyTextEdits(text, spec, changes){
  let changed=false;
  if (/(去掉|删除|不要|消す|削除)(英文|英語|EN)/i.test(text)){ spec.en={}; changes.push("英語を削除"); changed=true; }
  if (/(去掉|删除|不要|消す|削除)(中文|中国語|ZH)/i.test(text)){ spec.zh={}; changes.push("中国語を削除"); changed=true; }
  if (/(去掉|删除|不要|消す|削除)(日文|日本語|JP)/i.test(text)){ spec.jp={}; changes.push("日本語を削除"); changed=true; }

  const fieldRegs = [
    { key:"title",    cn:/(标题|標題|見出し|タイトル)/, jp:/(見出し|タイトル)/ },
    { key:"subtitle", cn:/(副标题|副題|サブタイトル)/,   jp:/(サブタイトル|副題)/ },
    { key:"note",     cn:/(备注|注记|注釈|ノート|注記)/,   jp:/(注記|注釈|ノート)/ }
  ];

  for (const field of fieldRegs){
    let rgSetCN=new RegExp("(?:把)?(?:(日文|日語|日本語|JP|英文|英語|EN|中文|中国語|ZH))?.*?"+field.cn.source+".*?(改成|改为|换成|设置为|设为)","i");
    let rgSetJP=new RegExp("(?:(日本語|英語|中国語|JP|EN|ZH))?.*?"+field.jp.source+".*?(?:を)?\\s*[「『“\"\']([^「『“\"']+)[」『”\"\']\\s*に(?:する|変更|変える|して)","i");
    const q=quoted(text);
    if (rgSetJP.test(text) && q){ const lang=pickLangKey(text.match(rgSetJP)[1]||""); ensureLang(spec,lang)[field.key]=q; changes.push(`${lang.toUpperCase()}の${field.key}を「${q}」に`); changed=true; continue; }
    if (rgSetCN.test(text) && q){ const lang=pickLangKey(text.match(rgSetCN)[1]||""); ensureLang(spec,lang)[field.key]=q; changes.push(`${lang.toUpperCase()} ${field.key} を更新`); changed=true; continue; }
    const tailCN=new RegExp(field.cn.source+".*?(?:改成|改为|换成|设置为|设为)\\s*([^。！!\\n]+)","i");
    const m1=text.match(tailCN);
    if (m1){ const lang=pickLangKey(text); const val=m1[1].trim(); ensureLang(spec,lang)[field.key]=val; changes.push(`${lang.toUpperCase()} ${field.key} を更新`); changed=true; }
    const tailJP=new RegExp(field.jp.source+".*?(?:を)?\\s*([^\\s「『]+)\\s*に(?:する|変更|変える|して)","i");
    const m2=text.match(tailJP);
    if (m2 && !q){ const lang=pickLangKey(text); const val=m2[1].trim(); ensureLang(spec,lang)[field.key]=val; changes.push(`${lang.toUpperCase()} ${field.key} を更新`); changed=true; }
  }

  if (/(追加|加上一句|加一行|追記)/i.test(text)){
    const lang=pickLangKey(text); const qv=quoted(text);
    if (qv){ const L=ensureLang(spec,lang); L.note = L.note ? (L.note+" / "+qv) : qv; changes.push(`${lang.toUpperCase()} に一文を追記`); changed=true; }
  }
  return changed;
}

/* 样式编辑 */
function applyStyleEdits(text, spec, changes){
  let changed=false;
  const themeChanged=applyThemeNaturalLanguage(text, changes);
  const bgColorChanged=applyBackgroundColorNaturalLanguage(text, changes);

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
    if (spec.border!=="stripes"){ spec.border="stripes"; changes.push("枠：斜線（リクエストにより）"); changed=true; }
  }
  if (/(无边框|不要边框|枠なし|縁なし)/i.test(text)){ spec.border="none"; changes.push("枠：なし"); changed=true; }
  if (/(边框|框|枠).*(斜纹|斜線|ストライプ)/i.test(text)){ spec.border="stripes"; changes.push("枠：斜線"); changed=true; }
  if (/(边框|框|枠).*(实线|實線|実線|ソリッド)/i.test(text)){ spec.border="solid"; changes.push("枠：実線"); changed=true; }

  let bcMatch =
    text.match(/(斜纹|斜線|ストライプ|枠線|枠).*?(?:颜色|色|カラー|color).*?(?:改成|改为|变成|にして|に変更|にする|で|は|を|に)?\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)/i) ||
    text.match(/(斜纹|斜線|ストライプ|枠線|枠).*?(?:を|は|に|にして|に変更|にする|で|改成|改为|变成)\s*([#A-Za-z0-9一-龥ぁ-んァ-ンー]+)/i);
  if (bcMatch){ const col=resolveColor(bcMatch[2]); if(col){ SETTINGS.borderColorOverride=col; changes.push(`枠（斜線/実線）カラー：${col}`); changed=true; } }
  if (/(斜纹|斜線|ストライプ|枠線|枠).*(リセット|既定|デフォルト|元に戻す|默认|恢复|跟随|連動)/i.test(text)){ SETTINGS.borderColorOverride=null; changes.push("枠色：カテゴリ連動に戻す"); changed=true; }

  if (/(警告|注意|warning)/i.test(text)){ spec.category="warning"; changes.push("カテゴリ：警告"); changed=true; }
  if (/(禁止|不可|prohibition)/i.test(text)){ spec.category="prohibition"; changes.push("カテゴリ：禁止"); changed=true; }
  if (/(指示|必须|必須|mandatory)/i.test(text)){ spec.category="mandatory"; changes.push("カテゴリ：指示"); changed=true; }
  if (/(安全|避難|safe)/i.test(text)){ spec.category="safe"; changes.push("カテゴリ：安全"); changed=true; }
  if (/(防火|fire)/i.test(text)){ spec.category="fire"; changes.push("カテゴリ：防火"); changed=true; }

  if (/(斜纹|斜線|ストライプ).*(粗|太|厚|太く)/i.test(text)){ SETTINGS.ui.stripeWidth=Math.min(50, SETTINGS.ui.stripeWidth+4); changes.push(`斜線の太さ：${SETTINGS.ui.stripeWidth}`); }
  if (/(斜纹|斜線|ストライプ).*(细|薄|細|薄く)/i.test(text)){ SETTINGS.ui.stripeWidth=Math.max(10, SETTINGS.ui.stripeWidth-4); changes.push(`斜線の太さ：${SETTINGS.ui.stripeWidth}`); }
  const gapN=text.match(/(间隔|間隔)\s*([0-9]{1,3})\s*(px|ピクセル)?/i);
  if (gapN){ SETTINGS.ui.stripeGap=Math.max(10, Math.min(60, +gapN[2])); changes.push(`斜線の間隔：${SETTINGS.ui.stripeGap}`); }

  if (/(字号|文字|フォント).*(大|大きく|増や|放大)/i.test(text)){ SETTINGS.ui.fontScale=Math.min(1.5, SETTINGS.ui.fontScale+0.1); changes.push(`フォント倍率：${SETTINGS.ui.fontScale.toFixed(2)}`); }
  if (/(字号|文字|フォント).*(小|小さく|減ら|缩小)/i.test(text)){ SETTINGS.ui.fontScale=Math.max(0.6, SETTINGS.ui.fontScale-0.1); changes.push(`フォント倍率：${SETTINGS.ui.fontScale.toFixed(2)}`); }
  const mag=text.match(/(倍率|スケール|scale)\s*([0-9.]{1,4})/i);
  if (mag){ SETTINGS.ui.fontScale=Math.max(0.6, Math.min(1.5, parseFloat(mag[2]))); changes.push(`フォント倍率：${SETTINGS.ui.fontScale.toFixed(2)}`); }

  if (/(留白|余白|パディング|内側余白).*(多|大|増や|広く)/i.test(text)){ SETTINGS.panel.paddingX+=6; SETTINGS.panel.paddingY+=6; changes.push("面板余白：増"); }
  if (/(留白|余白|パディング|内側余白).*(少|小|減ら|狭く)/i.test(text)){ SETTINGS.panel.paddingX=Math.max(12, SETTINGS.panel.paddingX-6); SETTINGS.panel.paddingY=Math.max(8, SETTINGS.panel.paddingY-6); changes.push("面板余白：減"); }

  const p=paperFromText(text);
  if (p){ SETTINGS.canvas.width=p.w; SETTINGS.canvas.height=p.h; changes.push(`サイズ：${p.name}${p.orient}`); }

  const bandInfo=applyBandNaturalLanguage(text);
  if (bandInfo){
    if (bandInfo.off===true) changes.push("上部の色帯：なし");
    if (bandInfo.off===false) changes.push(`上部の色帯：表示, 高さ${SETTINGS.band.height}px`);
    if (bandInfo.height) changes.push(`上部の色帯 高さ：${SETTINGS.band.height}px`);
    if (bandInfo.color)  changes.push(`上部の色帯 色：${bandInfo.color}`);
    if (bandInfo.follow) changes.push("上部の色帯：カテゴリ連動");
  }
  return changed || !!p || !!bandInfo || !!themeChanged || !!bgColorChanged;
}

/* 编辑意图辅助 */
function applyEditsNaturalLanguage(userText){
  if (!lastSpec) return null;
  const spec=JSON.parse(JSON.stringify(lastSpec));
  const changes=[];
  const textChanged = applyTextEdits(userText, spec, changes);
  const styleChanged= applyStyleEdits(userText, spec, changes);
  if (textChanged || styleChanged){ return { spec, summary: changes }; }
  return null;
}

/* 完成口令 */
const FINALIZE_RE = /(完成(了|啦)?|这张就这样|保存完成|导出完成|结束|结束吧|确定|確定|確定する|完了|完了です|終了|終わり|次へ|下一张|next one|finalize|done|finish|finished)/i;

/* ——边框添加请求 */
function isBorderAddRequest(text){
  return (
    /(枠線|枠|縁|ふち|フチ|ボーダー).*(入れて|入れ|付けて|付け|つけて|つけ|追加|足して|欲しい|ほしい|付与|あり)/i.test(text) ||
    /(加(上)?边框|要边框|加框|需要边框|加邊框)/i.test(text) ||
    /add\s+(a\s+)?(border|frame)/i.test(text)
  );
}

/* =========================
 * 意图引擎（多信号 + 置信度 + 冲突消解）
 * ========================= */
function textHasNewCue(text){
  if (!text) return false;
  if (NEW_VERB_OBJECT_PATTERN.test(text)) return true;
  if (NO_POS_POSTER_RE.test(text)) return true;
  if (NEW_POSTER_WORD.test(text) && NEW_VERB_PHRASES_RE.test(text)) return true;
  return false;
}
function textHasEditCue(text){
  if (!text) return false;
  if (!EDIT_TARGETS_RE.test(text)) return false;           // 没有明确编辑对象 → 不认编辑
  return EDIT_VERBS_RE.test(text) || true;                 // 有对象即可视为编辑候选
}
function topicLooksDifferent(text, lastSpec){
  if (!lastSpec) return false;
  if (!TOPIC_TRIGGER_RE.test(text)) return false;
  const titles = `${lastSpec?.jp?.title||""} ${lastSpec?.en?.title||""} ${lastSpec?.zh?.title||""}`;
  return !TOPIC_TRIGGER_RE.test(titles);
}
function classifyIntent(text, lastSpec){
  const original = text;
  text = norm(text);
  if (FINALIZE_RE.test(text)) return { type:"finalize", reason:"FINALIZE_RE" };
  if (isBorderAddRequest(text)) return { type:"border", reason:"explicit border add" };

  const newScore  = textHasNewCue(text)  ? 2 : 0;
  const editScore = textHasEditCue(text) ? 2 : 0;
  const posterAndTopic = NEW_POSTER_WORD.test(text) && TOPIC_TRIGGER_RE.test(text);
  const newBias = posterAndTopic || topicLooksDifferent(text, lastSpec) ? 1 : 0;
  const totalNew = newScore + newBias, totalEdit = editScore;

  const hasEditTarget = EDIT_TARGETS_RE.test(text);
  const strongNewPhrase = NEW_VERB_OBJECT_PATTERN.test(text) ||
                          (NEW_POSTER_WORD.test(text) && NEW_VERB_PHRASES_RE.test(text)) ||
                          NO_POS_POSTER_RE.test(text);

  let result;
  if (totalNew === 0 && totalEdit === 0){
    result = topicLooksDifferent(text, lastSpec) ? { type:"new", reason:"topic different" } : { type:"unknown", reason:"no cues" };
  } else if (totalNew > totalEdit){
    result = { type:"new", reason:`newScore=${totalNew} > editScore=${totalEdit}` };
  } else if (totalEdit > totalNew){
    result = { type:"edit", reason:`editScore=${totalEdit} > newScore=${totalNew}` };
  } else {
    if (hasEditTarget && !strongNewPhrase) result = { type:"edit", reason:"tie; has edit target" };
    else if (strongNewPhrase) result = { type:"new", reason:"tie; strong new phrase" };
    else result = (!lastSpec) ? { type:"new", reason:"tie; no last poster" } : { type:"edit", reason:"tie; default to edit" };
  }

  debugMaybeLogIntent({
    text: original, norm: text, res: result.type, reason: result.reason,
    scores: { new: totalNew, edit: totalEdit }, flags: { hasEditTarget, strongNewPhrase, posterAndTopic }
  });
  return result;
}
// 兼容旧 API
function looksLikeEdit(text){ return classifyIntent(text, lastSpec).type === "edit"; }
function isNewPosterRequest(text, lastSpec){ return classifyIntent(text, lastSpec).type === "new"; }

/* =========================
 * 友好的系统回复
 * ========================= */
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
  return `了解しました。内容に合わせてレイアウトを最適化しました。
- ${bits.join("\n- ")}
- スタイル：${catMap[spec.category]||spec.category}、枠は「${spec.border==="stripes"?"斜線":"実線"}」
- 用紙サイズ：${sizeTxt}
- ${bandTxt}
右上のギアでフォント倍率・行間・斜線の太さ/間隔を調整できます。
${COLOR_SCOPE_NOTE}`;
}
function formatEditReply(changes){
  if (!changes || !changes.length) return "ご指定の修正内容を確認しました（変更はありませんでした）。別の指示もどうぞ。\n" + COLOR_SCOPE_NOTE;
  return "承知しました。次の点を反映してポスターを更新しました：\n- " + changes.join("\n- ") + "\n" + COLOR_SCOPE_NOTE;
}

/* 重置为初始 */
function resetRuntimeSettings(){
  CURRENT_THEME  = sc(DEFAULT_THEME);
  SETTINGS.colors= sc(DEFAULT_COLORS);
  SETTINGS.borderColorOverride=null;
  SETTINGS.band.height=160; SETTINGS.band.followCategory=true; SETTINGS.band.colorOverride=null;
  SETTINGS.ui.fontScale=1.0; SETTINGS.ui.paragraphSpacing=14; SETTINGS.ui.stripeWidth=22; SETTINGS.ui.stripeGap=28;
  SETTINGS.panel.paddingX=42; SETTINGS.panel.paddingY=30; SETTINGS.panel.radius=18; SETTINGS.panel.marginX=40; SETTINGS.panel.marginY=24; SETTINGS.panel.shadow=true;
  SETTINGS.solidBorderWidth=14;
  SETTINGS.canvas.width=1404; SETTINGS.canvas.height=993;
}

/* JSON 解析 */
function parseJSONLoose(t){ if(!t) return null; const m=t.match(/```(?:json)?\s*([\s\S]*?)```/i); const body=m?m[1]:t; try{return JSON.parse(body);}catch{return null;} }

/* 生成流程（含意图引擎） */
async function generatePoster(userText){
  const text = norm(userText);
  const intent = classifyIntent(text, lastSpec);

  if (intent.type === "finalize") {
    resetRuntimeSettings();
    addMsg("bot", "ポスターの仕上げを確認しました。設定を初期状態に戻しました。次回の新規作成は既定から開始します。");
    startNewSession("finalize");
    return;
  }

  if (intent.type === "border") {
    if (lastSpec) {
      const spec = JSON.parse(JSON.stringify(lastSpec));
      const had = !!spec.border && spec.border !== "none";
      if (!had) spec.border = "solid";
      drawPoster(spec);
      addMsg("bot", had
        ? "すでに枠線があります。種類を変える場合は「枠を斜線に / 枠を実線に」と指示してください。\n" + COLOR_SCOPE_NOTE
        : "了解しました。既存のポスターに枠線（実線）を追加しました。\n" + COLOR_SCOPE_NOTE
      );
      return;
    } else {
      const spec = { jp:{title:"通行注意", subtitle:"走行車両あり"}, en:{subtitle:"Watch for vehicles"}, zh:{note:"行人应小心行驶车辆"}, category:"warning", border:"solid", size:"A3横" };
      drawPoster(spec);
      addMsg("bot","ポスターを作成し、枠線（実線）を適用しました。\n" + COLOR_SCOPE_NOTE);
      return;
    }
  }

  if (intent.type === "edit" && lastSpec) {
    const edited = applyEditsNaturalLanguage(text);
    if (edited){ addMsg("bot", formatEditReply(edited.summary)); drawPoster(edited.spec); }
    else { addMsg("bot", formatEditReply([])); }
    return;
  }

  if (intent.type === "new" || (!lastSpec && intent.type === "unknown") || isNewPosterRequest(text, lastSpec)) {
    resetRuntimeSettings();
    if (lastSpec) addMsg("bot", "前のポスターを完了として扱い、設定を初期状態に戻しました。新しい内容で作成します。");
    startNewSession("new");
  }

  // —— 新建生成（LLM可用则用，随后叠加预设/尺寸/配色）——
  let data;
  if (engine) {
    const reply = await engine.chat.completions.create({
      messages: [{ role:"system", content: SYSTEM_PROMPT }, { role:"user", content: text }],
      max_tokens: 500
    });
    data = parseJSONLoose(reply.choices?.[0]?.message?.content || "");
  }

  applyThemeNaturalLanguage(text);
  applyBackgroundColorNaturalLanguage(text);
  const sizeInfo = applyCanvasSizeBySpec(data?.size, text);
  const bandInfo = applyBandNaturalLanguage(text);

  const preset = matchPreset(text);
  if (preset) data = mergeWithPreset(data, preset);

  if (/(体温|検温|測温|测温|temperature\s*check|health\s*check|注意身体|体調|体调|发烧|fever)/i.test(text)) {
    data = data || {}; data.category="mandatory"; data.border = data.border || "stripes";
  }
  if (/(非常口|emergency\s*exit|避難口)/i.test(text)) {
    data = data || {}; data.category="safe"; data.border = data.border || "solid";
    data.jp = data.jp || {}; data.jp.title = data.jp.title || "非常口"; data.jp.subtitle = data.jp.subtitle || "前に物を置かない";
    data.en = data.en || {}; data.en.title = data.en.title || "Emergency exit"; data.en.subtitle = data.en.subtitle || "Do not place items here";
    data.zh = data.zh || {}; data.zh.note = data.zh.note || "紧急出口前禁止放置物品";
  }
  if (/(衝突事故|衝突|冲突|collision|接触事故|ぶつかり)/i.test(text)) {
    data = data || {}; data.category="warning"; data.border = data.border || "stripes";
    data.jp = data.jp || {}; data.jp.title = data.jp.title || "衝突注意";
  }
  if (/(仮置き|临时放置|temporary\s*placement)/i.test(text)) {
    data = data || {}; data.category="prohibition"; data.border = data.border || "stripes";
    data.jp = data.jp || {}; data.jp.title = data.jp.title || "仮置き禁止"; data.jp.subtitle = data.jp.subtitle || "通路・ラインを確保";
  }

  if (!data) {
    data = { jp:{title:"通行注意", subtitle:"走行車両あり"}, en:{subtitle:"Watch for vehicles"}, zh:{note:"行人应小心行驶车辆"}, category:"warning", border:"stripes", size:"A3横", icon:"forklift" };
  }

  const spec = {
    jp: data.jp || {}, en: data.en || {}, zh: data.zh || {},
    category: (["warning","prohibition","mandatory","safe","fire","neutral"].includes(data.category) ? data.category : "warning"),
    border: (["stripes","solid","none"].includes(data.border) ? data.border : "stripes"),
    size: data.size || "A3横", icon: data.icon || ""
  };

  addMsg("bot", formatBotReply(spec, sizeInfo, bandInfo));
  drawPoster(spec);
}

/* =========================
 * 控制面板（右上齿轮；加大按钮）
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
 * 指令履历（增强）+ 左上按钮避开标题
 * ========================= */
const HISTORY_KEY = "poster_history_v1";
const MAX_HISTORY = 200;
let USER_HISTORY = []; let CURRENT_SESSION_ID = 1;

function loadHistory(){ try{ const raw=localStorage.getItem(HISTORY_KEY); if(!raw) return; const o=JSON.parse(raw); if(Array.isArray(o.items)) USER_HISTORY=o.items; if (typeof o.sessionLast==="number") CURRENT_SESSION_ID=Math.max(1,o.sessionLast); }catch{} }
function saveHistory(){ try{ localStorage.setItem(HISTORY_KEY, JSON.stringify({ items: USER_HISTORY.slice(0,MAX_HISTORY), sessionLast: CURRENT_SESSION_ID })); }catch{} }
function startNewSession(){ CURRENT_SESSION_ID += 1; saveHistory(); }
function classifyCommand(text){ if (!lastSpec) return "新規"; if (isNewPosterRequest(text, lastSpec)) return "新規"; if (looksLikeEdit(text)) return "編集"; return "生成"; }
function timeLabel(ms){ const d=new Date(ms); const two=n=>n<10?"0"+n:n; return `${two(d.getHours())}:${two(d.getMinutes())}`; }
function pushHistory(text){
  const item={ id:Date.now()+Math.random(), text, kind:classifyCommand(text), timeMs:Date.now(), target:(lastSpec?.jp?.title||lastSpec?.en?.title||lastSpec?.zh?.title||"—"), sessionId:CURRENT_SESSION_ID, pinned:false };
  USER_HISTORY.unshift(item);
  const pinned=USER_HISTORY.filter(x=>x.pinned);
  const normal=USER_HISTORY.filter(x=>!x.pinned).slice(0, MAX_HISTORY - pinned.length);
  USER_HISTORY=[...pinned, ...normal];
  saveHistory(); renderHistory && renderHistory();
}

function createHistoryPanelEnhanced(){
  loadHistory();
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
    width: 340px; max-height: 80vh; padding: 12px; border-radius: 12px;
    background: rgba(255,255,255,.98); border: 1px solid #e6e8eb;
    font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans JP", sans-serif;
    box-shadow: 0 10px 24px rgba(0,0,0,.12); display: none;
  `;
  wrap.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <strong style="font-size:14px;">指令履歴</strong>
      <div style="display:flex;gap:6px;align-items:center;">
        <span id="hist-sess" style="font-size:11px;color:#6b7280;">セッション: <b id="hist-sess-id"></b></span>
        <button id="hist-export" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;cursor:pointer;">エクスポート</button>
        <button id="hist-clear"  style="padding:6px 10px;border:1px solid #fee2e2;border-radius:8px;background:#fff1f2;color:#b91c1c;cursor:pointer;">クリア</button>
        <button id="hist-close"  style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;background:#f3f4f6;cursor:pointer;">✕</button>
      </div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
      <input id="hist-q" placeholder="検索（例：背景 / 斜線 / 黄色）" 
             style="flex:1 1 auto;padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;">
    </div>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
      <button data-filter="all" class="hist-tab hist-on">全部</button>
      <button data-filter="session" class="hist-tab">当前会话</button>
      <button data-filter="new" class="hist-tab">新規</button>
      <button data-filter="edit" class="hist-tab">編集</button>
      <style>
        .hist-tab{padding:6px 10px;border:1px solid #e5e7eb;border-radius:999px;background:#fff;cursor:pointer;font-size:12px;}
        .hist-on{background:#0ea5e9;color:#fff;border-color:#0ea5e9;}
        .hist-pin{color:#f59e0b;margin-left:6px;cursor:pointer;}
        .hist-btn{padding:4px 8px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;cursor:pointer;font-size:12px;}
        .hist-btn-danger{border-color:#fecaca;background:#fff1f2;color:#b91c1c;}
        .hist-row{border:1px solid #e5e7eb;border-radius:10px;padding:8px 10px;margin-bottom:8px;background:#fff;display:flex;gap:8px;align-items:flex-start;justify-content:space-between;}
        .hist-kind{display:inline-block;padding:2px 8px;margin-right:6px;border-radius:999px;border:1px solid; font-weight:600;font-size:11px;}
        .hist-kind-new{background:#ecfdf5;color:#065f46;border-color:#a7f3d0;}
        .hist-kind-edit{background:#eff6ff;color:#1e40af;border-color:#bfdbfe;}
        .hist-kind-gen{background:#f3f4f6;color:#374151;border-color:#e5e7eb;}
        .hist-text{font-size:13px;color:#111827;margin-top:4px;word-break:break-word;}
        .hist-meta{font-size:11px;color:#6b7280;margin-top:4px;}
      </style>
    </div>
    <div id="hist-list" style="overflow:auto; max-height: calc(80vh - 180px);"></div>
  `;
  document.body.appendChild(wrap);

  // —— 避开标题区域：动态下移按钮与面板 ——
  function computeHistoryOffsets(){
    const header = document.querySelector("header, .header, .app-header, #header, [role='banner']");
    const title  = document.querySelector(".title, .app-title, h1");
    let safeTop = 72;
    if (header){ const r=header.getBoundingClientRect(); safeTop=Math.max(safeTop, r.bottom+12); }
    else if (title){ const r=title.getBoundingClientRect(); safeTop=Math.max(safeTop, r.bottom+12); }
    btn.style.top  = safeTop + "px";
    wrap.style.top = (safeTop + 68) + "px";
  }
  computeHistoryOffsets();
  window.addEventListener("resize", computeHistoryOffsets);
  setTimeout(computeHistoryOffsets, 0);
  const hdr = document.querySelector("header, .header, .app-header, #header, [role='banner']");
  if (hdr && "ResizeObserver" in window){ const ro=new ResizeObserver(()=>computeHistoryOffsets()); ro.observe(hdr); }

  const listEl = wrap.querySelector("#hist-list");
  const qEl    = wrap.querySelector("#hist-q");
  const sessIdEl = wrap.querySelector("#hist-sess-id");
  const tabs = wrap.querySelectorAll(".hist-tab");
  function setSessLabel(){ sessIdEl.textContent = `#${CURRENT_SESSION_ID}`; }
  function activeFilter(){ const a=[...tabs].find(b=>b.classList.contains("hist-on")); return a?.dataset?.filter || "all"; }
  tabs.forEach(b=> b.onclick = ()=>{ tabs.forEach(x=>x.classList.remove("hist-on")); b.classList.add("hist-on"); renderHistory(); });
  qEl.addEventListener("input", ()=> renderHistory());

  window.renderHistory = function renderHistory(){
    setSessLabel();
    const q=qEl.value.trim().toLowerCase(), filter=activeFilter();
    const items=USER_HISTORY.slice().sort((a,b)=>(b.pinned-a.pinned)||(b.timeMs-a.timeMs)).filter(it=>{
      if (filter==="session" && it.sessionId!==CURRENT_SESSION_ID) return false;
      if (filter==="new"     && it.kind!=="新規") return false;
      if (filter==="edit"    && it.kind!=="編集") return false;
      if (q && !(`${it.text} ${it.target}`.toLowerCase().includes(q))) return false;
      return true;
    });
    listEl.innerHTML="";
    items.forEach(item=>{
      const row=document.createElement("div"); row.className="hist-row";
      const left=document.createElement("div"); left.style.cssText="flex:1 1 auto; min-width:0;";
      const right=document.createElement("div"); right.style.cssText="display:flex; flex-direction:column; gap:6px;";

      const kind=document.createElement("span");
      kind.className="hist-kind "+(item.kind==="新規"?"hist-kind-new":item.kind==="編集"?"hist-kind-edit":"hist-kind-gen");
      kind.textContent=item.kind;

      const pin=document.createElement("span"); pin.className="hist-pin"; pin.title=item.pinned?"取消固定":"固定到顶部"; pin.textContent=item.pinned?"★":"☆";
      pin.onclick=()=>{ item.pinned=!item.pinned; saveHistory(); renderHistory(); };

      const time=document.createElement("span"); time.textContent=` ${timeLabel(item.timeMs)} ・S#${item.sessionId}`; time.style.cssText="font-size:11px;color:#6b7280;margin-left:4px;";

      const txt=document.createElement("div"); txt.className="hist-text"; txt.textContent=item.text; txt.title="クリックで入力欄に挿入"; txt.style.cursor="text";
      txt.onclick=()=>{ promptEl.value=item.text; promptEl.focus(); };

      const tgt=document.createElement("div"); tgt.className="hist-meta"; tgt.textContent=item.target?`対象：${item.target}`:"対象：—";

      left.appendChild(kind); left.appendChild(pin); left.appendChild(time); left.appendChild(txt); left.appendChild(tgt);

      const btnApply=document.createElement("button"); btnApply.className="hist-btn"; btnApply.textContent="適用"; btnApply.onclick=()=> generatePoster(item.text);
      const btnCopy=document.createElement("button"); btnCopy.className="hist-btn"; btnCopy.textContent="コピー"; btnCopy.onclick=async()=>{ try{ await navigator.clipboard.writeText(item.text); btnCopy.textContent="✓ コピー"; setTimeout(()=>btnCopy.textContent="コピー",900);}catch{} };
      const btnDel=document.createElement("button"); btnDel.className="hist-btn hist-btn-danger"; btnDel.textContent="削除"; btnDel.onclick=()=>{ USER_HISTORY=USER_HISTORY.filter(x=>x.id!==item.id); saveHistory(); renderHistory(); };

      right.appendChild(btnApply); right.appendChild(btnCopy); right.appendChild(btnDel);
      row.appendChild(left); row.appendChild(right); listEl.appendChild(row);
    });
    if (!items.length){ const empty=document.createElement("div"); empty.style.cssText="padding:10px;color:#6b7280;font-size:12px;border:1px dashed #e5e7eb;border-radius:10px;text-align:center;"; empty.textContent="該当する履歴はありません。"; listEl.appendChild(empty); }
  };

  btn.onclick=()=>{ wrap.style.display = (wrap.style.display==="none" ? "block":"none"); renderHistory(); };
  wrap.querySelector("#hist-close").onclick=()=> wrap.style.display="none";
  wrap.querySelector("#hist-clear").onclick=()=>{ if(!confirm("履歴をすべて削除しますか？")) return; USER_HISTORY.length=0; saveHistory(); renderHistory(); };
  wrap.querySelector("#hist-export").onclick=()=>{
    const lines=USER_HISTORY.slice().sort((a,b)=>a.timeMs-b.timeMs).map(h=>`[${new Date(h.timeMs).toLocaleString()}]\tS#${h.sessionId}\t${h.kind}\t${h.text}`);
    const blob=new Blob([lines.join("\n")],{type:"text/plain;charset=utf-8"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download="指令履歴.txt"; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 500);
  };
  renderHistory();
}
createHistoryPanelEnhanced();

/* =========================
 * 输入/下载/键盘（IME 友好）
 * ========================= */
let composing=false;
promptEl.addEventListener("compositionstart", ()=> composing=true);
promptEl.addEventListener("compositionend",   ()=> composing=false);
promptEl.addEventListener("keydown", e => {
  if (e.key==="Enter"){ if (e.isComposing || composing) return; if (e.shiftKey) return; e.preventDefault(); sendBtn.click(); }
});
sendBtn.onclick=()=>{ const t=promptEl.value.trim(); if (t){ addMsg("user", t); pushHistory(t); generatePoster(t); } promptEl.value=""; };
dlBtn.onclick=()=>{
  const url=canvas.toDataURL("image/png");
  const a=document.createElement("a"); a.href=url; a.download="poster.png"; a.click();
  resetRuntimeSettings();
  addMsg("bot","書き出しが完了しました。設定を初期状態に戻しました。次のポスターは既定の配色・サイズから始まります。");
  startNewSession("export");
};

/* =========================
 * 调试回归套件（在控制台运行）
 * ========================= */
window.__debug_intent_tests = function(){
  const cases = [
    // —— 新建 —— 
    "非常口のポスターを作って欲しい",
    "ポスターを作成してください",
    "安全第一のポスター",
    "请生成一张关于衝突的海报",
    "make a poster about emergency exit",
    "仮置きのポスターお願いします",
    "collision poster please",
    "フォークリフトのポスター",
    // —— 编辑 —— 
    "背景色は黄色にしたい",
    "斜線を黄色に",
    "枠線を実線にして",
    "A4縦にして",
    "白い部分は黒に",
    "上部の色帯はカテゴリ連動に戻す",
    // —— 边框追加 —— 
    "枠線を入れてほしい",
    // —— 完成 —— 
    "これで完了です",
    // —— 干扰：应判新建 —— 
    "非常口のポスターを修正… は編集だけど → 直す/修正/編集 を含む場合不触发このルール",
  ];
  console.table(cases.map(t=>{
    const r=classifyIntent(t, lastSpec);
    return { text:t, type:r.type, reason:r.reason };
  }));
};
window.__debug_dumpLogs   = debugExportLogs;
window.__debug_clearLogs  = debugClearLogs;
window.__debug_toggle     = ()=> debugSet(!DEBUG.on);

/* =========================
 * 初始显示（斜线为既定）
 * ========================= */
drawPoster({
  jp: { title: "安全第一", subtitle: "指差呼称・周囲確認・事故ゼロへ" },
  en: { subtitle: "Safety First" },
  zh: { note: "安全第一，谨慎作业" },
  category: "warning",
  border: "stripes",
  size: "A3横"
});
