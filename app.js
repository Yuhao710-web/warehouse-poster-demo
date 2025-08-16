// =================== 1) WebLLM 初始化 ===================
let engine;
(async () => {
  try{
    engine = await webllm.CreateWebWorkerEngine(
      new Worker("https://unpkg.com/@mlc-ai/web-llm/dist/worker.js", { type:"module" }),
      { model:"Llama-3.2-1B-Instruct-q4f32_1-MLC" } // 体积较小，前端可跑
    );
  }catch(e){
    console.warn("WebLLM init failed:", e);
    addMsg("assistant", "（お知らせ）AI自動生成が無効の可能性があります。テキストのみで見た目を推定します。");
  }
})();

// =================== 2) UI 绑定 & IME 回车识别 ===================
const messagesEl = document.getElementById("messages");
const promptEl   = document.getElementById("prompt");
const sendBtn    = document.getElementById("send");
const canvas     = document.getElementById("poster");
const ctx        = canvas.getContext("2d");
const dlBtn      = document.getElementById("download");

let isComposing = false;
promptEl.addEventListener("compositionstart", ()=>{ isComposing = true; });
promptEl.addEventListener("compositionend",   ()=>{ isComposing = false; });
promptEl.addEventListener("keydown", (e)=>{
  if(e.key === "Enter" && !e.shiftKey){
    if (e.isComposing || isComposing || e.keyCode === 229) return; // 输入法确认，不发送
    e.preventDefault(); sendBtn.click();
  }
});

sendBtn.onclick = ()=>{
  const t = (promptEl.value || "").trim();
  if(t) generatePoster(t);
};
dlBtn.onclick = ()=>{
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a"); a.href = url; a.download = "poster.png"; a.click();
};

function addMsg(role, text){
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "user" : "bot");
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// =================== 3) 画布与工具函数 ===================
function setCanvasA3(hiRes=true){
  const dpi = hiRes ? 200 : 150;
  const W = Math.round((420/25.4)*dpi);  // 420mm
  const H = Math.round((297/25.4)*dpi);  // 297mm
  canvas.width = W; canvas.height = H;   // A3 横向
}
function roundRect(c, x,y,w,h,r, fill=true, stroke=false){
  c.beginPath();
  c.moveTo(x+r, y);
  c.arcTo(x+w, y,   x+w, y+h, r);
  c.arcTo(x+w, y+h, x,   y+h, r);
  c.arcTo(x,   y+h, x,   y,   r);
  c.arcTo(x,   y,   x+w, y,   r);
  c.closePath();
  if (fill)   c.fill();
  if (stroke) c.stroke();
}
function stripePattern(color, bg="#fff"){
  const p = document.createElement("canvas"); p.width = 80; p.height = 80;
  const pc = p.getContext("2d");
  pc.fillStyle = bg; pc.fillRect(0,0,80,80);
  pc.save(); pc.translate(0,40); pc.rotate(-Math.PI/4);
  pc.strokeStyle = color; pc.lineWidth = 20;
  for(let x=-200;x<=200;x+=40){ pc.beginPath(); pc.moveTo(x,-200); pc.lineTo(x,200); pc.stroke(); }
  pc.restore();
  return ctx.createPattern(p, "repeat");
}

// ======= （关键）字距 & 居中换行：更接近你参考图的排版 =======
function measureLineWidth(c, text, tracking=0){
  let w = 0;
  for(const ch of (text||"")) w += c.measureText(ch).width + tracking;
  return Math.max(0, w - tracking);
}
function drawTrackedLine(c, text, cx, y, tracking=0){
  const totalW = measureLineWidth(c, text, tracking);
  let x = cx - totalW/2;
  for(const ch of (text||"")){
    c.fillText(ch, x, y);
    x += c.measureText(ch).width + tracking;
  }
}
function wrapCenterTracked(c, text, cx, top, maxW, lineHeight, tracking=0){
  const chars = (text||"").split("");
  let line = "", y = top;
  for(const ch of chars){
    const test = line + ch;
    if(measureLineWidth(c, test, tracking) > maxW && line){
      drawTrackedLine(c, line, cx, y, tracking);
      line = ch; y += lineHeight;
    }else{
      line = test;
    }
  }
  if(line) drawTrackedLine(c, line, cx, y, tracking);
}
// 仅测行数，不绘制（用于防止上下区块重叠）
function wrapMeasureLines(c, text, maxW, lineHeight, tracking=0){
  const chars = (text||"").split("");
  let line = "", lines = 0;
  for(const ch of chars){
    const test = line + ch;
    if(measureLineWidth(c, test, tracking) > maxW && line){
      lines += 1; line = ch;
    }else{
      line = test;
    }
  }
  if(line) lines += 1;
  return lines;
}

// =================== 4) LLM 提示（学习过你的风格） ===================
const STYLE_BOOK = `
# 目的
ユーザーの自然言語から倉庫用の安全/案内ポスター仕様を推定する。
テンプレートは使わず、最小限のスタイル指針だけを用いる。

# 視覚指針（あなたが学習済みの例に合わせる）
- 注意: 黄地 + 黒斜線のテクスチャ。中央に大見出し、太字。字間はやや広め。
- 禁止: 赤地 + 白斜線。中央白字。メッセージを端的に。
- 止まれ: 白地 + 橙斜線ボーダー + 中央の赤い逆三角。上に日本語、下に英語。
- 安全/避難: 緑の大きなヘッダー + 本文は白地。左揃え見出し、本文は中央。
- 案内(置場/通路などの青板): 白い外枠 + 青い内枠。人物シルエットは使わない。基本は文字中心。

# 出力JSON（必須）
{"style":"caution_yellow|prohibit_red|stop_triangle|exit_green|info_blue",
 "title":"日本語の大見出し（8〜10字程度に簡潔化）",
 "subtitle":"日本語の補足（20〜40字）",
 "en":"英語（任意）",
 "extra":"",
 "category":"warning|prohibition|mandatory|safe|fire|neutral",
 "icon":"none",
 "size":"A3横"}
`;

const SYSTEM_PROMPT = `
あなたは倉庫安全ポスターのコピー/デザイン担当。
${STYLE_BOOK}
出力は必ず上記スキーマのJSONのみ。説明文は出力しない。`;

// =================== 5) 五种风格渲染（顺序排版，按行数自动避让；柔和色 & 加大行距） ===================

// === 1) 注意（黄）— 更柔和 + 顺序排版：标题→副标题→英文 ===
function drawCaution(spec){
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);

  const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.06);
  const x=pad, y=pad, w=canvas.width-pad*2, h=canvas.height-pad*2;

  // 白卡 + 轻阴影
  ctx.save(); ctx.shadowColor="rgba(0,0,0,.08)"; ctx.shadowBlur=24; ctx.shadowOffsetY=10;
  ctx.fillStyle="#fff"; roundRect(ctx,x,y,w,h,26,true,false); ctx.restore();

  // 柔和黄 + 淡斜纹
  const inPad = Math.round(Math.min(w,h)*0.06);
  const ix=x+inPad, iy=y+inPad, iw=w-inPad*2, ih=h-inPad*2;
  const grad = ctx.createLinearGradient(ix,iy, ix, iy+ih);
  grad.addColorStop(0, "#f7de88");
  grad.addColorStop(1, "#f6d66e");
  ctx.fillStyle = grad; roundRect(ctx,ix,iy,iw,ih,20,true,false);

  ctx.save(); ctx.fillStyle = stripePattern("#000", "rgba(0,0,0,0)"); ctx.globalAlpha=0.14;
  roundRect(ctx,ix+16,iy+16,iw-32,ih-32,16,true,false); ctx.restore();

  // 文案（行距 + 字距）
  const cx = x + w/2;
  const maxW = Math.round(iw*0.86);

  const tSize = Math.round(ih*0.19);
  const sSize = Math.round(ih*0.10);
  const eSize = Math.round(ih*0.085);
  const tLH = Math.round(tSize*1.26);
  const sLH = Math.round(sSize*1.34);
  const eLH = Math.round(eSize*1.30);
  const trackT = Math.max(2, Math.round(tSize*0.020));
  const trackS = Math.max(1, Math.round(sSize*0.018));
  const trackE = Math.max(1, Math.round(eSize*0.018));

  // 先测行数，再排版，确保不重叠
  ctx.textAlign="center"; ctx.fillStyle="#1a1a1a";
  ctx.font=`800 ${tSize}px 'Noto Sans JP'`;
  const tLines = wrapMeasureLines(ctx, spec.title||"通行注意", maxW, tLH, trackT);
  let yTop = iy + Math.round(ih*0.26); // 标题起点稍靠上
  wrapCenterTracked(ctx, spec.title||"通行注意", cx, yTop, maxW, tLH, trackT);
  yTop += tLines * tLH + Math.round(ih*0.06); // 与副标题的间距

  ctx.font=`700 ${sSize}px 'Noto Sans JP'`;
  const sLines = wrapMeasureLines(ctx, spec.subtitle||"走行車両あり。周囲確認を徹底。", maxW, sLH, trackS);
  wrapCenterTracked(ctx, spec.subtitle||"走行車両あり。周囲確認を徹底。", cx, yTop, maxW, sLH, trackS);
  yTop += sLines * sLH + Math.round(ih*0.06); // 与英文的间距

  if(spec.en){
    ctx.fillStyle="#2a2a2a"; ctx.font=`600 ${eSize}px 'Noto Sans JP'`;
    wrapCenterTracked(ctx, spec.en, cx, yTop, maxW, eLH, trackE);
  }
}

// === 2) 禁止（红）— 柔和红 + 顺序排版：标题→副标题→英文 ===
function drawProhibit(spec){
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  ctx.save(); ctx.shadowColor="rgba(0,0,0,.08)"; ctx.shadowBlur=24; ctx.shadowOffsetY=10;
  ctx.fillStyle="#fff"; roundRect(ctx,x,y,w,h,26,true,false); ctx.restore();

  const inPad = Math.round(Math.min(w,h)*0.06);
  const ix=x+inPad, iy=y+inPad, iw=w-inPad*2, ih=h-inPad*2;
  const grad = ctx.createLinearGradient(ix,iy, ix, iy+ih);
  grad.addColorStop(0, "#d95a5a");
  grad.addColorStop(1, "#cf4444");
  ctx.fillStyle=grad; roundRect(ctx,ix,iy,iw,ih,20,true,false);

  ctx.save(); ctx.fillStyle = stripePattern("#fff", "rgba(0,0,0,0)"); ctx.globalAlpha=0.20;
  roundRect(ctx,ix+18,iy+18,iw-36,ih-36,16,true,false); ctx.restore();

  const cx = x + w/2;
  const maxW = Math.round(iw*0.86);

  const tSize = Math.round(ih*0.19);
  const sSize = Math.round(ih*0.095);
  const eSize = Math.round(ih*0.085);
  const tLH = Math.round(tSize*1.26);
  const sLH = Math.round(sSize*1.34);
  const eLH = Math.round(eSize*1.30);
  const trackT = Math.max(2, Math.round(tSize*0.020));
  const trackS = Math.max(1, Math.round(sSize*0.018));
  const trackE = Math.max(1, Math.round(eSize*0.018));

  ctx.textAlign="center"; ctx.fillStyle="#fff";
  ctx.font=`800 ${tSize}px 'Noto Sans JP'`;
  const tLines = wrapMeasureLines(ctx, spec.title||"仮置き禁止", maxW, tLH, trackT);
  let yTop = iy + Math.round(ih*0.26);
  wrapCenterTracked(ctx, spec.title||"仮置き禁止", cx, yTop, maxW, tLH, trackT);
  yTop += tLines * tLH + Math.round(ih*0.06);

  ctx.font=`600 ${sSize}px 'Noto Sans JP'`;
  const sLines = wrapMeasureLines(ctx, spec.subtitle||"この範囲に物を置かないでください。", maxW, sLH, trackS);
  wrapCenterTracked(ctx, spec.subtitle||"この範囲に物を置かないでください。", cx, yTop, maxW, sLH, trackS);
  yTop += sLines * sLH + Math.round(ih*0.06);

  if(spec.en){
    ctx.font=`600 ${eSize}px 'Noto Sans JP'`;
    wrapCenterTracked(ctx, spec.en, cx, yTop, maxW, eLH, trackE);
  }
}

// === 3) 止まれ（白/橙/红）— 文字与三角形分区（标题↑ 三角形中间 副标题/英文↓） ===
function drawStop(spec){
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  // 白卡 + 更淡橙斜纹边 + 细描边
  ctx.save(); ctx.shadowColor="rgba(0,0,0,.08)"; ctx.shadowBlur=24; ctx.shadowOffsetY=10;
  ctx.fillStyle="#fff"; roundRect(ctx,x,y,w,h,26,true,false); ctx.restore();
  ctx.save(); ctx.fillStyle = stripePattern("#ff9a3a","#fff"); ctx.globalAlpha=0.28;
  roundRect(ctx,x+10,y+10,w-20,h-20,20,true,false); ctx.restore();
  ctx.strokeStyle="#e5e8ee"; ctx.lineWidth=6; roundRect(ctx,x+8,y+8,w-16,h-16,20,false,true);

  // 红色倒三角（柔和）
  const cx = x + w/2;
  const side = Math.min(w,h)*0.28;
  const triTop = y + Math.round(h*0.24);
  ctx.fillStyle="#d54040";
  ctx.beginPath();
  ctx.moveTo(cx, triTop);
  ctx.lineTo(cx - side/1.15, triTop + side*0.95);
  ctx.lineTo(cx + side/1.15, triTop + side*0.95);
  ctx.closePath(); ctx.fill();

  // 文案：标题在三角上方，副标题/英文在三角下方（固定区域，天然不重叠）
  const tSize = Math.round(h*0.112), sSize = Math.round(h*0.072), eSize = Math.round(h*0.068);
  const tLH = Math.round(tSize*1.28), sLH = Math.round(sSize*1.26), eLH = Math.round(eSize*1.24);
  const trackT = Math.max(2, Math.round(tSize*0.020));
  const trackS = Math.max(1, Math.round(sSize*0.018));
  const trackE = Math.max(1, Math.round(eSize*0.018));
  const maxW = Math.round(w*0.82);

  // 标题（上）
  ctx.fillStyle="#c93535"; ctx.textAlign="center"; ctx.font=`800 ${tSize}px 'Noto Sans JP'`;
  const tLines = wrapMeasureLines(ctx, spec.title||"止まれ", maxW, tLH, trackT);
  let yTop = y + Math.round(h*0.16);
  wrapCenterTracked(ctx, spec.title||"止まれ", cx, yTop, maxW, tLH, trackT);

  // 副标题 + 英文（下）
  yTop = y + Math.round(h*0.58); // 三角形下缘之后
  ctx.font=`700 ${sSize}px 'Noto Sans JP'`;
  const sLines = wrapMeasureLines(ctx, spec.subtitle||"一時停止", maxW, sLH, trackS);
  wrapCenterTracked(ctx, spec.subtitle||"一時停止", cx, yTop, maxW, sLH, trackS);
  yTop += sLines * sLH + Math.round(h*0.02);

  if(spec.en){
    ctx.font=`700 ${eSize}px 'Noto Sans JP'`;
    wrapCenterTracked(ctx, spec.en, cx, yTop, maxW, eLH, trackE);
  }
}

// === 4) 安全/避难（绿）— 更柔和绿 + 行距增大 ===
function drawExit(spec){
  ctx.fillStyle="#2f8f66"; ctx.fillRect(0,0,canvas.width,canvas.height); // 柔和底
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.05);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  const grad = ctx.createLinearGradient(x,y, x, y+h);
  grad.addColorStop(0, "#35a173");
  grad.addColorStop(1, "#2f8f66");
  ctx.fillStyle=grad; roundRect(ctx,x,y,w,h,26,true,false);

  const hh = Math.round(h*0.22);
  ctx.fillStyle="#fff"; roundRect(ctx,x+12,y+12,w-24,hh,16,true,false);

  const cx = x + w/2;
  ctx.fillStyle="#111"; ctx.textAlign="left";
  const headSize = Math.round(hh*0.42);
  const trackHead = Math.max(2, Math.round(headSize*0.02));
  ctx.font=`800 ${headSize}px 'Noto Sans JP'`;
  drawTrackedLine(ctx, spec.title||"非常口", x+28, y + Math.round(hh*0.58), trackHead);

  ctx.textAlign="center";
  ctx.fillStyle="#fff"; const bodySize = Math.round(h*0.088);
  const bodyLH = Math.round(bodySize*1.32);
  const maxW = Math.round(w*0.86);
  ctx.font=`700 ${bodySize}px 'Noto Sans JP'`;
  const sLines = wrapMeasureLines(ctx, spec.subtitle||"前に物を置かない", maxW, bodyLH, Math.round(bodySize*0.02));
  wrapCenterTracked(ctx, spec.subtitle||"前に物を置かない", cx, y+hh+60, maxW, bodyLH, Math.round(bodySize*0.02));

  let yTop = y+hh+60 + sLines * bodyLH + Math.round(h*0.02);
  if(spec.en){
    ctx.fillStyle="#edf7f1"; const eSize = Math.round(h*0.060);
    const eLH = Math.round(eSize*1.28);
    ctx.font=`600 ${eSize}px 'Noto Sans JP'`;
    wrapCenterTracked(ctx, spec.en, cx, yTop, maxW, eLH, Math.round(eSize*0.02));
  }
}

// === 5) 信息板（蓝）— 柔和蓝 + 顺序排版：标题→英文→副标题 ===
function drawBlue(spec){
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  ctx.fillStyle="#fff"; roundRect(ctx,x,y,w,h,28,true,false);
  ctx.strokeStyle="#d8dee6"; ctx.lineWidth=6; roundRect(ctx,x+6,y+6,w-16,h-16,24,false,true);

  const bx=x+26, by=y+26, bw=w-52, bh=h-52;
  ctx.fillStyle="#eff5fb"; roundRect(ctx,bx,by,bw,bh,22,true,false);
  ctx.strokeStyle="#1e6da0"; ctx.lineWidth=16; roundRect(ctx,bx+14,by+14,bw-28,bh-28,18,false,true);

  const cx = bx + bw/2;
  const maxW = Math.round(bw*0.84);
  const tSize = Math.round(bh*0.23);
  const eSize = Math.round(bh*0.10);
  const sSize = Math.round(bh*0.085);
  const tLH = Math.round(tSize*1.26);
  const eLH = Math.round(eSize*1.24);
  const sLH = Math.round(sSize*1.24);
  const trackT = Math.max(2, Math.round(tSize*0.020));
  const trackE = Math.max(1, Math.round(eSize*0.018));
  const trackS = Math.max(1, Math.round(sSize*0.018));

  // 顺序：标题 → 英文 → 副标题（均基于行数下推，杜绝重叠）
  ctx.fillStyle="#2b6f9d"; ctx.textAlign="center"; ctx.font=`800 ${tSize}px 'Noto Sans JP'`;
  const tLines = wrapMeasureLines(ctx, spec.title || "案内", maxW, tLH, trackT);
  let yTop = by + Math.round(bh*0.20);
  wrapCenterTracked(ctx, spec.title || "案内", cx, yTop, maxW, tLH, trackT);
  yTop += tLines * tLH + Math.round(bh*0.05);

  if (spec.en){
    ctx.fillStyle="#344055"; ctx.font=`600 ${eSize}px 'Noto Sans JP'`;
    const eLines = wrapMeasureLines(ctx, spec.en, maxW, eLH, trackE);
    wrapCenterTracked(ctx, spec.en, cx, yTop, maxW, eLH, trackE);
    yTop += eLines * eLH + Math.round(bh*0.04);
  }

  if (spec.subtitle){
    ctx.fillStyle="#4a5366"; ctx.font=`600 ${sSize}px 'Noto Sans JP'`;
    wrapCenterTracked(ctx, spec.subtitle, cx, yTop, maxW, sLH, trackS);
  }
}

// =================== 6) 主流程：自然语言 → 规格 → 渲染 ===================
async function generatePoster(userText){
  addMsg("user", userText);

  // 固定 A3 横 @ 200dpi
  setCanvasA3(true);

  let spec = {};
  if (engine){
    try{
      const reply = await engine.chat.completions.create({
        messages:[
          { role:"system", content: SYSTEM_PROMPT },
          { role:"user",   content: `${userText}\nサイズ:A3横` }
        ],
        temperature: 0.2, max_tokens: 400, stream: false,
      });
      spec = JSON.parse(reply.choices[0].message.content);
    }catch(e){
      console.warn("LLM parse fail:", e);
    }
  }

  // Fallback：关键词推断
  if(!spec.style){
    const t=(userText||"").toLowerCase();
    if(/止まれ|一時停止|stop/.test(t)) spec.style="stop_triangle";
    else if(/禁止|立入禁止|仮置|火気|no /.test(t)) spec.style="prohibit_red";
    else if(/非常口|避難|assembly|evac/.test(t))    spec.style="exit_green";
    else if(/置場|通路|案内|レーン|バース|station|area|lane|dock/.test(t)) spec.style="info_blue";
    else spec.style="caution_yellow";

    if(!spec.title){
      if(spec.style==="prohibit_red") spec.title="仮置き禁止";
      else if(spec.style==="exit_green") spec.title="非常口";
      else if(spec.style==="stop_triangle") spec.title="止まれ";
      else if(spec.style==="info_blue") spec.title="案内";
      else spec.title="通行注意";
    }
    spec.subtitle = spec.subtitle || "周囲確認を徹底しましょう。";
  }

  // 不使用“人物”
  spec.icon = "none";

  addMsg("assistant", `スタイル：${spec.style}／タイトル：${spec.title}／英語：${spec.en||""}`);

  if(spec.style==="caution_yellow")      drawCaution(spec);
  else if(spec.style==="prohibit_red")   drawProhibit(spec);
  else if(spec.style==="stop_triangle")  drawStop(spec);
  else if(spec.style==="exit_green")     drawExit(spec);
  else if(spec.style==="info_blue")      drawBlue(spec);
  else                                   drawCaution(spec);
}

// =================== 7) 初始预览 ===================
setCanvasA3(true);
drawCaution({ title:"通行注意", subtitle:"走行車両あり。周囲確認を徹底。", en:"Watch for vehicles" });
addMsg("assistant","自然言語で指示してください。例：「シャッターライン内は仮置き禁止。英語併記。」/「非常口 前に物を置かない」/「止まれ 一時停止 英語」");
