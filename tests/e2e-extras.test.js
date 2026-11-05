// Every remaining button and edge case not covered by the other two end-to-end tests.
// Run: npm install && node e2e-extras.test.js
const assert = require('assert');
const fs = require('fs');
const { startServers, launch, newContext, devices } = require('./harness');
const log = (...a) => console.log('•', ...a);

(async () => {
  const srv = await startServers(8127, 9127);
  const browser = await launch();
  const errors = [];
  let dialogAnswer = true; // what confirm() dialogs answer
  try {
    const hctx = await newContext(browser, { viewport: { width: 1280, height: 800 } });
    const host = await hctx.newPage();
    host.on('pageerror', (e) => errors.push('host: ' + e.message));
    host.on('dialog', (d) => (dialogAnswer || d.type() === 'alert' ? d.accept() : d.dismiss()));
    await host.goto(srv.base + 'host.html?' + srv.peerParam);
    await host.waitForSelector('.set-card');
    const sets = () => host.evaluate(() => JSON.parse(localStorage.getItem('classroomgame.sets.v1')));

    // ---------- Empty state → "Add the sample set" ----------
    await host.click('.set-card [data-act=delete]');
    await host.waitForSelector('[data-home=sample]');
    await host.click('[data-home=sample]');
    await host.waitForSelector('.set-card');
    log('empty state + add sample set');

    // ---------- Export one set; import it again choosing "keep both" ----------
    const [dl] = await Promise.all([host.waitForEvent('download'), host.click('.set-card [data-act=export]')]);
    assert.match(dl.suggestedFilename(), /^classroom-game-Sample-Citizenship.*\.json$/);
    const one = dl.suggestedFilename();
    fs.copyFileSync(await dl.path(), '/tmp/' + one);
    dialogAnswer = false; // Cancel = keep both
    await host.setInputFiles('#importFile', '/tmp/' + one);
    await host.waitForFunction(() => document.querySelectorAll('.set-card').length === 2);
    assert.ok((await sets()).some((s) => / \(imported\)$/.test(s.title)));
    dialogAnswer = true;
    // A file that is not a backup is refused politely
    fs.writeFileSync('/tmp/not-a-backup.json', '{"hello": 1}');
    await host.setInputFiles('#importFile', '/tmp/not-a-backup.json');
    await host.waitForTimeout(300);
    assert.strictEqual(await host.locator('.set-card').count(), 2);
    log('single-set export, import "keep both", bad file refused');

    // ---------- Editor: question and option buttons ----------
    await host.locator('.set-card', { hasText: '(imported)' }).locator('[data-act=edit]').click();
    const card = (i) => host.locator('.q-card').nth(i);
    await card(0).locator('[data-act=dup]').click();
    assert.strictEqual(await host.locator('.q-card').count(), 6);
    await card(1).locator('[data-act=del]').click();
    assert.strictEqual(await host.locator('.q-card').count(), 5);
    await card(0).locator('[data-act=delopt][data-k="3"]').click();
    assert.strictEqual(await card(0).locator('[data-f=opt]').count(), 3);
    await card(0).locator('[data-act=addopt]').click();
    assert.strictEqual(await card(0).locator('[data-f=opt]').count(), 4);
    assert.match(await host.textContent('#editorCount'), /need fixing/); // new option is empty
    await card(0).locator('[data-f=opt][data-k="3"]').fill('25');
    assert.match(await host.textContent('#editorCount'), /ready to play/);
    await card(4).locator('[data-act=down]').isDisabled();
    // Play is blocked while a question is incomplete
    await card(0).locator('[data-f=text]').fill('');
    await host.click('#btnEditorPlay'); // alert is accepted, editor stays
    assert.ok(await host.isVisible('#view-editor'));
    await card(0).locator('[data-f=text]').fill('Minimum voting age?');
    await host.click('#btnEditorBack');
    log('editor: duplicate/delete question, add/remove option, validation blocks play');

    // ---------- Live game: remove player, skip, keyboard, student buttons ----------
    await host.locator('.set-card', { hasText: '(imported)' }).locator('[data-act=play]').click();
    await host.waitForFunction(() => document.querySelector('#netText').textContent === 'Online', null, { timeout: 15000 });
    const code = await host.textContent('#roomCode');
    const url = srv.base + '?room=' + code + '&' + srv.peerParam;
    async function phone(name) {
      const ctx = await newContext(browser, devices['Pixel 5']);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
      page.on('dialog', (d) => d.accept());
      await page.goto(url);
      await page.fill('#nick', name);
      await page.click('#joinBtn');
      await page.waitForSelector('text=You’re in!', { timeout: 20000 });
      return page;
    }
    const a = await phone('Ana');
    const troll = await phone('xX_troll_Xx');
    // Remove a player from the lobby; they cannot rejoin from that phone
    await host.click('.player-tag:has-text("xX_troll_Xx")');
    await troll.waitForSelector('text=You were removed');
    await host.waitForFunction(() => document.querySelector('#lobbyCount').textContent === '1');
    await troll.click('#again');
    await troll.fill('#code', code);
    await troll.fill('#nick', 'troll2');
    await troll.click('#joinBtn');
    await troll.waitForSelector('text=You were removed', { timeout: 20000 }); // same phone, new name: still refused
    assert.strictEqual(await host.textContent('#lobbyCount'), '1');
    log('remove player works, and sticks for that phone');

    // Student reload → rejoins automatically; "Not you?" returns to the form
    await a.reload();
    await a.waitForSelector('text=You’re in!', { timeout: 20000 });
    log('student page reload rejoins automatically');

    // Keyboard: Space on a focused button activates only that button
    await host.focus('#btnFullscreen');
    await host.keyboard.press('Tab'); // → End game / Close room button
    const focusedId = await host.evaluate(() => document.activeElement.id);
    assert.strictEqual(focusedId, 'btnEndGame');
    await host.focus('#btnNext');
    await host.keyboard.press('Space'); // start game exactly once
    await host.waitForFunction(() => Host.Game.debugState().phase === 'intro');
    await host.waitForFunction(() => Host.Game.debugState().phase === 'question', null, { timeout: 8000 });
    assert.strictEqual((await host.evaluate(() => Host.Game.debugState())).qIndex, 0, 'Space on focused button did not double-advance');
    // Skip question 1 → no points, goes to question 2
    await a.waitForSelector('.ans');
    await a.click('.ans[data-k="1"]');
    await host.click('#btnSkip');
    await host.waitForFunction(() => Host.Game.debugState().qIndex === 1);
    const st = await host.evaluate(() => Host.Game.debugState());
    assert.deepStrictEqual(st.skipped, [0]);
    assert.strictEqual(Object.keys(Object.values(st.players)[0].answers).length, 0, 'skipped answers removed');
    log('skip question gives no points');

    // Leave game button on the phone
    await a.waitForSelector('#leaveBtn:not([hidden])');
    await a.click('#leaveBtn');
    await a.waitForSelector('#joinForm:not([hidden])');
    assert.strictEqual(await a.evaluate(() => localStorage.getItem('classroomgame.player.v1')), null);
    log('leave game clears the phone’s identity');

    // End → podium → history: re-download CSV and delete entry
    await host.click('#btnEndGame');
    await host.waitForFunction(() => Host.Game.debugState().phase === 'podium');
    await host.click('[data-cmd=exit]');
    await host.waitForSelector('.history-item');
    const [dl2] = await Promise.all([host.waitForEvent('download'), host.click('.history-item [data-hact=csv]')]);
    assert.match(dl2.suggestedFilename(), /^results-.*\.csv$/);
    await host.click('.history-item [data-hact=del]');
    await host.waitForSelector('#historyList .empty');
    log('past results: re-download CSV and delete');

    // Close room straight from the lobby
    await host.click('.set-card [data-act=play]');
    await host.waitForSelector('#roomCode');
    await host.click('#btnEndGame');
    await host.waitForSelector('#view-home:not([hidden])');
    assert.strictEqual(await host.evaluate(() => localStorage.getItem('classroomgame.activeGame.v1')), null);
    log('close room from the lobby');

    // "Not you?" on a phone with a remembered identity for a room that no longer exists
    await a.evaluate(() => localStorage.setItem('classroomgame.player.v1', JSON.stringify({ room: 'ABCDE', pid: 'p_x', name: 'Ana', at: Date.now() })));
    await a.goto(srv.base + '?' + srv.peerParam);
    await a.waitForSelector('#notMe');
    await a.click('#notMe');
    await a.waitForSelector('#joinForm:not([hidden])');
    log('"Not you?" returns to the join form');

    // ---------- Projector extras: add team, keyboard tile, minus, back ----------
    await host.click('.set-card [data-act=projector]');
    await host.click('#addTeam');
    assert.strictEqual(await host.locator('[data-team]').count(), 5);
    await host.click('[data-pcmd=begin]');
    await host.keyboard.press('Space'); // options
    await host.keyboard.press('Space'); // reveal
    await host.focus('[data-tadd="4"]');
    await host.keyboard.press('Enter');
    await host.keyboard.press('Enter');
    assert.strictEqual(await host.textContent('.team-tile.team-4 .tscore'), '2');
    assert.strictEqual(await host.evaluate(() => document.activeElement.dataset.tadd), '4', 'focus stays on the tile');
    await host.click('[data-tsub="4"]');
    assert.strictEqual(await host.textContent('.team-tile.team-4 .tscore'), '1');
    await host.click('[data-pcmd=prev]');
    assert.strictEqual(await host.locator('#projStage .option.right').count(), 0, 'back hides the answer again');
    await host.click('#projExit');
    await host.waitForSelector('#view-home:not([hidden])');
    log('projector: add team, keyboard scoring, minus, back, exit');

    assert.deepStrictEqual(errors, [], 'no JavaScript errors');
    console.log('\nEXTRAS TEST PASSED');
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
