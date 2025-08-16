let engine;
(async () => {
  try{
    engine = await webllm.CreateWebWorkerEngine(
      new Worker("https://unpkg.com/@mlc-ai/web-llm/dist/worker.js",{type:"module"}),
      { model:"Llama-3.2-1B-Instruct-q4f32_1-MLC" }
    );
  }catch(e){console.warn("WebLLM init failed:",e);}
})();

const messagesEl=document.getElementById("messages"),
      promptEl=document.getElementById("prompt"),
      sendBtn=document.getElementById("send"),
      canvas=document.getElementById("poster"),
      ctx=canvas.getContext("2d"),
      dlBtn=document.getElementById("download");

function addMsg(role, text){
  const div=document.createElement("div");
  div.className="msg "+(role==="user"?"user":"bot");
  div.textContent=text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop=messagesEl.scrollHeight;
}

const SAFETY={
  warning:{base:"#F9A900"},
  prohibition:{base:"#C62828"},
  mandatory:{base:"#005387"},
  safe:{base:"#237F52"},
  fire:{base:"#C62828"},
  neutral:{base:"#2B2B2C"}
};

const SYSTEM_PROMPT=`あなたは倉庫安全ポスターのコピーライターです。
出力は必ず次のJSON：
{"title":"...","subtitle":"...","category":"warning|prohibition|mandatory|safe|fire|neutral","icon":"注意","size":"A3横|A3縦"}`;

// 简易绘制：色带 + 标题 + 副标题
function drawPoster(spec){
  const { title, subtitle, category } = spec;
  // 默认 A3 横向 @ ~150dpi
  canvas.width = 1404; canvas.height = 993;

  // 背景
  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // 顶部色带（根据类别）
  ctx.fillStyle=SAFETY[category]?.base || "#999";
  ctx.fillRect(0,0,canvas.width,160);

  // 文案
  ctx.fillStyle="#111";
  ctx.font="800 68px 'Noto Sans JP'";
  ctx.fillText(title,40,220);

  ctx.fillStyle="#333";
  ctx.font="600 34px 'Noto Sans JP'";
  ctx.fillText(subtitle,40,280);
}

async function generatePoster(userText){
  addMsg("user", userText);
  let json;
  if(engine){
    const reply = await engine.chat.completions.create({
      messages:[
        {role:"system",content:SYSTEM_PROMPT},
        {role:"user",content:userText}
      ],
      max_tokens: 200
    });
    try{ json = JSON.parse(reply.choices[0].message.content); }catch{}
  }
  if(!json) json = { title:"安全第一", subtitle:"周囲確認を徹底しましょう。", category:"warning" };

  addMsg("bot", `タイトル：${json.title}\n小見出し：${json.subtitle}\nカテゴリ：${json.category||"warning"}`);
  drawPoster(json);
}

sendBtn.onclick=()=>{ const t=promptEl.value.trim(); if(t) generatePoster(t); };
promptEl.addEventListener("keydown",e=>{ if(e.key==="Enter") sendBtn.click(); });
dlBtn.onclick=()=>{
  const url=canvas.toDataURL("image/png");
  const a=document.createElement("a");
  a.href=url; a.download="poster.png"; a.click();
};

// 初始海报
drawPoster({title:"安全第一", subtitle:"指差呼称・周囲確認・事故ゼロへ", category:"warning"});
