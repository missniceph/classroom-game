// Run with: node tests/core.test.js
const assert = require('assert');
const CG = require('../js/core.js');
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

t('normalizeAnswer ignores case, spaces, punctuation, accents', () => {
  assert.strictEqual(CG.normalizeAnswer('  R.A.  No. 7160 '), 'rano7160');
  assert.strictEqual(CG.normalizeAnswer('Local  Government-Code!'), 'localgovernmentcode');
  assert.strictEqual(CG.normalizeAnswer('Parañaque'), 'paranaque');
});
t('isCorrect for each type', () => {
  const s = CG.sampleSet();
  assert.ok(CG.isCorrect(s.questions[0], 1));
  assert.ok(!CG.isCorrect(s.questions[0], 0));
  assert.ok(CG.isCorrect(s.questions[1], 1));
  assert.ok(CG.isCorrect(s.questions[2], 'r.a. no 7160'));
  assert.ok(CG.isCorrect(s.questions[2], 'local government code '));
  assert.ok(!CG.isCorrect(s.questions[2], 'Omnibus Election Code'));
  assert.ok(!CG.isCorrect(s.questions[2], '...'));
  assert.ok(CG.isCorrect(s.questions[2], 'LGU code', ['lgu code']));
});
t('pointsFor', () => {
  assert.strictEqual(CG.pointsFor(0, 20000), 1000);
  assert.strictEqual(CG.pointsFor(20000, 20000), 500);
  assert.strictEqual(CG.pointsFor(10000, 20000), 750);
  assert.strictEqual(CG.pointsFor(99999, 20000), 500);
});
t('sample set is valid', () => {
  const s = CG.sampleSet();
  assert.strictEqual(s.questions.length, 5);
  assert.deepStrictEqual(CG.validateSet(s), []);
  assert.deepStrictEqual([...new Set(s.questions.map(q => q.type))].sort(), ['id', 'mc', 'tf']);
  assert.ok(s.questions.some(q => q.trick));
});
t('parseText handles all types and options', () => {
  const r = CG.parseText(`Title: Lecture 3
# comment
Q: What is the minimum voting age?
A) 16
B) 18 *
C) 21
Time: 30
Explain: Article V, Section 1.

Q: The Senate has 24 members.
Answer: True
Trick: yes

Q: What law created LGUs' powers in 1991?
continued text
Answer: Local Government Code | RA 7160
Explain: line one
line two

2. Two options only
*A) Yes
B) No

Q: Which?
A) x
B) y
Answer: B
`);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.title, 'Lecture 3');
  assert.strictEqual(r.questions.length, 5);
  const [a, b, c, d, e] = r.questions;
  assert.strictEqual(a.type, 'mc'); assert.strictEqual(a.correct, 1); assert.strictEqual(a.time, 30); assert.deepStrictEqual(a.options, ['16', '18', '21']);
  assert.strictEqual(b.type, 'tf'); assert.strictEqual(b.correct, 0); assert.ok(b.trick);
  assert.strictEqual(c.type, 'id'); assert.deepStrictEqual(c.accepted, ['Local Government Code', 'RA 7160']);
  assert.strictEqual(c.text, "What law created LGUs' powers in 1991? continued text");
  assert.strictEqual(c.explanation, 'line one line two');
  assert.strictEqual(d.type, 'mc'); assert.strictEqual(d.correct, 0);
  assert.strictEqual(e.correct, 1);
});
t('parseText reports errors with line numbers', () => {
  const r = CG.parseText(`hello\nQ: no answer\nA) one\nB) two\n\nQ: ok\nAnswer: False\n\nQ: bad time\nAnswer: x\nTime: 2`);
  assert.strictEqual(r.questions.length, 1);
  assert.strictEqual(r.errors.length, 3);
  assert.strictEqual(r.errors[0].line, 1);
  assert.strictEqual(r.errors[1].line, 2);
  assert.strictEqual(r.errors[2].line, 11);
});
t('toText round-trips through parseText', () => {
  const s = CG.sampleSet();
  const r = CG.parseText(CG.toText(s));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.title, s.title);
  const strip = q => { const c = Object.assign({}, q); delete c.id; return c; };
  assert.deepStrictEqual(r.questions.map(strip), s.questions.map(strip));
});
t('csv escapes and guards formulas', () => {
  const csv = CG.toCSV([['Nickname', 'Score'], ['=cmd', 5], ['a,"b"', 1]]);
  assert.ok(csv.startsWith('﻿Nickname,Score\r\n'));
  assert.ok(csv.includes("'=cmd,5"));
  assert.ok(csv.includes('"a,""b""",1'));
});
t('rank shares ties', () => {
  const r = CG.rank([{ score: 5 }, { score: 9 }, { score: 5 }, { score: 1 }]);
  assert.deepStrictEqual(r.map(x => x.rank), [1, 2, 2, 4]);
});
t('room codes', () => {
  const c = CG.makeRoomCode();
  assert.strictEqual(c.length, 5);
  assert.strictEqual(CG.cleanRoomCode(' k7m-4q '), 'K7M4Q');
  assert.strictEqual(CG.cleanName('  <b>Juan   dela Cruz</b> extra long name here '), 'bJuan dela Cruz/b ex');
  assert.strictEqual(CG.cleanName('abcdefghijklmnopqrs tuv'), 'abcdefghijklmnopqrs');
});
console.log(`\n${n} tests passed`);
