import sharp from "sharp";

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

// Create circle mask - white circle on transparent background
function createCircleMaskSvg(size) {
  return Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>
    </svg>
  `);
}

export default async function handler(req, res) {
  try {
    const q = req.query ?? {};

    const uid = String(first(q.uid ?? "")).trim();        // {User.id}
    const avatar = String(first(q.avatar ?? "")).trim();  // {User.avatar}
    const decor = String(first(q.decor ?? "")).trim();    // {User.avatarDecorationData.asset}
    const def = String(first(q.def ?? "")).trim();        // {User.defaultAvatarURL} optional

    const size = 512;

    // avatar URL
    let avatarUrl = def;
    if (uid && avatar) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${uid}/${avatar}.png?size=${size}`;
    }
    if (!avatarUrl) {
      avatarUrl = `https://cdn.discordapp.com/embed/avatars/0.png`;
    }

    // fetch avatar
    const a = await fetch(avatarUrl);
    if (!a.ok) return res.status(502).send("failed fetch avatar");
    const avatarBuf = Buffer.from(await a.arrayBuffer());

    // Avatar size settings - scale down to fit inside decoration
    const avatarSize = 400; // smaller to fit inside decoration frame
    const offset = Math.floor((size - avatarSize) / 2); // center offset

    // Resize avatar
    const resizedAvatar = await sharp(avatarBuf)
      .resize(avatarSize, avatarSize)
      .ensureAlpha()
      .png()
      .toBuffer();
    
    // Create circle mask PNG
    const maskPng = await sharp(createCircleMaskSvg(avatarSize))
      .resize(avatarSize, avatarSize)
      .ensureAlpha()
      .png()
      .toBuffer();

    // Apply circular mask - composite avatar with mask
    const circularAvatar = await sharp(resizedAvatar)
      .composite([{
        input: maskPng,
        blend: "dest-in"
      }])
      .png()
      .toBuffer();

    // Create base canvas with circular avatar centered
    let base = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // transparent
      },
    })
      .png()
      .composite([{ input: circularAvatar, top: offset, left: offset }]);

    // overlay decoration (full size)
    if (decor) {
      const decorUrl = `https://cdn.discordapp.com/avatar-decoration-presets/${decor}.png?size=${size}&passthrough=false`;
      const d = await fetch(decorUrl);

      if (d.ok) {
        const decorBuf = Buffer.from(await d.arrayBuffer());
        const decorPng = await sharp(decorBuf).resize(size, size).png().toBuffer();
        base = base.composite([{ input: decorPng, top: 0, left: 0 }]);
      }
    }

    const out = await base.png().toBuffer();

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store"); // biar gak ke-cache pas reset
    return res.status(200).send(out);
  } catch (e) {
    console.error(e);
    return res.status(500).send("error");
  }
}
