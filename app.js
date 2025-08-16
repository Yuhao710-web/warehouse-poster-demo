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

// =================== 5) 五种风格渲染（更像你的样例；不画人物；柔和色 & 加大行距） ===================

// === 1) 注意（黄）— 行距加大 + 柔和黄 + 更淡斜纹 ===
function drawCaution(spec){
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);

  const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.06);
  const x=pad, y=pad, w=canvas.width-pad*2, h=canvas.height-pad*2;

  // 白卡 + 轻阴影
  ctx.save(); ctx.shadowColor="rgba(0,0,0,.08)"; ctx.shadowBlur=24; ctx.shadowOffsetY=10;
  ctx.fillStyle="#fff"; roundRect(ctx,x,y,w,h,26,true,false); ctx.restore();

  // 更柔和的黄 + 更淡的斜纹
  const inPad = Math.round(Math.min(w,h)*0.06);
  const ix=x+inPad, iy=y+inPad, iw=w-inPad*2, ih=h-inPad*2;
  const grad = ctx.createLinearGradient(ix,iy, ix, iy+ih);
  grad.addColorStop(0, "#f7de88");  // softer top
  grad.addColorStop(1, "#f6d66e");  // softer bottom
  ctx.fillStyle = grad; roundRect(ctx,ix,iy,iw,ih,20,true,false);

  ctx.save(); ctx.fillStyle = stripePattern("#000", "rgba(0,0,0,0)"); ctx.globalAlpha=0.14; // 更淡
  roundRect(ctx,ix+16,iy+16,iw-32,ih-32,16,true,false); ctx.restore();

  // 文案（增大行距；稍减字距）
  const cx = x + w/2;
  const tSize = Math.round(ih*0.19);
  const sSize = Math.round(ih*0.10);
  const eSize = Math.round(ih*0.085);
  const trackTitle = Math.max(2, Math.round(tSize*0.020)); // ↓ 由 0.03 调柔
  const trackSub   = Math.max(1, Math.round(sSize*0.018));
  const trackEn    = Math.max(1, Math.round(eSize*0.018));

  ctx.fillStyle="#1a1a1a"; ctx.textAlign="center";
  ctx.font=`800 ${tSize}px 'Noto Sans JP'`;
  wrapCenterTracked(ctx, spec.title||"通行注意", cx, iy + Math.round(ih*0.30), Math.round(iw*0.86), Math.round(tSize*1.26), trackTitle);

  ctx.font=`700 ${sSize}px 'Noto Sans JP'`;
  wrapCenterTracked(ctx, spec.subtitle||"走行車両あり。周囲確認を徹底。", cx, iy + Math.round(ih*0.52), Math.round(iw*0.88), Math.round(sSize*1.34), trackSub);

  if(spec.en){
    ctx.fillStyle="#2a2a2a"; ctx.font=`600 ${eSize}px 'Noto Sans JP'`;
    wrapCenterTracked(ctx, spec.en, cx, iy + Math.round(ih*0.70), Math.round(iw*0.84), Math.round(eSize*1.30), trackEn);
  }
}

// === 2) 禁止（红）— 行距加大 + 柔和红 + 更淡斜纹 ===
function drawProhibit(spec){
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.06);
  const x=pad,y=pad,w=canvas.width-pad*2,h=canvas.height-pad*2;

  ctx.save(); ctx.shadowColor="rgba(0,0,0,.08)"; ctx.shadowBlur=24; ctx.shadowOffsetY=10;
  ctx.fillStyle="#fff"; roundRect(ctx,x,y,w,h,26,true,false); ctx.restore();

  const inPad = Math.round(Math.min(w,h)*0.06);
  const ix=x+inPad, iy=y+inPad, iw=w-inPad*2, ih=h-inPad*2;
  const grad = ctx.createLinearGradient(ix,iy, ix, iy+ih);
  grad.addColorStop(0, "#d95a5a");  // softer top red
  grad.addColorStop(1, "#cf4444");  // softer bottom red
  ctx.fillStyle=grad; roundRect(ctx,ix,iy,iw,ih,20,true,false);

  ctx.save(); ctx.fillStyle = stripePattern("#fff", "rgba(0,0,0,0)"); ctx.globalAlpha=0.20; // ↓ 由 0.27
  roundRect(ctx,ix+18,iy+18,iw-36,ih-36,16,

