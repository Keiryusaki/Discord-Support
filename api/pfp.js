import sharp from "sharp";

export default async function handler(req, res) {
  try {
    const { uid = "", avatar = "", decor = "", def = "" } = req.query;

    // avatar url
    let avatarUrl = def;
    if (uid && avatar) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${uid}/${avatar}.png?size=512`;
    }
    if (!avatarUrl) return res.status(400).send("missing avatar");

    // fetch avatar
    const a = await fetch(avatarUrl);
    if (!a.ok) return res.status(502).send("failed fetch avatar");
    const avatarBuf = Buffer.from(await a.arrayBuffer());

    // base 512x512
    let base = sharp(avatarBuf).resize(512, 512).png();

    // overlay decoration if exists
    if (decor) {
      const decorUrl =
        `https://cdn.discordapp.com/avatar-decoration-presets/${decor}.png?size=512&passthrough=false`;

      const d = await fetch(decorUrl);
      if (d.ok) {
        const decorBuf = Buffer.from(await d.arrayBuffer());
        const decorPng = await sharp(decorBuf).resize(512, 512).png().toBuffer();
        base = base.composite([{ input: decorPng, top: 0, left: 0 }]);
      }
    }

    const out = await base.png().toBuffer();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(out);
  } catch {
    return res.status(500).send("error");
  }
}
