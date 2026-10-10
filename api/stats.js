const { redis, verifyInitData } = require('../lib/core.js');

// Returns the user's ad events, newest first, as [timestamp, nanoTON] pairs.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = verifyInitData(req.headers['x-telegram-init-data']);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const raw = await redis(['LRANGE', 'ev:' + String(user.id), '0', '2999']);
    const events = (raw || []).map((e) => {
      const p = String(e).split(':');
      return [Number(p[0]), Number(p[1])];
    });
    return res.status(200).json({ events });
  } catch (e) {
    console.error('stats error', e.message);
    return res.status(500).json({ error: 'server error' });
  }
};
