const { redis, safeEqual, lastDays, REWARD_NANO, DAILY_CAP, DAY_TTL } = require('../lib/core.js');

// KEYS: balance, today's hash, total credited, recent events | ARGV: reward, daily cap, ttl, timestamp
const LUA = `
local n = redis.call('HINCRBY', KEYS[2], 'ads', 1)
if n == 1 then redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3])) end
if n > tonumber(ARGV[2]) then
  redis.call('HINCRBY', KEYS[2], 'ads', -1)
  return {0, n - 1}
end
redis.call('HINCRBY', KEYS[2], 'nano', ARGV[1])
redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('INCRBY', KEYS[3], ARGV[1])
redis.call('LPUSH', KEYS[4], ARGV[4] .. ':' .. ARGV[1])
redis.call('LTRIM', KEYS[4], 0, 19)
return {1, n}
`;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const expected = process.env.ADSGRAM_SECRET;
    if (!expected) return res.status(500).json({ ok: false, error: 'server not configured' });
    const q = req.query || {};
    if (!q.secret || !safeEqual(q.secret, expected)) return res.status(403).json({ ok: false });
    const uid = String(q.userid || '');
    if (!/^\d{1,15}$/.test(uid)) return res.status(400).json({ ok: false });
    const today = lastDays(1)[0];
    const r = await redis([
      'EVAL', LUA, '4',
      'bal:' + uid, 'day:' + uid + ':' + today, 'stat:credited', 'ev:' + uid,
      String(REWARD_NANO), String(DAILY_CAP), String(DAY_TTL), String(Math.floor(Date.now() / 1000))
    ]);
    return res.status(200).json({ ok: true, credited: r[0] === 1 });
  } catch (e) {
    console.error('adsgram-reward error', e.message);
    return res.status(500).json({ ok: false });
  }
};
