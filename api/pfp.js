import sharp from "sharp";

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// cache alpha mask per size biar irit
const alphaCache = new Map();

/**
 * Create 1-channel alpha mask (raw) for circle.
 * inside circle: 255, outside: 0
 */
function getCircleAlphaRaw(size) {
  if (alphaCache.has(size)) return alphaCache.get(size);

  const r = size / 2;
  const r2 = r * r;
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;

  const alpha = Buffer.alloc(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const inside = (dx * dx + dy * dy) <= r2;
      alpha[y * size + x] = inside ? 255 : 0;
    }
  }

  const obj = { alpha, size };
  alphaCache.set(size, obj);
  return obj;
}

export default async function handler(req, res) {
  try {
    const q = req.query ?? {};

    const uid = String(first(q.uid ?? "")).trim();        // {User.id}
    const avatar = String(first(q.avatar ?? "")).trim();  // {User.avatar}
    const decor = String(first(q.decor ?? "")).trim();    // {User.avatarDecorationData.asset}
    const def = String(first(q.def ?? "")).trim();        // {User.defaultAvatarURL} optional

    const size = clamp(parseInt(first(q.size ?? "512"), 10) || 512, 128, 1024);

    // ✅ avatar user lebih kecil (dekor tetap full)
    const avatarScale = clamp(parseFloat(first(q.avatarScale ?? "0.86")) || 0.86, 0.6, 1);
    const avatarDy = clamp(
      parseInt(first(q.avatarDy ?? "0"), 10) || 0,
      -Math.floor(size * 0.2),
      Math.floor(size * 0.2)
    );

    // 1) avatar URL
    let avatarUrl = def;
    if (uid && avatar) avatarUrl = `https://cdn.discordapp.com/avatars/${uid}/${avatar}.png?size=${size}`;
    if (!avatarUrl) avatarUrl = `https://cdn.discordapp.com/embed/avatars/0.png`;

    // 2) fetch avatar
    const a = await fetch(avatarUrl);
    if (!a.ok) return res.status(502).send("failed fetch avatar");
    const avatarBuf = Buffer.from(await a.arrayBuffer());

    // 3) resize avatar kecil + apply round alpha (JOIN CHANNEL, no dest-in)
    const inner = Math.round(size * avatarScale);
    const { alpha, size: alphaSize } = getCircleAlphaRaw(inner);

    // buat avatar RGB (tanpa alpha), lalu tambah alpha dari mask
    const avatarRounded = await sharp(avatarBuf)
      .resize(inner, inner)
      .removeAlpha() // jadi RGB
      .joinChannel(alpha, { raw: { width: alphaSize, height: alphaSize, channels: 1 } }) // tambah alpha
      .png()
      .toBuffer();

    // 4) canvas transparan + taruh avatar bulat di tengah
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
    res.setHeader("Cache-Control", "public, max-age=60"); // pendek dulu biar gampang test
    return res.status(200).send(outBuf);
  } catch (e) {
    return res.status(500).send("error");
  }
}
