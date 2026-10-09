const { pipeline, verifyInitData, lastDays, DAILY_CAP, REWARD_NANO, MIN_WITHDRAW_NANO } = require('../lib/core.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = verifyInitData(req.headers['x-telegram-init-data']);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const uid = String(user.id);
    const dates = lastDays(7);
    const out = await pipeline([
      ['GET', 'bal:' + uid],
      ['GET', 'pend:' + uid],
      ...dates.map((d) => ['HMGET', 'day:' + uid + ':' + d, 'ads', 'nano']),
      ['LRANGE', 'ev:' + uid, '0', '4']
    ]);
    const days = dates.map((d, i) => ({
      date: d,
      ads: Number(out[2 + i][0] || 0),
      nano: Number(out[2 + i][1] || 0)
    }));
    const recent = (out[9] || []).map((e) => {
      const parts = String(e).split(':');
      return { ts: Number(parts[0]), nano: Number(parts[1]) };
    });
    const today = days[days.length - 1];
    return res.status(200).json({
      balance: Number(out[0] || 0),
      pending: Number(out[1] || 0),
      today: { ads: today.ads, nano: today.nano },
      days,
      recent,
      limit: DAILY_CAP,
      reward: REWARD_NANO,
      minWithdraw: MIN_WITHDRAW_NANO
    });
  } catch (e) {
    console.error('me error', e.message);
    return res.status(500).json({ error: 'server error' });
  }
};
