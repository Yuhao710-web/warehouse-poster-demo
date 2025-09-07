// /api/image.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { prompt, model = "black-forest-labs/FLUX.1-dev" } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt is required" });
    if (!process.env.HF_API_TOKEN) return res.status(500).json({ error: "HF_API_TOKEN missing" });

    const r = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.HF_API_TOKEN}`,
        "Content-Type": "application/json",
        "Accept": "image/png"
      },
      body: JSON.stringify({ inputs: prompt })
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(502).json({ error: `Provider error: ${errText}` });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    const b64 = `data:image/png;base64,${buf.toString("base64")}`;
    return res.status(200).json({ image: b64 });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
