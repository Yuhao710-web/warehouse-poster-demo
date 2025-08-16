// ========== 1) WebLLM (zero-cost) ==========
let engine;
(async () => {
  try{
    engine = await webllm.CreateWebWorkerEngine(
      new Worker("https://unpkg.com/@mlc-ai/web-llm/dist/worker.js", { type:"module" }),
      { model:"Llama-3.2-1B-Instruct-q4f32_1-MLC" }
    );
  }catch(e){
    console.warn("WebLLM init failed:", e);
    addMsg("assistant", "（お知らせ）AI自動生成が無効の可能性があります。手動でも調整できます。");
  }
})();

// ========== 2) UI refs ==========
const messagesEl = document.getElementById("messages");
const promptEl   = document.getElementById("prompt");
const sendBtn    = document.getElementById("send");
const tplSel     = document.getElementById("template");
const sizeSel    = document.getElementById("size");
const hiResCb    = document.getElementById("hires");
const canvas     = document.getElementById("poster");
const ctx        = canvas.getContext("2d");
const dlBtn      = document.getElementById("download");

// quickbar
document.querySelectorAll('.qbtn').forEach(b=>{
  b.addEventListener('click', ()=>generatePoster(b.dataset.q));
});

function addMsg(role, text){
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "user" : "bot");
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ========== 3) Safety palettes & helpers ==========
const SAFETY = {
  warning:    { label:"警告",       base:"#F9A900", glyph:"#111111" },
  prohibition:{ label:"禁止",       base:"#C62828", glyph:"#111111" },
  mandatory:  { label:"指示",       base:"#005387", glyph:"#FFFFFF" },
  safe:       { label:"避難/安全",  base:"#237F52", glyph:"#FFFFFF" },
  fire:       { label:"消防",       base:"#C62828", glyph:"#FFFFFF" },
  neutral:    { label:"情報",       base:"#2B2B2C", glyph:"#FFFFFF" }
};

const ICON_MAP = {
  "フォークリフト":"forklift",
  "立入禁止":"block",
  "感電":"bolt",
  "消火器":"fire_extinguisher",
  "避難口":"emergency_home",
  "ヘルメット":"hard_hat",
  "転倒":"report_problem",
  "歩行者":"signpost",
  "注意":"warning"
};
function iconLigature(name){ return ICON_MAP[name] || "warning"; }

const SYSTEM_PROMPT = `あなたは倉庫安全ポスターのコピーライター兼デザイナーです。出力は必ず次のJSONだけ：
{"title":"...","subtitle":"...","category":"warning|prohibition|mandatory|safe|fire|neutral","icon":"フォークリフト|立入禁止|ヘルメット|消火器|避難口|感電|転倒|歩行者|注意","size":"A3横|A3縦","en":"英語の短文(空でも可)","extra":"ベトナム語などの短文(空でも可)"}
ルール：
- 倉庫の安全目的を最優先。文は日本語、太い見出し＋20〜40字の補足。
- 可能なら英語/他言語も簡潔に。曖昧なら "neutral"。`;

// colors util
function hexToRgb(hex){ const s=hex.replace('#',''); const n=parseInt(s,16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; }
function rgbToHex(r,g,b){ const h=x=>x.toString(16).padStart(2,'0'); return `#${h(r)}${h(g)}${h(b)}`; }
function tint(hex, amt){ const {r,g,b}=hexToRgb(hex); const t=v=>Math.max(0,Math.min(255,Math.round(v + (255-v)*amt))); return rgbToHex(t(r),t(g),t(b)); }

// repeated stripe pattern
function stripePattern(color, bg="#fff"){
  const p = document.createElement('canvas'); p.width=80; p.height=80;
  const pc = p.getContext('2d');
  pc.fillStyle = bg; pc.fillRect(0,0,80,80);
  pc.save(); pc.translate(0,40); pc.rotate(-Math.PI/4);
  pc.strokeStyle = color; pc.lineWidth = 20;
  for(let x=-200;x<=200;x+=40){ pc.beginPath(); pc.moveTo(x,-200); pc.lineTo(x,200); pc.stroke(); }
  pc.restore();
  return ctx.createPattern(p, 'repeat');
}

// dpi & size
function setCanvasSize(size, hiRes){
  const dpi = hiRes ? 200 : 150;
  const W = Math.round((420/25.4)*dpi);
  const H = Math.round((297/25.4)*dpi);
  const landscape = (size||"A3横").includes("横");
  canvas.width  = landscape ? W : H;
  canvas.height = landscape ? H : W;
}

// rounded rect
function roundRect(c, x,y,w,h,r, fill=true, stroke=false){
  c.beginPath();
  c.moveTo(x+r, y);
  c.arcTo(x+w, y, x+w, y+h, r);
  c.arcTo(x+w, y+h, x, y+h, r);
  c.arcTo(x, y+h, x, y, r);
  c.arcTo(x, y, x+w, y, r);
  c.closePath();
  if(fill) c.fill();
  if(stroke) c.stroke();
}

// wrap (Japanese: char-wise)
function wrap(c, text, x, y, maxW, lh){
  const chars = (text||"").split(""); let line="", yy=y;
  for(let i=0;i<chars.length;i++){
    const t = line + chars[i];
    if(c.measureText(t).width > maxW && line){ c.fillText(line, x, yy); line = chars[i]; yy += lh; }
    else{ line = t; }
  }
  if(line) c.fillText(line, x, yy);
}

// ========== 4) Templates ==========
// 4.1 yellow caution with black diagonal border
function drawCaution(spec){
  const pal = SAFETY.warning;
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  // inner rect
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;
  // fill yellow
  ctx.fillStyle = tint(pal.base, 0.2); roundRect(ctx,x,y,w,h,22,true,false);
  // border stripes
  ctx.save();
  ctx.strokeStyle = "#000"; ctx.lineWidth = 16; roundRect(ctx,x+8,y+8,w-16,h-16,18,false,true);
  ctx.fillStyle = stripePattern("#000", tint(pal.base, 0.2));
  ctx.globalAlpha = 0.16; roundRect(ctx,x+12,y+12,w-24,h-24,16,true,false);
  ctx.restore();

  // big title (JP)
  ctx.fillStyle = "#111"; ctx.font = `800 ${Math.round(h*0.13)}px 'Noto Sans JP'`;
  wrap(ctx, spec.title || "通行注意", x+40, y+Math.round(h*0.18), w-80, Math.round(h*0.15));

  // sub jp
  ctx.fillStyle = "#111"; ctx.font = `700 ${Math.round(h*0.07)}px 'Noto Sans JP'`;
  wrap(ctx, spec.subtitle || "走行車両あり。行人は十分注意。", x+40, y+Math.round(h*0.38), w-80, Math.round(h*0.09));

  // EN & extra
  ctx.fillStyle = "#222"; ctx.font = `600 ${Math.round(h*0.06)}px 'Noto Sans JP'`;
  if(spec.en) wrap(ctx, spec.en, x+40, y+Math.round(h*0.54), w-80, Math.round(h*0.08));
  if(spec.extra) { ctx.fillStyle="#333"; ctx.font = `600 ${Math.round(h*0.05)}px 'Noto Sans JP'`; wrap(ctx, spec.extra, x+40, y+Math.round(h*0.66), w-80, Math.round(h*0.07)); }
}

// 4.2 red prohibition with white stripe border
function drawProhibit(spec){
  const pal = SAFETY.prohibition;
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  ctx.fillStyle = pal.base; roundRect(ctx,x,y,w,h,22,true,false);
  ctx.save();
  ctx.fillStyle = stripePattern("#fff", pal.base);
  ctx.globalAlpha = 0.25; roundRect(ctx,x+14,y+14,w-28,h-28,18,true,false);
  ctx.restore();

  ctx.fillStyle = "#fff"; ctx.font = `800 ${Math.round(h*0.13)}px 'Noto Sans JP'`;
  wrap(ctx, spec.title || "仮置き禁止", x+40, y+Math.round(h*0.18), w-80, Math.round(h*0.15));
  ctx.fillStyle = "#fff"; ctx.font = `600 ${Math.round(h*0.06)}px 'Noto Sans JP'`;
  wrap(ctx, spec.subtitle || "シャッターライン内に物を置かないでください。", x+40, y+Math.round(h*0.36), w-80, Math.round(h*0.08));
  if(spec.en){ wrap(ctx, spec.en, x+40, y+Math.round(h*0.50), w-80, Math.round(h*0.07)); }
  if(spec.extra){ ctx.font = `600 ${Math.round(h*0.05)}px 'Noto Sans JP'`; wrap(ctx, spec.extra, x+40, y+Math.round(h*0.60), w-80, Math.round(h*0.06)); }
}

// 4.3 stop triangle on white board with orange stripes
function drawStop(spec){
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  // orange stripe border
  ctx.save();
  ctx.fillStyle = stripePattern("#ff7a00", "#fff");
  ctx.globalAlpha = 0.35;
  roundRect(ctx,x,y,w,h,22,true,false);
  ctx.restore();
  ctx.strokeStyle="#ddd"; ctx.lineWidth=6; roundRect(ctx,x+4,y+4,w-8,h-8,20,false,true);

  // red inverted triangle
  const side = Math.min(w,h)*0.36;
  const cx = x + w*0.30, cy = y + h*0.38;
  ctx.fillStyle = "#d32f2f";
  ctx.beginPath();
  ctx.moveTo(cx, cy - side/1.7);
  ctx.lineTo(cx - side/1.2, cy + side/1.7);
  ctx.lineTo(cx + side/1.2, cy + side/1.7);
  ctx.closePath(); ctx.fill();

  // text
  ctx.fillStyle="#d32f2f"; ctx.font = `800 ${Math.round(h*0.12)}px 'Noto Sans JP'`;
  ctx.fillText("止まれ", cx - side*0.7, y + h*0.18);
  ctx.fillStyle="#d32f2f"; ctx.font = `600 ${Math.round(h*0.06)}px 'Noto Sans JP'`;
  ctx.fillText("停止", cx - side*0.7, y + h*0.28);
  ctx.fillText(spec.en || "Stop", cx - side*0.7, y + h*0.36);

  // small caption right
  ctx.fillStyle="#333"; ctx.font=`600 ${Math.round(h*0.06)}px 'Noto Sans JP'`;
  wrap(ctx, spec.subtitle || "一時停止", x + w*0.6, y + h*0.40, w*0.35, Math.round(h*0.08));
}

// 4.4 green exit header
function drawExit(spec){
  const pal = SAFETY.safe;
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.05);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  ctx.fillStyle = pal.base; roundRect(ctx,x,y,w,h,26,true,false);

  // top white header
  const hh = Math.round(h*0.22);
  ctx.fillStyle="#fff"; roundRect(ctx,x+10,y+10,w-20,hh,16,true,false);

  // pictogram at header
  ctx.fillStyle=pal.base; ctx.font = `${Math.round(hh*0.8)}px 'Material Symbols Outlined'`;
  ctx.textAlign="left"; ctx.textBaseline="middle";
  ctx.fillText(iconLigature("避難口"), x+24, y+hh/2+6);

  // header JP title
  ctx.fillStyle="#111"; ctx.font = `800 ${Math.round(hh*0.42)}px 'Noto Sans JP'`;
  ctx.fillText(spec.title || "非常口", x+hh, y+hh/2+10);

  // body white text
  ctx.fillStyle="#fff"; ctx.font = `700 ${Math.round(h*0.09)}px 'Noto Sans JP'`;
  wrap(ctx, spec.subtitle || "前に物を置かない", x+30, y+hh+60, w-60, Math.round(h*0.1));

  ctx.fillStyle="#e8f5ec"; ctx.font = `600 ${Math.round(h*0.06)}px 'Noto Sans JP'`;
  if(spec.en) wrap(ctx, spec.en, x+30, y+hh+140, w-60, Math.round(h*0.08));
  if(spec.extra) wrap(ctx, spec.extra, x+30, y+hh+200, w-60, Math.round(h*0.07));
}

// 4.5 blue info/“置場” panel
function drawBlue(spec){
  const pal = SAFETY.mandatory;
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  // outer rounded white board + inner blue panel
  ctx.fillStyle="#fff"; roundRect(ctx,x,y,w,h,28,true,false);
  ctx.strokeStyle="#cfd8e1"; ctx.lineWidth=6; roundRect(ctx,x+4,y+4,w-8,h-8,24,false,true);

  const bx=x+24, by=y+24, bw=w-48, bh=h-48;
  ctx.fillStyle = tint(pal.base,0.05); roundRect(ctx,bx,by,bw,bh,22,true,false);
  ctx.strokeStyle = pal.base; ctx.lineWidth = 16; roundRect(ctx,bx+12,by+12,bw-24,bh-24,16,false,true);

  // big icon left
  const cardW = Math.min(bw*0.33, 520);
  ctx.fillStyle = pal.base;
  ctx.font = `${Math.round(bh*0.48)}px 'Material Symbols Outlined'`;
  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(iconLigature(spec.icon || "歩行者"), bx + cardW/2, by + bh/2);

  // text right
  const tx = bx + cardW + 40, maxW = bw - cardW - 60;
  ctx.fillStyle = pal.base;
  ctx.font = `800 ${Math.round(bh*0.22)}px 'Noto Sans JP'`;
  wrap(ctx, spec.title || "歩行者通路", tx, by + Math.round(bh*0.20), maxW, Math.round(bh*0.24));

  ctx.fillStyle = "#2b2f38"; ctx.font = `600 ${Math.round(bh*0.10)}px 'Noto Sans JP'`;
  wrap(ctx, spec.en || "Pedestrian way", tx, by + Math.round(bh*0.55), maxW, Math.round(bh*0.12));

  if(spec.extra){
    ctx.fillStyle = "#445"; ctx.font = `600 ${Math.round(bh*0.08)}px 'Noto Sans JP'`;
    wrap(ctx, spec.extra, tx, by + Math.round(bh*0.70), maxW, Math.round(bh*0.1));
  }
}

// ========== 5) Auto template routing ==========
function pickTemplateFromText(text, category){
  const t = text || "";
  if(/止まれ|一時停止|stop/i.test(t)) return "stop";
  if(/仮置|禁止|立入禁止/.test(t) || category==="prohibition") return "prohibit";
  if(/非常口|避難口|exit/i.test(t) || category==="safe") return "exit";
  if(/歩行者|通路|置場|station|way/i.test(t) || category==="mandatory") return "blue";
  if(/注意|通行注意|衝突|安全走行/.test(t) || category==="warning") return "caution";
  return "caution";
}

// ========== 6) Main generate & render ==========
async function generatePoster(userText){
  addMsg("user", userText);
  const size = sizeSel.value || "A3横";
  const hiRes = !!hiResCb.checked;
  const chosenTpl = tplSel.value;

  setCanvasSize(size, hiRes);

  let spec = {};
  if(engine){
    try{
      const reply = await engine.chat.completions.create({
        messages: [
          { role:"system", content: SYSTEM_PROMPT },
          { role:"user", content: `${userText}\nサイズ:${size}` }
        ],
        temperature: 0.2, max_tokens: 320, stream: false,
      });
      spec = JSON.parse(reply.choices[0].message.content);
    }catch(e){ console.warn(e); }
  }
  if(!spec.title){
    spec = { title:"通行注意", subtitle:"走行車両あり。周囲確認を徹底。", category:"warning", icon:"注意", en:"Watch for vehicles", extra:"" };
  }

  const tpl = (chosenTpl==="auto") ? pickTemplateFromText(userText, spec.category) : chosenTpl;
  addMsg("assistant", `スタイル：${tpl} / タイトル：${spec.title} / 追加言語：${(spec.en||"") + (spec.extra? " / "+spec.extra:"")}`);

  if(tpl==="caution") drawCaution(spec);
  else if(tpl==="prohibit") drawProhibit(spec);
  else if(tpl==="stop") drawStop(spec);
  else if(tpl==="exit") drawExit(spec);
  else if(tpl==="blue") drawBlue(spec);
  else drawCaution(spec);
}

// events
sendBtn.onclick = ()=>{ const t=promptEl.value.trim(); if(t) generatePoster(t); };
promptEl.addEventListener("keydown",(e)=>{ if(e.key==="Enter") sendBtn.click(); });
dlBtn.onclick = ()=>{ const url=canvas.toDataURL("image/png"); const a=document.createElement("a"); a.href=url; a.download="poster.png"; a.click(); };

// initial render
setCanvasSize("A3横", true);
drawCaution({ title:"通行注意", subtitle:"走行車両あり。周囲確認を徹底。", en:"Watch for vehicles" });
