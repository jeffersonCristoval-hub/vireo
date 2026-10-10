const crypto = require('crypto');

const BASE = (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.KV_REST_API_TOKEN || '';

const DAILY_CAP = 20;
// 1 TON = 1,000,000,000 nanoTON. Default reward: 0.001 TON per completed ad.
const REWARD_NANO = parseInt(process.env.REWARD_NANO || '1000000', 10);
// Default minimum withdrawal: 0.5 TON.
const MIN_WITHDRAW_NANO = parseInt(process.env.MIN_WITHDRAW_NANO || '500000000', 10);
const DAY_TTL = 60 * 60 * 24 * 400;
const VERIFY_TTL = 60 * 60 * 6;

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function redis(cmd) {
  const data = await post('', cmd);
  if (!data || data.error) throw new Error('redis error: ' + (data && data.error));
  return data.result;
}

async function pipeline(cmds) {
  const data = await post('/pipeline', cmds);
  if (!Array.isArray(data)) throw new Error('redis pipeline error');
  return data.map((r) => {
    if (r.error) throw new Error('redis error: ' + r.error);
    return r.result;
  });
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function lastDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  return out;
}

// Validates Telegram Mini App initData (HMAC-SHA256 with the bot token). Returns the user object or null.
function verifyInitData(initData) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken || !initData || typeof initData !== 'string') return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const pairs = [];
    for (const [k, v] of params.entries()) pairs.push(k + '=' + v);
    pairs.sort();
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calc = crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest();
    const given = Buffer.from(hash, 'hex');
    if (given.length !== calc.length || !crypto.timingSafeEqual(given, calc)) return null;
    const authDate = Number(params.get('auth_date'));
    if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
    const user = JSON.parse(params.get('user'));
    if (!user || !user.id) return null;
    return user;
  } catch (e) {
    return null;
  }
}

// Signs verification tokens with a key derived from the bot token (server-side only).
function hmacHex(data) {
  const key = crypto.createHmac('sha256', 'vireo-verify').update(process.env.TELEGRAM_BOT_TOKEN || '').digest();
  return crypto.createHmac('sha256', key).update(String(data)).digest('hex');
}

module.exports = { redis, pipeline, safeEqual, lastDays, verifyInitData, DAILY_CAP, REWARD_NANO, MIN_WITHDRAW_NANO, DAY_TTL, VERIFY_TTL, hmacHex };
