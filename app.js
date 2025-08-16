// ========== 1) WebLLM ==========
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

// ========== 2) UI ==========
const messagesEl = document.getElementById("messages");
const promptEl   = document.getElementById("prompt");
const sendBtn    = document.getElementById("send");
const sizeSel    = document.getElementById("size");
const hiResCb    = document.getElementById("hires");
const canvas     = document.getElementById("poster");
const ctx        = canvas.getContext("2d");
const dlBtn      = document.getElementById("download");

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

// ========== 3) Palettes & helpers ==========
const SAFETY = {
  warning:    { base:"#F9A900", glyph:"#111111" },
  prohibition:{ base:"#C62828", glyph:"#111111" },
  mandatory:  { base:"#005387", glyph:"#0E3861"  }, // 深蓝做线条
  safe:       { base:"#237F52", glyph:"#FFFFFF" },
  fire:       { base:"#C62828", glyph:"#FFFFFF" },
  neutral:    { base:"#2B2B2C", glyph:"#FFFFFF" }
};

function hexToRgb(hex){ const s=hex.replace('#',''); const n=parseInt(s,16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; }
function rgbToHex(r,g,b){ const h=x=>x.toString(16).padStart(2,'0'); return `#${h(r)}${h(g)}${h(b)}`; }
function tint(hex, amt){ const {r,g,b}=hexToRgb(hex); const t=v=>Math.max(0,Math.min(255,Math.round(v + (255-v)*amt))); return rgbToHex(t(r),t(g),t(b)); }
function stripePattern(color, bg="#fff"){
  const p = document.createElement('canvas'); p.width=80; p.height=80;
  const pc = p.getContext('2d'); pc.fillStyle = bg; pc.fillRect(0,0,80,80);
  pc.save(); pc.translate(0,40); pc.rotate(-Math.PI/4);
  pc.strokeStyle = color; pc.lineWidth = 20;
  for(let x=-200;x<=200;x+=40){ pc.beginPath(); pc.moveTo(x,-200); pc.lineTo(x,200); pc.stroke(); }
  pc.restore(); return ctx.createPattern(p, 'repeat');
}
function setCanvasSize(size, hiRes){
  const dpi = hiRes ? 200 : 150;
  const W = Math.round((420/25.4)*dpi), H = Math.round((297/25.4)*dpi);
  const landscape = (size||"A3横").includes("横");
  canvas.width  = landscape ? W : H; canvas.height = landscape ? H : W;
}
function roundRect(c, x,y,w,h,r, fill=true, stroke=false){
  c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r);
  c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); if(fill) c.fill(); if(stroke) c.stroke();
}
function wrap(c, text, x, y, maxW, lh){
  const chars = (text||"").split(""); let line="", yy=y;
  for(let i=0;i<chars.length;i++){ const t=line+chars[i];
    if(c.measureText(t).width>maxW && line){ c.fillText(line,x,yy); line=chars[i]; yy+=lh; } else line=t; }
  if(line) c.fillText(line,x,yy);
}

// ========== 4) Few-shot style book + prompt ==========
const STYLE_BOOK = `
# 目的
ユーザーの文章から、倉庫用サイン/ポスターのスタイルと文面を決める。

# スタイル
- caution_yellow: 黄地+黒斜線枠。用途=「注意/通行注意/衝突注意」など。見出し太字。
- prohibit_red: 赤地+白斜線枠。用途=「～禁止/仮置き禁止/立入禁止」。
- stop_triangle: 白地+オレンジ斜線枠+赤い逆三角の「止まれ」。
- exit_green: 緑地+白ヘッダー（避難口）。用途=「非常口/前に物を置かない」。
- info_blue: 白地+青パネル+青枠。用途=「歩行者通路/○○置場/案内表示」。

# 出力JSONスキーマ
{"style":"caution_yellow|prohibit_red|stop_triangle|exit_green|info_blue",
 "title":"日本語の大見出し",
 "subtitle":"日本語の補足（20～40字）",
 "en":"英語（任意）",
 "extra":"第2言語（任意）",
 "category":"warning|prohibition|mandatory|safe|fire|neutral",
 "icon":"歩行者|フォークリフト|台車|カゴ車|段ボール|パレット|ゴミ|立入禁止|避難口 など",
 "size":"A3横|A3縦"}

# 例
- 入力:「通行注意。走行車両あり。英語も入れて。」→ style=caution_yellow, title=通行注意, subtitle=走行車両あり。行人は十分注意。, en=Watch for vehicles, category=warning, icon=注意
- 入力:「シャッターライン内は仮置き禁止。」→ style=prohibit_red, title=仮置き禁止, subtitle=シャッターライン内に物を置かないでください。, en=Do not place items on shutter line, category=prohibition, icon=立入禁止
- 入力:「止まれ。一時停止。」→ style=stop_triangle, title=止まれ, subtitle=一時停止, en=Stop
- 入力:「非常口の案内。前に物を置かない。」→ style=exit_green, title=非常口, subtitle=前に物を置かない, en=Emergency exit
- 入力:「パレット置場の案内。」→ style=info_blue, title=パレット置場, subtitle=専用保管区域, en=Pallets station, category=mandatory, icon=パレット
`;

const SYSTEM_PROMPT = `
あなたは倉庫安全ポスターのコピーライター兼デザイナー。${STYLE_BOOK}
必ず上記スキーマのJSONだけを返す。余計な文章は禁止。`;

// ========== 5) 线条图标（无需外部文件） ==========
function drawLineIcon(type, x, y, w, h, color){
  ctx.save();
  ctx.strokeStyle = color || "#005387";
  ctx.lineWidth = Math.max(6, Math.round(Math.min(w,h) * 0.02));
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // 统一一个内边距
  const pad = Math.min(w,h) * 0.08;
  const X = x + pad, Y = y + pad, W = w - pad*2, H = h - pad*2;

  function rect(rx,ry,rw,rh,r=10){ ctx.beginPath(); roundRect(ctx, rx,ry,rw,rh,r,false,true); }
  function circ(cx,cy,r){ ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke(); }

  switch(type){
    case "pallet": { // 三层板条 + 地脚
      rect(X, Y+H*0.05, W, H*0.22, 12);
      rect(X, Y+H*0.39, W, H*0.22, 12);
      rect(X, Y+H*0.73, W, H*0.18, 12);
      ctx.beginPath();
      ctx.moveTo(X+W*0.15, Y+H*0.95); ctx.lineTo(X+W*0.45, Y+H*0.95);
      ctx.moveTo(X+W*0.55, Y+H*0.95); ctx.lineTo(X+W*0.85, Y+H*0.95);
      ctx.stroke();
      break;
    }
    case "cart": { // 平台车：平台 + 把手 + 轮子
      rect(X, Y+H*0.65, W, H*0.20, 8);
      ctx.beginPath(); // handle
      ctx.moveTo(X+W*0.12, Y+H*0.65); ctx.lineTo(X+W*0.12, Y+H*0.15); ctx.lineTo(X+W*0.32, Y+H*0.15);
      ctx.stroke();
      circ(X+W*0.20, Y+H*0.90, H*0.06); circ(X+W*0.80, Y+H*0.90, H*0.06);
      break;
    }
    case "cage": { // 笼车：外框 + 竖条 + 横条 + 轮
      rect(X, Y+H*0.08, W, H*0.70, 12);
      ctx.beginPath();
      ctx.moveTo(X+W*0.33, Y+H*0.08); ctx.lineTo(X+W*0.33, Y+H*0.78);
      ctx.moveTo(X+W*0.66, Y+H*0.08); ctx.lineTo(X+W*0.66, Y+H*0.78);
      ctx.moveTo(X, Y+H*0.32); ctx.lineTo(X+W, Y+H*0.32);
      ctx.moveTo(X, Y+H*0.56); ctx.lineTo(X+W, Y+H*0.56);
      ctx.stroke();
      circ(X+W*0.18, Y+H*0.90, H*0.06); circ(X+W*0.82, Y+H*0.90, H*0.06);
      break;
    }
    case "cardboard": { // 纸箱堆
      rect(X+W*0.05, Y+H*0.55, W*0.28, H*0.30, 8);
      rect(X+W*0.36, Y+H*0.55, W*0.28, H*0.30, 8);
      rect(X+W*0.67, Y+H*0.55, W*0.28, H*0.30, 8);
      rect(X+W*0.21, Y+H*0.24, W*0.28, H*0.28, 8);
      rect(X+W*0.52, Y+H*0.24, W*0.28, H*0.28, 8);
      break;
    }
    case "trash": { // 三个垃圾桶
      rect(X+W*0.02, Y+H*0.30, W*0.28, H*0.50, 10);
      rect(X+W*0.36, Y+H*0.30, W*0.28, H*0.50, 10);
      rect(X+W*0.70, Y+H*0.30, W*0.28, H*0.50, 10);
      ctx.beginPath(); // 盖子
      ctx.moveTo(X+W*0.02, Y+H*0.30);
      ctx.lineTo(X+W*0.30, Y+H*0.30);
      ctx.moveTo(X+W*0.36, Y+H*0.30);
      ctx.lineTo(X+W*0.64, Y+H*0.30);
      ctx.moveTo(X+W*0.70, Y+H*0.30);
      ctx.lineTo(X+W*0.98, Y+H*0.30);
      ctx.stroke();
      break;
    }
    case "pedestrian": { // 小人走路
      circ(X+W*0.52, Y+H*0.18, H*0.06);
      ctx.beginPath(); // 身体/四肢
      ctx.moveTo(X+W*0.52, Y+H*0.24); ctx.lineTo(X+W*0.42, Y+H*0.44); // 左臂
      ctx.moveTo(X+W*0.52, Y+H*0.24); ctx.lineTo(X+W*0.64, Y+H*0.36); // 右臂
      ctx.moveTo(X+W*0.44, Y+H*0.44); ctx.lineTo(X+W*0.36, Y+H*0.72); // 左腿
      ctx.moveTo(X+W*0.60, Y+H*0.40); ctx.lineTo(X+W*0.56, Y+H*0.72); // 右腿
      ctx.stroke();
      break;
    }
    case "forklift": { // 叉车（简化）
      circ(X+W*0.28, Y+H*0.82, H*0.06); circ(X+W*0.58, Y+H*0.82, H*0.06);
      rect(X+W*0.18, Y+H*0.52, W*0.48, H*0.20, 10); // 车体
      ctx.beginPath(); // 桅杆+货叉
      ctx.moveTo(X+W*0.66, Y+H*0.30); ctx.lineTo(X+W*0.66, Y+H*0.80);
      ctx.moveTo(X+W*0.66, Y+H*0.76); ctx.lineTo(X+W*0.90, Y+H*0.76);
      ctx.moveTo(X+W*0.66, Y+H*0.84); ctx.lineTo(X+W*0.92, Y+H*0.84);
      ctx.stroke();
      break;
    }
    default: { // 占位
      rect(X+W*0.15, Y+H*0.15, W*0.70, H*0.70, 16);
    }
  }
  ctx.restore();
}

// 把自然语言或 spec.icon 转成我们上面的 type
function inferIconType(textOrIcon){
  const t = (textOrIcon||"").toString();
  if(/パレット/.test(t)) return "pallet";
  if(/台車|カート/.test(t)) return "cart";
  if(/カゴ車/.test(t)) return "cage";
  if(/段ボール|ダンボール|箱/.test(t)) return "cardboard";
  if(/ゴミ|廃棄|trash/i.test(t)) return "trash";
  if(/歩行者|通路|歩道/.test(t)) return "pedestrian";
  if(/フォークリフト|リフト/.test(t)) return "forklift";
  return "pedestrian";
}

// ========== 6) Renderers ==========
function drawCaution(spec){
  const pal = SAFETY.warning;
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;
  ctx.fillStyle = tint(pal.base, 0.2); roundRect(ctx,x,y,w,h,22,true,false);
  ctx.save(); ctx.fillStyle = stripePattern("#000", tint(pal.base,0.2)); ctx.globalAlpha=0.16;
  roundRect(ctx,x+12,y+12,w-24,h-24,16,true,false); ctx.restore();

  // 左侧小插图（根据 icon 推断）
  drawLineIcon(inferIconType(spec.icon||""), x+24, y+24, Math.min(w*0.28, 520), h-48, "#111");

  // 文案
  const tx = x + Math.min(w*0.28, 520) + 56, maxW = w - (tx - x) - 40;
  ctx.fillStyle="#111"; ctx.font=`800 ${Math.round(h*0.13)}px 'Noto Sans JP'`;
  wrap(ctx, spec.title||"通行注意", tx, y+Math.round(h*0.18), maxW, Math.round(h*0.15));
  ctx.fillStyle="#111"; ctx.font=`700 ${Math.round(h*0.07)}px 'Noto Sans JP'`;
  wrap(ctx, spec.subtitle||"走行車両あり。行人は十分注意。", tx, y+Math.round(h*0.38), maxW, Math.round(h*0.09));
  ctx.fillStyle="#222"; ctx.font=`600 ${Math.round(h*0.06)}px 'Noto Sans JP'`;
  if(spec.en) wrap(ctx, spec.en, tx, y+Math.round(h*0.54), maxW, Math.round(h*0.08));
  if(spec.extra){ ctx.fillStyle="#333"; ctx.font=`600 ${Math.round(h*0.05)}px 'Noto Sans JP'`;
    wrap(ctx, spec.extra, tx, y+Math.round(h*0.66), maxW, Math.round(h*0.07)); }
}

function drawProhibit(spec){
  const pal = SAFETY.prohibition;
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;
  ctx.fillStyle=pal.base; roundRect(ctx,x,y,w,h,22,true,false);
  ctx.save(); ctx.fillStyle = stripePattern("#fff", pal.base); ctx.globalAlpha=0.25;
  roundRect(ctx,x+14,y+14,w-28,h-28,18,true,false); ctx.restore();

  // 左侧小插图
  drawLineIcon(inferIconType(spec.icon||"立入禁止"), x+24, y+24, Math.min(w*0.28, 520), h-48, "#fff");

  // 文案（白字）
  const tx = x + Math.min(w*0.28, 520) + 56, maxW = w - (tx - x) - 40;
  ctx.fillStyle="#fff"; ctx.font=`800 ${Math.round(h*0.13)}px 'Noto Sans JP'`;
  wrap(ctx, spec.title||"仮置き禁止", tx, y+Math.round(h*0.18), maxW, Math.round(h*0.15));
  ctx.font=`600 ${Math.round(h*0.06)}px 'Noto Sans JP'`;
  wrap(ctx, spec.subtitle||"この範囲に物を置かないでください。", tx, y+Math.round(h*0.36), maxW, Math.round(h*0.08));
  if(spec.en) wrap(ctx, spec.en, tx, y+Math.round(h*0.50), maxW, Math.round(h*0.07));
  if(spec.extra){ ctx.font=`600 ${Math.round(h*0.05)}px 'Noto Sans JP'`;
    wrap(ctx, spec.extra, tx, y+Math.round(h*0.60), maxW, Math.round(h*0.06)); }
}

function drawStop(spec){
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;
  ctx.save(); ctx.fillStyle = stripePattern("#ff7a00", "#fff"); ctx.globalAlpha=0.35;
  roundRect(ctx,x,y,w,h,22,true,false); ctx.restore();
  ctx.strokeStyle="#ddd"; ctx.lineWidth=6; roundRect(ctx,x+4,y+4,w-8,h-8,20,false,true);

  // 左侧插图：红色倒三角
  const side = Math.min(w*0.26, h*0.40);
  const cx = x + side*1.2, cy = y + h*0.42;
  ctx.fillStyle = "#d32f2f"; ctx.beginPath();
  ctx.moveTo(cx, cy - side/1.7); ctx.lineTo(cx - side/1.2, cy + side/1.7);
  ctx.lineTo(cx + side/1.2, cy + side/1.7); ctx.closePath(); ctx.fill();

  // 文案
  const tx = x + Math.min(w*0.28, 520) + 56, maxW = w - (tx - x) - 40;
  ctx.fillStyle="#d32f2f"; ctx.font=`800 ${Math.round(h*0.12)}px 'Noto Sans JP'`;
  wrap(ctx, spec.title||"止まれ", tx, y+Math.round(h*0.18), maxW, Math.round(h*0.13));
  ctx.font=`600 ${Math.round(h*0.06)}px 'Noto Sans JP'`;
  wrap(ctx, spec.subtitle||"一時停止", tx, y+Math.round(h*0.32), maxW, Math.round(h*0.08));
  wrap(ctx, spec.en||"Stop", tx, y+Math.round(h*0.40), maxW, Math.round(h*0.08));
}

function drawExit(spec){
  const pal = SAFETY.safe;
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.05);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  ctx.fillStyle=pal.base; roundRect(ctx,x,y,w,h,26,true,false);
  const hh = Math.round(h*0.22); ctx.fillStyle="#fff"; roundRect(ctx,x+10,y+10,w-20,hh,16,true,false);

  // 头部：简化“奔跑人”线条
  ctx.save(); ctx.strokeStyle=pal.base; ctx.lineWidth=Math.max(8, Math.round(hh*0.06));
  ctx.beginPath(); // 头
  ctx.arc(x+38, y+hh/2, hh*0.14, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); // 身体/四肢
  ctx.moveTo(x+38, y+hh/2 + hh*0.14); ctx.lineTo(x+38+hh*0.22, y+hh/2 + hh*0.32);
  ctx.moveTo(x+38+hh*0.10, y+hh/2 + hh*0.10); ctx.lineTo(x+38+hh*0.28, y+hh/2 - hh*0.12);
  ctx.stroke(); ctx.restore();

  // 标题
  ctx.fillStyle="#111"; ctx.font=`800 ${Math.round(hh*0.42)}px 'Noto Sans JP'`;
  ctx.fillText(spec.title||"非常口", x+hh, y+hh/2+10);

  // 正文
  ctx.fillStyle="#fff"; ctx.font=`700 ${Math.round(h*0.09)}px 'Noto Sans JP'`;
  wrap(ctx, spec.subtitle||"前に物を置かない", x+30, y+hh+60, w-60, Math.round(h*0.1));
  ctx.fillStyle="#e8f5ec"; ctx.font=`600 ${Math.round(h*0.06)}px 'Noto Sans JP'`;
  if(spec.en) wrap(ctx, spec.en, x+30, y+hh+140, w-60, Math.round(h*0.08));
  if(spec.extra) wrap(ctx, spec.extra, x+30, y+hh+200, w-60, Math.round(h*0.07));
}

function drawBlue(spec){
  const blue = SAFETY.mandatory.base, line = SAFETY.mandatory.glyph;
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  // 外白板 + 内蓝板 + 粗边
  ctx.fillStyle="#fff"; roundRect(ctx,x,y,w,h,28,true,false);
  ctx.strokeStyle="#cfd8e1"; ctx.lineWidth=6; roundRect(ctx,x+4,y+4,w-8,h-8,24,false,true);

  const bx=x+24, by=y+24, bw=w-48, bh=h-48;
  ctx.fillStyle = "#eaf2f9"; roundRect(ctx,bx,by,bw,bh,22,true,false);
  ctx.strokeStyle = blue; ctx.lineWidth = 16; roundRect(ctx,bx+12,by+12,bw-24,bh-24,16,false,true);

  // 左侧线条小插图
  const cardW = Math.min(bw*0.33, 520);
  drawLineIcon(inferIconType(spec.icon||spec.title||""), bx+20, by+20, cardW-40, bh-40, line);

  // 右侧标题/副标题
  const tx = bx + cardW + 40, maxW = bw - cardW - 60;
  ctx.fillStyle = blue; ctx.font = `800 ${Math.round(bh*0.22)}px 'Noto Sans JP'`;
  wrap(ctx, spec.title || "置場", tx, by + Math.round(bh*0.20), maxW, Math.round(bh*0.24));

  ctx.fillStyle = "#2b2f38"; ctx.font = `600 ${Math.round(bh*0.10)}px 'Noto Sans JP'`;
  wrap(ctx, spec.en || "Station", tx, by + Math.round(bh*0.55), maxW, Math.round(bh*0.12));

  if(spec.extra){
    ctx.fillStyle = "#445"; ctx.font = `600 ${Math.round(bh*0.08)}px 'Noto Sans JP'`;
    wrap(ctx, spec.extra, tx, by + Math.round(bh*0.70), maxW, Math.round(bh*0.10));
  }
}

// ========== 7) 主流程 ==========
async function generatePoster(userText){
  addMsg("user", userText);
  const size = sizeSel.value || "A3横"; const hiRes = !!hiResCb.checked;
  setCanvasSize(size, hiRes);

  let spec = {};
  if(engine){
    try{
      const reply = await engine.chat.completions.create({
        messages:[
          { role:"system", content: SYSTEM_PROMPT },
          { role:"user", content: `${userText}\nサイズ:${size}` }
        ],
        temperature: 0.2, max_tokens: 400, stream: false,
      });
      spec = JSON.parse(reply.choices[0].message.content);
    }catch(e){ console.warn(e); }
  }

  // Fallback：当小模型不可用或输出不完整时，靠关键词推断
  if(!spec.style){
    const t=userText||"";
    if(/止まれ|一時停止|stop/i.test(t))         spec.style="stop_triangle";
    else if(/仮置|禁止|立入禁止/.test(t))        spec.style="prohibit_red";
    else if(/非常口|避難口|exit/i.test(t))       spec.style="exit_green";
    else if(/歩行者|通路|置場|station/i.test(t)) spec.style="info_blue";
    else                                          spec.style="caution_yellow";
    // 粗略文案
    if(!spec.title){
      if(spec.style==="prohibit_red") spec.title="仮置き禁止";
      else if(spec.style==="exit_green") spec.title="非常口";
      else if(spec.style==="stop_triangle") spec.title="止まれ";
      else if(spec.style==="info_blue") spec.title="歩行者通路";
      else spec.title="通行注意";
    }
    spec.subtitle = spec.subtitle || "周囲確認を徹底しましょう。";
  }

  addMsg("assistant", `スタイル：${spec.style}／タイトル：${spec.title}／英語：${spec.en||""}`);

  if(spec.style==="caution_yellow")      drawCaution(spec);
  else if(spec.style==="prohibit_red")   drawProhibit(spec);
  else if(spec.style==="stop_triangle")  drawStop(spec);
  else if(spec.style==="exit_green")     drawExit(spec);
  else if(spec.style==="info_blue")      drawBlue(spec);
  else                                   drawCaution(spec);
}

sendBtn.onclick = ()=>{ const t=promptEl.value.trim(); if(t) generatePoster(t); };
promptEl.addEventListener("keydown",(e)=>{ if(e.key==="Enter") sendBtn.click(); });
dlBtn.onclick = ()=>{ const url=canvas.toDataURL("image/png"); const a=document.createElement("a"); a.href=url; a.download = "poster.png"; a.click(); };

// 初始预览
setCanvasSize("A3横", true);
drawCaution({ title:"通行注意", subtitle:"走行車両あり。周囲確認を徹底。", en:"Watch for vehicles" });
