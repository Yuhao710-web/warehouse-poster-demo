Last login: Sat Aug 16 13:34:11 on ttys000
w@WdeMacBook-Air ~ % >....                                                      
  try { json = JSON.parse(reply.choices[0].message.content); }
  catch(e){ json = { title:"安全第一", subtitle:"危険を見つけたらすぐ報告・合図 。周囲確認を徹底しましょう。", category:"warning", icon:"注意", size:"A3横" }; } 
  addMsg("assistant", `タイトル：${json.title}\n小見出し：${json.subtitle}\nカテゴリ：${json.category}\nアイコン：${json.icon}\nサイズ：${json.size}`);
  drawPoster(json);
}

sendBtn.onclick = ()=>{ const t=promptEl.value.trim(); if(t) generatePoster(t); };
promptEl.addEventListener("keydown",(e)=>{ if(e.key==="Enter") sendBtn.click(); });
dlBtn.onclick = ()=>{
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url; a.download = "poster.png"; a.click();
};

// 初始海报
drawPoster({ title:"安全第一", subtitle:"指差呼称・周囲確認・報告連絡で事故ゼロ へ。", category:"warning", icon:"注意", size:"A3横" });

