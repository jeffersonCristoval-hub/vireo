const crypto = require('crypto');
const { redis, verifyInitData, hmacHex, safeEqual, VERIFY_TTL } = require('../lib/core.js');

const ENGLISH = [
  ['Opposite of "hot"?', 'cold'],
  ['Opposite of "up"?', 'down'],
  ['Opposite of "day"?', 'night'],
  ['Opposite of "happy"?', 'sad'],
  ['Opposite of "full"?', 'empty'],
  ['Complete the word: AP_LE', 'p'],
  ['Complete the word: BAN_NA', 'a'],
  ['Complete the word: ORAN_E', 'g'],
  ['Complete the word: TABL_', 'e'],
  ['Complete the word: GRE_N', 'e'],
  ['Plural of "cat"?', 'cats'],
  ['Plural of "dog"?', 'dogs'],
  ['Type "pot" backwards', 'top'],
  ['Type "god" backwards', 'dog'],
  ['Which is a fruit: apple or chair?', 'apple'],
  ['Which is an animal: table or horse?', 'horse'],
  ['Which is a colour: red or desk?', 'red'],
  ['How many letters in "water"?', '5'],
  ['How many letters in "orange"?', '6'],
  ['First letter of the word "ocean"?', 'o'],
  ['Last letter of the word "money"?', 'y'],
  ['Spell the number 3 in words', 'three'],
  ['Spell the number 7 in words', 'seven'],
  ['Spell the number 9 in words', 'nine']
];

const pick = (n) => crypto.randomInt(n);
const rnd = (min, max) => crypto.randomInt(min, max + 1);
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

function makeChallenge() {
  if (pick(2) === 0) {
    const t = pick(3);
    if (t === 0) { const x = rnd(3, 15), y = rnd(2, 12); return { q: x + ' + ' + y + ' = ?', a: String(x + y) }; }
    if (t === 1) { const x = rnd(10, 25), y = rnd(2, 9); return { q: x + ' - ' + y + ' = ?', a: String(x - y) }; }
    const x = rnd(2, 9), y = rnd(2, 9);
    return { q: x + ' x ' + y + ' = ?', a: String(x * y) };
  }
  const item = ENGLISH[pick(ENGLISH.length)];
  return { q: item[0], a: item[1] };
}

// GET  -> a signed question (math or English). The answer is never sent to the client.
// POST -> checks the answer and, if right, marks the user as verified for the session.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = verifyInitData(req.headers['x-telegram-init-data']);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const uid = String(user.id);

    if (req.method === 'GET') {
      const c = makeChallenge();
      const exp = Date.now() + 5 * 60 * 1000;
      return res.status(200).json({ token: exp + '.' + hmacHex(uid + '|' + exp + '|' + norm(c.a)), question: c.q });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

    const tries = await redis(['INCR', 'vtry:' + uid]);
    if (tries === 1) await redis(['EXPIRE', 'vtry:' + uid, '600']);
    if (tries > 10) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const parts = String((body && body.token) || '').split('.');
    const exp = Number(parts[0]);
    const answer = norm(body && body.answer);
    if (parts.length !== 2 || !exp || exp < Date.now()) return res.status(400).json({ error: 'That question expired. Here is a new one.' });
    if (!answer || !safeEqual(hmacHex(uid + '|' + exp + '|' + answer), parts[1])) {
      return res.status(400).json({ error: 'Not quite. Try this one.' });
    }
    await redis(['SET', 'verified:' + uid, '1', 'EX', String(VERIFY_TTL)]);
    await redis(['DEL', 'vtry:' + uid]);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('verify error', e.message);
    return res.status(500).json({ error: 'server error' });
  }
};
