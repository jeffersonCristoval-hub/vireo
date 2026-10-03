const { redis, verifyInitData, MIN_WITHDRAW_NANO } = require('../lib/core.js');

// KEYS: balance, pending total, queue list, sequence | ARGV: min, uid, address, timestamp
// Moves the user's whole balance into a pending withdrawal request, atomically.
const LUA = `
local bal = tonumber(redis.call('GET', KEYS[1]) or '0')
if bal < tonumber(ARGV[1]) then return {0, bal} end
local amt = string.format('%d', bal)
redis.call('DECRBY', KEYS[1], amt)
redis.call('INCRBY', KEYS[2], amt)
local id = redis.call('INCR', KEYS[4])
local entry = '{"id":' .. id .. ',"uid":"' .. ARGV[2] .. '","addr":"' .. ARGV[3] .. '","amount":' .. amt .. ',"ts":' .. ARGV[4] .. ',"status":"pending"}'
redis.call('LPUSH', KEYS[3], entry)
return {1, bal, id}
`;

const ADDR = /^(-?\d{1,3}:[0-9a-fA-F]{64}|[A-Za-z0-9_-]{48})$/;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const user = verifyInitData(req.headers['x-telegram-init-data']);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const address = body && body.address;
    if (typeof address !== 'string' || !ADDR.test(address)) return res.status(400).json({ error: 'Invalid wallet address' });
    const uid = String(user.id);
    const r = await redis([
      'EVAL', LUA, '4',
      'bal:' + uid, 'pend:' + uid, 'wd:queue', 'wd:seq',
      String(MIN_WITHDRAW_NANO), uid, address, String(Math.floor(Date.now() / 1000))
    ]);
    if (r[0] !== 1) return res.status(400).json({ error: 'Minimum withdrawal is ' + MIN_WITHDRAW_NANO / 1e9 + ' TON' });
    return res.status(200).json({ ok: true, id: r[2], amount: r[1] });
  } catch (e) {
    console.error('withdraw error', e.message);
    return res.status(500).json({ error: 'server error' });
  }
};
