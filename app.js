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

// =================== 5) 五种风格渲染（更像你的样例；不画人物） ===================
function drawCaution(spec){
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);

  const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.06);
  const x=pad, y=pad, w=canvas.width-pad*2, h=canvas.height-pad*2;

  // 白卡 + 轻阴影
  ctx.save(); ctx.shadowColor="rgba(0,0,0,.08)"; ctx.shadowBlur=24; ctx.shadowOffsetY=10;
  ctx.fillStyle="#fff"; roundRect(ctx,x,y,w,h,26,true,false); ctx.restore();

  // 黄底渐变 + 粗斜纹
  const inPad = Math.round(Math.min(w,h)*0.06);
  const ix=x+inPad, iy=y+inPad, iw=w-inPad*2, ih=h-inPad*2;
  const grad = ctx.createLinearGradient(ix,iy, ix, iy+ih);
  grad.addColorStop(0, "#f9d24a"); grad.addColorStop(1, "#f7c83a");
  ctx.fillStyle = grad; roundRect(ctx,ix,iy,iw,ih,20,true,false);

  ctx.save(); ctx.fillStyle = stripePattern("#000", "rgba(0,0,0,0)"); ctx.globalAlpha=0.20;
  roundRect(ctx,ix+16,iy+16,iw-32,ih-32,16,true,false); ctx.restore();

  // 文案（居中 + 字距）
  const cx = x + w/2;
  const tSize = Math.round(ih*0.19);
  const sSize = Math.round(ih*0.10);
  const eSize = Math.round(ih*0.085);
  const trackTitle = Math.max(2, Math.round(tSize*0.03));
  const trackSub   = Math.max(1, Math.round(sSize*0.03));
  const trackEn    = Math.max(1, Math.round(eSize*0.025));

  ctx.fillStyle="#111"; ctx.textAlign="center";
  ctx.font=`800 ${tSize}px 'Noto Sans JP'`;
  wrapCenterTracked(ctx, spec.title||"通行注意", cx, iy + Math.round(ih*0.30), Math.round(iw*0.88), Math.round(tSize*1.15), trackTitle);

  ctx.font=`700 ${sSize}px 'Noto Sans JP'`;
  wrapCenterTracked(ctx, spec.subtitle||"走行車両あり。周囲確認を徹底。", cx, iy + Math.round(ih*0.50), Math.round(iw*0.90), Math.round(sSize*1.25), trackSub);

  if(spec.en){
    ctx.fillStyle="#222"; ctx.font=`600 ${eSize}px 'Noto Sans JP'`;
    wrapCenterTracked(ctx, spec.en, cx, iy + Math.round(ih*0.68), Math.round(iw*0.86), Math.round(eSize*1.20), trackEn);
  }
}

function drawProhibit(spec){
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  // 白卡
  ctx.save(); ctx.shadowColor="rgba(0,0,0,.08)"; ctx.shadowBlur=24; ctx.shadowOffsetY=10;
  ctx.fillStyle="#fff"; roundRect(ctx,x,y,w,h,26,true,false); ctx.restore();

  // 红底渐变 + 白斜纹
  const inPad = Math.round(Math.min(w,h)*0.06);
  const ix=x+inPad, iy=y+inPad, iw=w-inPad*2, ih=h-inPad*2;
  const grad = ctx.createLinearGradient(ix,iy, ix, iy+ih);
  grad.addColorStop(0, "#cf3a3a"); grad.addColorStop(1, "#c62828");
  ctx.fillStyle=grad; roundRect(ctx,ix,iy,iw,ih,20,true,false);

  ctx.save(); ctx.fillStyle = stripePattern("#fff", "rgba(0,0,0,0)"); ctx.globalAlpha=0.27;
  roundRect(ctx,ix+18,iy+18,iw-36,ih-36,16,true,false); ctx.restore();

  // 文案（白字 + 字距）
  const cx = x + w/2;
  const tSize = Math.round(ih*0.19);
  const sSize = Math.round(ih*0.095);
  const eSize = Math.round(ih*0.085);
  const trackTitle = Math.max(2, Math.round(tSize*0.03));
  const trackSub   = Math.max(1, Math.round(sSize*0.03));
  const trackEn    = Math.max(1, Math.round(eSize*0.025));

  ctx.fillStyle="#fff"; ctx.textAlign="center";
  ctx.font=`800 ${tSize}px 'Noto Sans JP'`;
  wrapCenterTracked(ctx, spec.title||"仮置き禁止", cx, iy + Math.round(ih*0.30), Math.round(iw*0.88), Math.round(tSize*1.15), trackTitle);

  ctx.font=`600 ${sSize}px 'Noto Sans JP'`;
  wrapCenterTracked(ctx, spec.subtitle||"この範囲に物を置かないでください。", cx, iy + Math.round(ih*0.48), Math.round(iw*0.88), Math.round(sSize*1.25), trackSub);

  if(spec.en){
    ctx.font=`600 ${eSize}px 'Noto Sans JP'`;
    wrapCenterTracked(ctx, spec.en, cx, iy + Math.round(ih*0.64), Math.round(iw*0.86), Math.round(eSize*1.2), trackEn);
  }
}

function drawStop(spec){
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  // 白卡 + 橙斜纹边 + 细描边
  ctx.save(); ctx.shadowColor="rgba(0,0,0,.08)"; ctx.shadowBlur=24; ctx.shadowOffsetY=10;
  ctx.fillStyle="#fff"; roundRect(ctx,x,y,w,h,26,true,false); ctx.restore();
  ctx.save(); ctx.fillStyle = stripePattern("#ff7a00","#fff"); ctx.globalAlpha=0.38;
  roundRect(ctx,x+10,y+10,w-20,h-20,20,true,false); ctx.restore();
  ctx.strokeStyle="#e5e8ee"; ctx.lineWidth=6; roundRect(ctx,x+8,y+8,w-16,h-16,20,false,true);

  // 红色倒三角
  const cx = x + w/2;
  const side = Math.min(w,h)*0.28;
  const topY = y + Math.round(h*0.22);
  ctx.fillStyle="#d32f2f"; ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx - side/1.15, topY + side*0.95);
  ctx.lineTo(cx + side/1.15, topY + side*0.95);
  ctx.closePath(); ctx.fill();

  // 文案（红色 + 字距）
  const tSize = Math.round(h*0.115), sSize = Math.round(h*0.072), eSize = Math.round(h*0.070);
  const trackT = Math.max(2, Math.round(tSize*0.03));
  const trackS = Math.max(1, Math.round(sSize*0.03));
  const trackE = Math.max(1, Math.round(eSize*0.025));

  ctx.fillStyle="#d32f2f"; ctx.textAlign="center";
  ctx.font=`800 ${tSize}px 'Noto Sans JP'`;
  wrapCenterTracked(ctx, spec.title||"止まれ", cx, y + Math.round(h*0.16), Math.round(w*0.82), Math.round(tSize*1.12), trackT);
  ctx.font=`700 ${sSize}px 'Noto Sans JP'`;
  wrapCenterTracked(ctx, spec.subtitle||"一時停止", cx, y + Math.round(h*0.36), Math.round(w*0.82), Math.round(sSize*1.20), trackS);
  if(spec.en){
    ctx.font=`700 ${eSize}px 'Noto Sans JP'`;
    wrapCenterTracked(ctx, spec.en, cx, y + Math.round(h*0.46), Math.round(w*0.82), Math.round(eSize*1.18), trackE);
  }
}

function drawExit(spec){
  ctx.fillStyle="#237F52"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.05);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  // 绿底 + 白头条
  const grad = ctx.createLinearGradient(x,y, x, y+h);
  grad.addColorStop(0, "#268a5c"); grad.addColorStop(1, "#237F52");
  ctx.fillStyle=grad; roundRect(ctx,x,y,w,h,26,true,false);

  const hh = Math.round(h*0.22);
  ctx.fillStyle="#fff"; roundRect(ctx,x+12,y+12,w-24,hh,16,true,false);

  // 标题（左对齐大字 + 微 tracking），正文（居中）
  const cx = x + w/2;
  ctx.fillStyle="#111"; ctx.textAlign="left"; ctx.font=`800 ${Math.round(hh*0.42)}px 'Noto Sans JP'`;
  const trackHead = Math.max(2, Math.round(hh*0.42*0.02));
  drawTrackedLine(ctx, spec.title||"非常口", x+28, y + Math.round(hh*0.58), trackHead);

  ctx.textAlign="center";
  ctx.fillStyle="#fff"; ctx.font=`700 ${Math.round(h*0.09)}px 'Noto Sans JP'`;
  wrapCenterTracked(ctx, spec.subtitle||"前に物を置かない", cx, y+hh+60, Math.round(w*0.86), Math.round(h*0.10), Math.round(h*0.09*0.02));
  if(spec.en){
    ctx.fillStyle="#e8f5ec"; ctx.font=`600 ${Math.round(h*0.06)}px 'Noto Sans JP'`;
    wrapCenterTracked(ctx, spec.en, cx, y+hh+140, Math.round(w*0.86), Math.round(h*0.08), Math.round(h*0.06*0.02));
  }
}

function drawBlue(spec){
  // 信息板：纯文字（与你样例一致），不画人物
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height)*0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  // 外白卡 + 细描边
  ctx.fillStyle="#fff"; roundRect(ctx,x,y,w,h,28,true,false);
  ctx.strokeStyle="#cfd8e1"; ctx.lineWidth=6; roundRect(ctx,x+6,y+6,w-16,h-16,24,false,true);

  // 内蓝板（淡底 + 粗边）
  const bx=x+26, by=y+26, bw=w-52, bh=h-52;
  ctx.fillStyle="#eaf2f9"; roundRect(ctx,bx,by,bw,bh,22,true,false);
  ctx.strokeStyle="#005387"; ctx.lineWidth=18; roundRect(ctx,bx+14,by+14,bw-28,bh-28,18,false,true);

  // 纯文字层级
  const cx = bx + bw/2;
  const tSize = Math.round(bh*0.23);
  const eSize = Math.round(bh*0.10);
  const sSize = Math.round(bh*0.085);
  const trackT = Math.max(2, Math.round(tSize*0.025));
  const trackE = Math.max(1, Math.round(eSize*0.02));
  const trackS = Math.max(1, Math.round(sSize*0.02));

  ctx.fillStyle="#005387"; ctx.textAlign="center"; ctx.font=`800 ${tSize}px 'Noto Sans JP'`;
  wrapCenterTracked(ctx, spec.title || "案内", cx, by + Math.round(bh*0.22), Math.round(bw*0.86), Math.round(tSize*1.18), trackT);

  if (spec.en){
    ctx.fillStyle="#2b2f38"; ctx.font=`600 ${eSize}px 'Noto Sans JP'`;
    wrapCenterTracked(ctx, spec.en, cx, by + Math.round(bh*0.56), Math.round(bw*0.80), Math.round(eSize*1.16), trackE);
  }
  if (spec.subtitle){
    ctx.fillStyle="#445"; ctx.font=`600 ${sSize}px 'Noto Sans JP'`;
    wrapCenterTracked(ctx, spec.subtitle, cx, by + Math.round(bh*0.72), Math.round(bw*0.82), Math.round(sSize*1.16), trackS);
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

  // Fallback：更稳的关键词推断（不暴露模板）
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

  // 明确不使用“人物”
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
