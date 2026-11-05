// Tests the teacher-side screens that don't need phones: set editor, paste format,
// duplicate/delete, JSON export/import and Projector mode.
// Run: npm install && node e2e-host-ui.test.js   (set SHOTS=/some/dir to save screenshots)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { startServers, launch, newContext } = require('./harness');

const SHOTS = process.env.SHOTS;
const log = (...a) => console.log('•', ...a);
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); }

(async () => {
  const srv = await startServers(8124, 9124);
  const browser = await launch();
  const errors = [];
  try {
    const ctx = await newContext(browser, { viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(srv.base + 'host.html');
    await page.waitForSelector('.set-card');
    const sets = () => page.evaluate(() => JSON.parse(localStorage.getItem('classroomgame.sets.v1')));

    // ---------- New set in the editor ----------
    await page.click('#btnNewSet');
    await page.fill('#setTitle', 'Lecture 2: The State');
    const card = (i) => page.locator('.q-card').nth(i);
    await card(0).locator('[data-f=text]').fill('Which is NOT an element of the State?');
    for (const [k, v] of ['People', 'Territory', 'Government', 'Religion'].entries()) await card(0).locator(`[data-f=opt][data-k="${k}"]`).fill(v);
    await card(0).locator('[data-f=correct][value="3"]').check();
    await card(0).locator('[data-f=time]').fill('30');
    await card(0).locator('[data-f=time]').press('Tab');
    await card(0).locator('[data-f=explanation]').fill('The four elements are people, territory, government and sovereignty.');
    // Identification question
    await page.click('[data-add=id]');
    await card(1).locator('[data-f=text]').fill('What is the supreme power of the State to govern itself?');
    await card(1).locator('[data-f=accepted]').fill('Sovereignty\nsoberanya');
    await card(1).locator('[data-f=trick]').check();
    // True/false question, left without text to check validation
    await page.click('[data-add=tf]');
    assert.match(await page.textContent('#editorCount'), /3 questions · ⚠ 1 need fixing/);
    await card(2).locator('[data-f=correct][value="1"]').check();
    await card(2).locator('[data-f=text]').fill('A state can exist without territory.');
    assert.match(await page.textContent('#editorCount'), /ready to play/);
    // Reorder: move T/F up
    await card(2).locator('[data-act=up]').click();
    await page.waitForTimeout(600);
    await shot(page, '20-editor');
    let s = (await sets()).find((x) => x.title === 'Lecture 2: The State');
    assert.ok(s, 'set saved');
    assert.deepStrictEqual(s.questions.map((q) => q.type), ['mc', 'tf', 'id']);
    assert.strictEqual(s.questions[0].correct, 3);
    assert.strictEqual(s.questions[0].time, 30);
    assert.deepStrictEqual(s.questions[2].accepted, ['Sovereignty', 'soberanya']);
    assert.strictEqual(s.questions[2].trick, true);
    assert.strictEqual(s.questions[1].correct, 1);
    log('editor creates and autosaves all three question types');

    // Change type MC -> identification keeps the correct option as the answer
    await card(0).locator('[data-f=type]').selectOption('id');
    assert.strictEqual(await card(0).locator('[data-f=accepted]').inputValue(), 'Religion');
    await card(0).locator('[data-f=type]').selectOption('mc');
    log('changing question type works');

    // ---------- Paste more questions into this set ----------
    await page.click('#btnEditorPaste');
    await page.fill('#pasteText', `Q: Who wrote "The Social Contract"?
A) Hobbes
B) Locke
C) Rousseau *
Time: 15

Q: Sovereignty can be divided.
Answer: False

Q: this one is broken
A) only one option *`);
    assert.match(await page.textContent('#pasteReport'), /2 questions ready/);
    assert.match(await page.textContent('#pasteReport'), /Line 10: Multiple choice needs 2 to 4 options/);
    await shot(page, '21-paste-dialog');
    await page.click('#pasteOk');
    await page.waitForFunction(() => document.querySelectorAll('.q-card').length === 5);
    log('paste adds good questions and reports the bad one with its line number');

    // ---------- Copy as text (clipboard) ----------
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('#btnEditorCopyText');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(text, /^Title: Lecture 2: The State/);
    assert.match(text, /D\) Religion \*/);
    assert.match(text, /Answer: Sovereignty \| soberanya\nTime: 20\n|Answer: Sovereignty \| soberanya\n/);
    log('copy as text works');

    // ---------- Back home: duplicate, delete ----------
    await page.click('#btnEditorBack');
    await page.waitForSelector('.set-card');
    const before = (await sets()).length;
    await page.locator('.set-card', { hasText: 'Lecture 2: The State' }).locator('[data-act=dup]').click();
    assert.strictEqual((await sets()).length, before + 1);
    assert.ok((await sets()).some((x) => x.title === 'Lecture 2: The State (copy)'));
    await page.locator('.set-card', { hasText: 'Lecture 2: The State (copy)' }).locator('[data-act=delete]').click();
    assert.strictEqual((await sets()).length, before);
    log('duplicate and delete work');

    // ---------- New set straight from the paste dialog ----------
    await page.click('#btnPaste');
    await page.click('#pasteExample');
    await page.click('#pasteOk');
    await page.waitForSelector('#view-editor:not([hidden])');
    assert.strictEqual(await page.inputValue('#setTitle'), 'Lecture 4 — Suffrage');
    await page.click('#btnEditorBack');
    await shot(page, '22-home');

    // ---------- Export all, wipe, import ----------
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExportAll')]);
    assert.match(dl.suggestedFilename(), /^classroom-game-backup-\d{4}-\d\d-\d\d\.json$/);
    const backupPath = path.join(path.dirname(await dl.path()), 'backup.json');
    fs.copyFileSync(await dl.path(), backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert.strictEqual(backup.app, 'classroom-game');
    assert.strictEqual(backup.sets.length, 3);
    // Simulate a different laptop: empty storage
    await page.evaluate(() => { localStorage.setItem('classroomgame.sets.v1', '[]'); });
    await page.reload();
    await page.waitForSelector('.empty');
    await page.setInputFiles('#importFile', backupPath);
    await page.waitForFunction(() => document.querySelectorAll('.set-card').length === 3);
    // Importing again asks; our dialog handler says OK = replace, so still 3
    await page.setInputFiles('#importFile', backupPath);
    await page.waitForTimeout(300);
    assert.strictEqual(await page.locator('.set-card').count(), 3);
    log('export → import round trip works');

    // ---------- Projector mode ----------
    await page.locator('.set-card', { hasText: 'Sample' }).locator('[data-act=projector]').click();
    await page.waitForSelector('#teamInputs');
    await page.fill('[data-team="0"]', 'Mabini');
    await page.fill('[data-team="1"]', 'Rizal');
    await page.click('[data-team="3"] ~ [data-rm]');
    await shot(page, '23-projector-setup');
    await page.click('[data-pcmd=begin]');
    await page.waitForSelector('#teamStrip .team-tile');
    assert.strictEqual(await page.locator('.team-tile').count(), 3);
    assert.strictEqual(await page.locator('#projStage .option').count(), 0, 'options hidden at first');
    await page.keyboard.press('Space'); // show options
    assert.strictEqual(await page.locator('#projStage .option').count(), 4);
    await page.keyboard.press('t'); // start timer
    await page.waitForTimeout(1200);
    const t = Number(await page.textContent('#pTimerNum'));
    assert.ok(t < 20 && t > 15, 'timer counts down: ' + t);
    await shot(page, '24-projector-question');
    await page.keyboard.press('Space'); // reveal
    assert.strictEqual(await page.locator('#projStage .option.right').count(), 1);
    await page.click('[data-tadd="0"]');
    await page.click('[data-tadd="0"]');
    await page.keyboard.press('2');
    await page.click('[data-tsub="0"]');
    await shot(page, '25-projector-reveal');
    let ps = await page.evaluate(() => JSON.parse(localStorage.getItem('classroomgame.projector.v1')));
    assert.deepStrictEqual(ps.teams.map((x) => x.score), [1, 1, 0]);
    log('projector: reveal + tap to score works');

    // Refresh mid-game → resume
    await page.reload();
    await page.click('#btnResumeProj');
    await page.waitForSelector('#teamStrip .team-tile');
    assert.strictEqual(await page.textContent('.team-tile.team-0 .tscore'), '1');
    // Walk to the end: Q2..Q5
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Space'); // next question
      const isId = await page.locator('.id-prompt').count();
      if (!isId) await page.keyboard.press('Space'); // show options
      await page.keyboard.press('Space'); // reveal
      if (i === 2) { await page.waitForSelector('.trick-overlay'); await shot(page, '26-projector-trick'); }
      await page.keyboard.press('1');
    }
    await page.keyboard.press('Space'); // final standings
    await page.waitForSelector('.podium');
    await page.waitForTimeout(2000);
    await shot(page, '27-projector-final');
    assert.match(await page.textContent('.pod.p1'), /Mabini/);
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-pcmd=csv]')]);
    const csv = fs.readFileSync(await dl2.path(), 'utf8');
    assert.strictEqual(csv.replace(/^﻿/, '').trim().split(/\r\n/).join('|'), 'Rank,Team,Score|1,Mabini,5|2,Rizal,1|3,Team 3,0');
    await page.click('[data-pcmd=exit]');
    await page.waitForSelector('.history-item');
    log('projector: resume after refresh, final standings, team CSV');

    assert.deepStrictEqual(errors, [], 'no JavaScript errors');
    console.log('\nHOST UI TEST PASSED');
  } catch (e) {
    console.error('FAILED:', e);
    console.error('page errors:', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
    process.exit();
  }
})();
