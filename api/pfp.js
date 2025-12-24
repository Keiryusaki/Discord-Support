import sharp from "sharp";

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export default async function handler(req, res) {
  try {
    const q = req.query ?? {};

    const uid = String(first(q.uid ?? "")).trim();        // {User.id}
    const avatar = String(first(q.avatar ?? "")).trim();  // {User.avatar}
    const decor = String(first(q.decor ?? "")).trim();    // {User.avatarDecorationData.asset}
    const def = String(first(q.def ?? "")).trim();        // {User.defaultAvatarURL} optional

    const size = clamp(parseInt(first(q.size ?? "512"), 10) || 512, 128, 1024);

    // ✅ avatar dibuat lebih kecil
    const avatarScale = clamp(parseFloat(first(q.avatarScale ?? "0.85")) || 0.85, 0.6, 1);
    const avatarDy = clamp(parseInt(first(q.avatarDy ?? "0"), 10) || 0, -Math.floor(size * 0.2), Math.floor(size * 0.2));

    // 1) avatar URL
    let avatarUrl = def;
    if (uid && avatar) avatarUrl = `https://cdn.discordapp.com/avatars/${uid}/${avatar}.png?size=${size}`;
    if (!avatarUrl) avatarUrl = `https://cdn.discordapp.com/embed/avatars/0.png`;

    // 2) fetch avatar
    const a = await fetch(avatarUrl);
    if (!a.ok) return res.status(502).send("failed fetch avatar");
    const avatarBuf = Buffer.from(await a.arrayBuffer());

    // 3) bikin avatar kecil + FULL ROUND (mask di avatar doang)
    const inner = Math.round(size * avatarScale);
    const r = inner / 2;
    const circleMask = Buffer.from(`
<svg width="${inner}" height="${inner}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${r}" cy="${r}" r="${r}" fill="white"/>
</svg>`);

    const avatarRounded = await sharp(avatarBuf)
      .resize(inner, inner)
      .png()
      .composite([{ input: circleMask, blend: "dest-in" }]) // ✅ round avatar only
      .toBuffer();

    // 4) canvas transparan
    const x = Math.round((size - inner) / 2);
    let y = Math.round((size - inner) / 2) + avatarDy;
    y = clamp(y, 0, size - inner);

    let canvas = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{ input: avatarRounded, top: y, left: x }]);

    // 5) dekorasi: biarkan apa adanya (full size overlay)
    if (decor) {
      const decorUrl = `https://cdn.discordapp.com/avatar-decoration-presets/${decor}.png?size=${size}&passthrough=false`;
      const d = await fetch(decorUrl);
      if (d.ok) {
        const decorBuf = Buffer.from(await d.arrayBuffer());
        const decorPng = await sharp(decorBuf).resize(size, size).png().toBuffer();
        canvas = canvas.composite([{ input: decorPng, top: 0, left: 0 }]);
      }
    }

    const outBuf = await canvas.png().toBuffer();

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(outBuf);
  } catch (e) {
    return res.status(500).send("error");
  }
}
