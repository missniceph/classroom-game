// End-to-end test of a live game: 1 host laptop + 3 phones, including a phone that
// disconnects and rejoins, a host page reload in the middle of the game, and the CSV export.
// Run: npm install && node e2e-live.test.js   (set SHOTS=/some/dir to save screenshots)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { startServers, launch, newContext, devices } = require('./harness');

const SHOTS = process.env.SHOTS;
const log = (...a) => console.log('•', ...a);
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); }

(async () => {
  const srv = await startServers();
  const browser = await launch();
  const errors = [];
  const watch = (p, who) => {
    p.on('pageerror', (e) => errors.push(who + ': ' + e.message));
    p.on('dialog', (d) => d.accept());
  };

  try {
    // ---------- Host ----------
    const hostCtx = await newContext(browser, { viewport: { width: 1366, height: 768 } });
    const host = await hostCtx.newPage();
    watch(host, 'host');
    await host.goto(srv.base + 'host.html?' + srv.peerParam);
    await host.waitForSelector('.set-card');
    assert.match(await host.textContent('.set-card h3'), /Sample: Citizenship/);
    await shot(host, '01-host-sets');
    await host.click('.set-card [data-act=play]');
    await host.waitForFunction(() => document.querySelector('#netText').textContent === 'Online', null, { timeout: 15000 });
    const code = await host.textContent('#roomCode');
    assert.match(code, /^[A-Z2-9]{5}$/);
    log('host online, room', code);

    // ---------- Phones ----------
    const joinUrl = srv.base + '?room=' + code + '&' + srv.peerParam;
    async function phone(name, device) {
      const ctx = await newContext(browser, devices[device]);
      const page = await ctx.newPage();
      watch(page, name);
      await page.goto(joinUrl);
      assert.strictEqual(await page.inputValue('#code'), code, 'room code prefilled from link');
      await page.fill('#nick', name);
      await page.click('#joinBtn');
      await page.waitForSelector('text=You’re in!', { timeout: 20000 });
      return { ctx, page, name };
    }
    const ana = await phone('Ana', 'iPhone 13');
    const ben = await phone('Ben', 'Pixel 5');
    let cy = await phone('Cy', 'Galaxy S9+');
    log('3 phones joined');
    await host.waitForFunction(() => document.querySelector('#lobbyCount').textContent === '3');
    await host.waitForTimeout(400);
    await shot(host, '02-host-lobby');
    await shot(ana.page, '02-phone-lobby');

    // Duplicate nickname is refused
    const dupCtx = await newContext(browser, devices['Pixel 5']);
    const dup = await dupCtx.newPage();
    watch(dup, 'dup');
    await dup.goto(joinUrl);
    await dup.fill('#nick', 'ana');
    await dup.click('#joinBtn');
    await dup.waitForSelector('#formError:not([hidden])', { timeout: 15000 });
    assert.match(await dup.textContent('#formError'), /already taken/);
    log('duplicate nickname refused');

    // Wrong room code is reported
    await dup.goto(srv.base + '?' + srv.peerParam);
    await dup.fill('#code', 'ZZZZZ');
    await dup.fill('#nick', 'Dee');
    await dup.click('#joinBtn');
    await dup.waitForSelector('#formError:not([hidden])', { timeout: 20000 });
    assert.match(await dup.textContent('#formError'), /not found/);
    await dupCtx.close();
    log('unknown room reported');

    const hostState = () => host.evaluate(() => Host.Game.debugState());
    const waitPhase = (ph) => host.waitForFunction((p) => Host.Game.debugState().phase === p, ph, { timeout: 30000 });
    const screenText = (p) => p.page.textContent('#screen');
    const waitText = (p, re) => p.page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#screen').textContent), re.source, { timeout: 20000 });
    const tap = (p, k) => p.page.click('.ans[data-k="' + k + '"]');
    async function type(p, text) { await p.page.fill('#typed', text); await p.page.click('#typeForm button'); }
    async function untilQuestion() {
      await waitPhase('question');
      for (const p of [ana, ben, cy]) await p.page.waitForSelector('.ans, #typed', { timeout: 15000 });
    }

    // ---------- Q1: multiple choice + a phone that drops out and rejoins ----------
    await host.keyboard.press('Space');
    await waitPhase('intro');
    await waitText(ana, /Get ready/);
    await shot(host, '03-host-intro');
    await untilQuestion();
    await shot(host, '04-host-question');
    await shot(ana.page, '04-phone-question');

    await host.click('#btnPause'); // keep the clock still while we simulate the dropout
    log('Cy’s phone dies…');
    await cy.page.close();
    await host.waitForFunction(() => /2 online/.test(document.querySelector('#playerCountChip').textContent), null, { timeout: 25000 });
    log('host sees Cy offline:', await host.textContent('#playerCountChip'));
    cy.page = await cy.ctx.newPage();
    watch(cy.page, 'Cy2');
    const t0 = Date.now();
    await cy.page.goto(joinUrl); // e.g. scans the QR code again
    await waitText(cy, /Paused/);
    log('Cy back after', Date.now() - t0, 'ms');
    await host.click('#btnPause');
    await cy.page.waitForSelector('.ans', { timeout: 15000 });
    assert.match(await cy.page.textContent('#who'), /Cy/);
    await host.waitForFunction(() => /^3 players$/.test(document.querySelector('#playerCountChip').textContent));
    assert.strictEqual((await hostState()).order.length, 3, 'rejoin does not create a duplicate player');
    log('Cy rejoined automatically with the same identity');

    await tap(cy, 1);
    await waitText(cy, /locked in/);
    await tap(ana, 1);
    await tap(ben, 0);
    await waitPhase('reveal'); // auto-reveal: everyone answered
    await waitText(ana, /Correct!/);
    await waitText(ben, /Not quite/);
    assert.match(await screenText(ben), /Correct answer: 18/);
    assert.match(await host.textContent('#stage'), /2 of 3 correct/);
    await host.waitForTimeout(900);
    await shot(host, '05-host-reveal');
    await shot(ana.page, '05-phone-correct');
    await shot(ben.page, '05-phone-wrong');
    log('Q1 revealed: Ana ✓, Ben ✗, Cy ✓');

    await host.click('#btnNext');
    await waitPhase('leaderboard');
    assert.strictEqual(await host.locator('.board-row').count(), 3);
    await host.waitForTimeout(600);
    await shot(host, '06-host-leaderboard');

    // Ben's phone dies completely; he borrows another phone and joins with the same nickname.
    await ben.ctx.close();
    await host.waitForFunction(() => /2 online/.test(document.querySelector('#playerCountChip').textContent), null, { timeout: 25000 });
    const benCtx2 = await newContext(browser, devices['Pixel 5']);
    const ben2 = await benCtx2.newPage();
    watch(ben2, 'Ben-new-phone');
    await ben2.goto(joinUrl);
    await ben2.fill('#nick', 'ben');
    await ben2.click('#joinBtn');
    await ben2.waitForFunction(() => /You are 3rd of 3/.test(document.querySelector('#screen').textContent), null, { timeout: 20000 });
    assert.strictEqual(await ben2.textContent('#who'), 'Ben');
    assert.strictEqual((await hostState()).order.length, 3, 'same nickname on a new phone continues the old player');
    Object.assign(ben, { ctx: benCtx2, page: ben2 });
    log('Ben continued on a different phone with his nickname');

    // ---------- Q2: true/false, pause, early reveal, then the HOST reloads ----------
    await host.click('#btnNext');
    await untilQuestion();
    await host.click('#btnPause');
    await waitText(ana, /Paused/);
    const pausedLeft = (await hostState()).remaining;
    await host.waitForTimeout(1500);
    assert.strictEqual((await hostState()).remaining, pausedLeft, 'timer frozen while paused');
    await host.click('#btnPause');
    await ana.page.waitForSelector('.ans');
    await tap(ana, 1);
    await tap(ben, 1);
    await host.click('#btnNext'); // "Show answer now" (Cy did not answer)
    await waitPhase('reveal');
    await waitText(cy, /Time’s up/);
    log('Q2 pause/resume and early reveal OK');

    log('host page reloads by accident…');
    await host.reload();
    await host.waitForSelector('#btnResumeGame');
    await shot(host, '07-host-resume-banner');
    await host.click('#btnResumeGame');
    await host.waitForFunction(() => document.querySelector('#netText').textContent === 'Online', null, { timeout: 60000 });
    await host.waitForFunction(() => /^3 players$/.test(document.querySelector('#playerCountChip').textContent), null, { timeout: 60000 });
    assert.strictEqual((await hostState()).phase, 'reveal');
    log('host resumed; all 3 phones reconnected by themselves');

    await host.click('#btnNext');
    await waitPhase('leaderboard');
    await host.click('#btnNext');

    // ---------- Q3: identification ----------
    await untilQuestion();
    await shot(ana.page, '08-phone-identification');
    await type(ana, '  R.A. No. 7160 ');
    await type(ben, 'local government CODE');
    await type(cy, 'Omnibus Election Code');
    await waitPhase('reveal');
    await waitText(ana, /Correct!/);
    await waitText(ben, /Correct!/);
    await waitText(cy, /Not quite/);
    await host.waitForTimeout(500);
    await shot(host, '09-host-reveal-identification');
    log('Q3 identification: punctuation/case ignored');

    await host.click('#btnNext');
    await host.click('#btnNext');

    // ---------- Q4: trick question ----------
    await untilQuestion();
    await tap(ana, 0);
    await tap(ben, 1);
    await tap(cy, 1);
    await waitPhase('reveal');
    await host.waitForSelector('.trick-overlay');
    await shot(host, '10-host-trick-overlay');
    await waitText(ana, /Trick question/);
    await host.waitForTimeout(3000);
    assert.strictEqual(await host.locator('.trick-overlay').count(), 0);
    await shot(host, '10b-host-trick-reveal');
    await shot(ana.page, '10-phone-trick');
    log('Q4 trick reveal shown');

    await host.click('#btnNext');
    await host.click('#btnNext');

    // ---------- Q5: identification + teacher accepts a typed answer ----------
    await untilQuestion();
    await type(ana, 'the People');
    await type(ben, 'Filipino citizens');
    await type(cy, 'Congress');
    await waitPhase('reveal');
    await waitText(ben, /Not quite/);
    await host.click('[data-accept="Filipino citizens"]');
    await waitText(ben, /Correct!/);
    log('Q5: teacher accepted “Filipino citizens”, Ben now correct');

    await host.click('#btnNext');
    await waitPhase('leaderboard');
    assert.match(await host.textContent('#btnNext'), /Final results/);
    await host.click('#btnNext');
    await waitPhase('podium');
    await waitText(ana, /Final rank/);
    await host.waitForTimeout(2500);
    await shot(host, '11-host-podium');
    await shot(ana.page, '11-phone-final');

    // Expected: Ana 4/5 (fell for the trick), Ben 4/5 (Q1 wrong), Cy 2/5 (Q1, Q4)
    const st = await hostState();
    const correctOf = (name) => {
      const p = Object.values(st.players).find((x) => x.name === name);
      return Object.values(p.answers).filter((a) => a.correct).length;
    };
    assert.deepStrictEqual([correctOf('Ana'), correctOf('Ben'), correctOf('Cy')], [4, 4, 2]);

    // ---------- CSV ----------
    const [dl] = await Promise.all([host.waitForEvent('download'), host.click('[data-cmd=csv]')]);
    const csvPath = await dl.path();
    const csv = fs.readFileSync(csvPath, 'utf8');
    if (SHOTS) fs.copyFileSync(csvPath, path.join(SHOTS, dl.suggestedFilename()));
    const lines = csv.replace(/^\ufeff/, '').trim().split(/\r\n/);
    assert.strictEqual(lines[0].split(',').slice(0, 7).join(','), 'Rank,Nickname,Score,Correct answers,Questions answered,Questions played,Time joined');
    assert.strictEqual(lines.length, 4);
    const row = (name) => lines.find((l) => l.split(',')[1] === name);
    assert.match(row('Ana'), /^[12],Ana,\d+,4,5,5,\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,1,1,1,0,1$/);
    assert.match(row('Ben'), /^[12],Ben,\d+,4,5,5,.*,0,1,1,1,1$/);
    assert.match(row('Cy'), /^3,Cy,\d+,2,4,5,.*,1,,0,1,0$/);
    assert.match(dl.suggestedFilename(), /^results-.*\.csv$/);
    log('CSV OK:', dl.suggestedFilename());
    console.log(csv.trim());

    // ---------- Close the room ----------
    await host.click('[data-cmd=exit]');
    await host.waitForSelector('.history-item');
    await waitText(ana, /game is closed/);
    log('room closed; result saved under Past game results');

    assert.deepStrictEqual(errors, [], 'no JavaScript errors');
    console.log('\nLIVE GAME TEST PASSED');
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
