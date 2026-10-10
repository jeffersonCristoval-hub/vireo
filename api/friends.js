const { redis, pipeline, verifyInitData } = require('../lib/core.js');

// POST {code: "ref_<id>"} -> registers who invited this user (once, only for new users).
// GET -> the user's invited friends and how many are active (5+ ads watched).
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = verifyInitData(req.headers['x-telegram-init-data']);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const uid = String(user.id);

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
      }
      const m = /^ref_(\d{1,15})$/.exec(String((body && body.code) || ''));
      if (!m || m[1] === uid) return res.status(200).json({ ok: false });
      const refUid = m[1];
      const info = await pipeline([['GET', 'ref:by:' + uid], ['GET', 'joined:' + uid]]);
      const joined = Number(info[1] || 0);
      if (info[0] || !joined || Date.now() / 1000 - joined > 3 * 86400) return res.status(200).json({ ok: false });
      const set = await redis(['SET', 'ref:by:' + uid, refUid, 'NX']);
      if (set === 'OK') {
        const name = String(user.first_name || 'Friend').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 30) || 'Friend';
        await redis(['HSET', 'friends:' + refUid, uid, name]);
      }
      return res.status(200).json({ ok: set === 'OK' });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

    const raw = (await redis(['HGETALL', 'friends:' + uid])) || [];
    const all = [];
    if (Array.isArray(raw)) {
      for (let i = 0; i + 1 < raw.length; i += 2) all.push({ id: raw[i], name: raw[i + 1] });
    } else {
      Object.keys(raw).forEach((k) => all.push({ id: k, name: raw[k] }));
    }
    const shown = all.slice(0, 50);
    const ads = shown.length ? await pipeline(shown.map((f) => ['HGET', 'tot:' + f.id, 'ads'])) : [];
    const list = shown.map((f, i) => {
      const n = Number(ads[i] || 0);
      return { name: f.name, ads: n, active: n >= 5 };
    });
    return res.status(200).json({ invited: all.length, active: list.filter((f) => f.active).length, list });
  } catch (e) {
    console.error('friends error', e.message);
    return res.status(500).json({ error: 'server error' });
  }
};
