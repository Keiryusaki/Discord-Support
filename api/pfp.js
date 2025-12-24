import sharp from "sharp";

export default async function handler(req, res) {
  try {
    const { uid = "", avatar = "", decor = "", def = "" } = req.query;

    // ✅ NEW: tunable params
    const size = 512;
    const scale = Math.min(1, Math.max(0.6, parseFloat(req.query.scale ?? "0.88"))); // default 0.88
    const dy = parseInt(req.query.dy ?? "0", 10) || 0; // geser Y kalau perlu

    let avatarUrl = def;
    if (uid && avatar) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${uid}/${avatar}.png?size=${size}`;
    }
    if (!avatarUrl) return res.status(400).send("missing avatar");

    const a = await fetch(avatarUrl);
    if (!a.ok) return res.status(502).send("failed fetch avatar");
    const avatarBuf = Buffer.from(await a.arrayBuffer());

    // Base avatar
    let composed = sharp(avatarBuf).resize(size, size).png();

    // Overlay decoration (if any)
    if (decor) {
      const decorUrl =
        `https://cdn.discordapp.com/avatar-decoration-presets/${decor}.png?size=${size}&passthrough=false`;
      const d = await fetch(decorUrl);

      if (d.ok) {
        const decorBuf = Buffer.from(await d.arrayBuffer());
        const decorPng = await sharp(decorBuf).resize(size, size).png().toBuffer();
        composed = composed.composite([{ input: decorPng, top: 0, left: 0 }]);
      }
    }

    // ✅ NEW: add safe padding so circle mask doesn't cut edges
    const mergedBuf = await composed.png().toBuffer();

    const inner = Math.round(size * scale);
    const x = Math.round((size - inner) / 2);
    const y = Math.round((size - inner) / 2) + dy;

    const out = await sharp({
      create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite([
        { input: await sharp(mergedBuf).resize(inner, inner).png().toBuffer(), top: y, left: x }
      ])
      .png()
      .toBuffer();

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(out);
  } catch (e) {
    return res.status(500).send("error");
  }
}
