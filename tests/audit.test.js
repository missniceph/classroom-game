// Quality audit: visits every screen at phone (360px), tablet and laptop sizes, in light and
// dark colour-scheme preference, and checks for (1) accessibility problems with axe-core and
// (2) content that is wider than the screen (sideways scrolling).
// Run: npm install && node audit.test.js   (set SHOTS=/some/dir to save screenshots)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { startServers, launch, newContext } = require('./harness');

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SHOTS = process.env.SHOTS;
const SIZES = { phone: { width: 360, height: 740, isMobile: true, hasTouch: true }, tablet: { width: 768, height: 1024, isMobile: true, hasTouch: true }, laptop: { width: 1366, height: 768 } };
const problems = [];
const seen = new Set();

async function check(page, label) {
  await page.waitForTimeout(450); // let entrance animations finish
  await page.addScriptTag({ content: AXE });
  const res = await page.evaluate(async () => {
    const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'], resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 2).join('')) }));
  });
  const overflow = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width && r.right > w + 1 && getComputedStyle(el).position !== 'fixed';
    }).slice(0, 3).map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + [...el.classList].join('.'));
    return document.documentElement.scrollWidth > w + 1 ? wide : [];
  });
  for (const v of res) {
    const key = v.id + '|' + v.nodes.join();
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push(`[${label}] a11y ${v.id}: ${v.help}\n      ${v.nodes.join('\n      ')}`);
  }
  if (overflow.length) problems.push(`[${label}] sideways scroll: ${overflow.join(', ')}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, label.replace(/[^a-z0-9-]+/gi, '_') + '.png') });
}

(async () => {
  const srv = await startServers(8126, 9126);
  const browser = await launch();
  const errors = [];
  try {
    for (const scheme of ['dark', 'light']) {
      for (const [sizeName, size] of Object.entries(SIZES)) {
        const tag = `${sizeName}-${scheme}`;
        const opts = { viewport: { width: size.width, height: size.height }, isMobile: !!size.isMobile, hasTouch: !!size.hasTouch, colorScheme: scheme };
        // ----- Host -----
        const hctx = await newContext(browser, opts);
        const host = await hctx.newPage();
        host.on('pageerror', (e) => errors.push('host: ' + e.message));
        host.on('dialog', (d) => d.accept());
        await host.goto(srv.base + 'host.html?' + srv.peerParam);
        await host.waitForSelector('.set-card');
        await check(host, `${tag} host-home`);
        await host.click('.set-card [data-act=edit]');
        await check(host, `${tag} host-editor`);
        await host.click('#btnEditorPaste');
        await host.click('#pasteExample');
        await check(host, `${tag} host-paste`);
        await host.click('#pasteCancel');
        await host.click('#btnEditorBack');
        await host.click('.set-card [data-act=play]');
        await host.waitForFunction(() => document.querySelector('#netText').textContent === 'Online', null, { timeout: 15000 });
        const code = await host.textContent('#roomCode');
        // ----- Student -----
        const sctx = await newContext(browser, opts);
        const stu = await sctx.newPage();
        stu.on('pageerror', (e) => errors.push('student: ' + e.message));
        await stu.goto(srv.base + '?' + srv.peerParam);
        await check(stu, `${tag} student-join`);
        await stu.fill('#code', 'ZZZZZ');
        await stu.fill('#nick', 'Ma. Teresa Ñañez-Dela');
        await stu.click('#joinBtn');
        await stu.waitForSelector('#formError:not([hidden])', { timeout: 20000 });
        await check(stu, `${tag} student-join-error`);
        await stu.fill('#code', code);
        await stu.click('#joinBtn');
        await stu.waitForSelector('text=You’re in!', { timeout: 20000 });
        await check(stu, `${tag} student-lobby`);
        await check(host, `${tag} host-lobby`);
        await host.click('#btnNext');
        await check(stu, `${tag} student-intro`);
        await stu.waitForSelector('.ans', { timeout: 15000 });
        await check(stu, `${tag} student-question-mc`);
        await check(host, `${tag} host-question`);
        await stu.click('.ans[data-k="0"]'); // wrong
        await host.waitForFunction(() => Host.Game.debugState().phase === 'reveal');
        await host.waitForTimeout(200);
        await check(stu, `${tag} student-reveal-wrong`);
        await check(host, `${tag} host-reveal`);
        await host.click('#btnNext');
        await check(host, `${tag} host-leaderboard`);
        await host.click('#btnNext');
        await stu.waitForSelector('.ans', { timeout: 15000 });
        await stu.click('.ans[data-k="1"]'); // right (False)
        await host.waitForFunction(() => Host.Game.debugState().phase === 'reveal');
        await check(stu, `${tag} student-reveal-right`);
        await host.click('#btnNext'); await host.click('#btnNext');
        await stu.waitForSelector('#typed', { timeout: 15000 });
        await check(stu, `${tag} student-question-id`);
        await host.click('#btnPause');
        await stu.waitForSelector('text=Paused');
        await check(stu, `${tag} student-paused`);
        await host.click('#btnPause');
        await stu.waitForSelector('#typed');
        await stu.fill('#typed', 'something long and wrong to see how the typed list wraps on the screen');
        await stu.click('#typeForm button');
        await host.waitForFunction(() => Host.Game.debugState().phase === 'reveal');
        await check(host, `${tag} host-reveal-id`);
        await host.click('#btnNext'); await host.click('#btnNext');
        await stu.waitForSelector('.ans', { timeout: 15000 });
        await stu.click('.ans[data-k="0"]');
        await host.waitForFunction(() => Host.Game.debugState().phase === 'reveal');
        await host.waitForTimeout(2900); // trick overlay gone
        await check(host, `${tag} host-reveal-trick`);
        await check(stu, `${tag} student-reveal-trick`);
        await host.click('#btnEndGame');
        await host.waitForFunction(() => Host.Game.debugState().phase === 'podium');
        await stu.waitForSelector('text=Final rank');
        await host.waitForTimeout(2600);
        await check(host, `${tag} host-podium`);
        await check(stu, `${tag} student-final`);
        await host.click('[data-cmd=all]');
        await check(host, `${tag} host-all-results`);
        await host.click('[data-x=close]');
        await host.click('[data-cmd=exit]');
        await stu.waitForSelector('text=The game is closed');
        await check(stu, `${tag} student-closed`);
        await host.waitForSelector('.history-item');
        await check(host, `${tag} host-home-history`);
        // ----- Projector -----
        await host.click('.set-card [data-act=projector]');
        await check(host, `${tag} proj-setup`);
        await host.click('[data-pcmd=begin]');
        await host.click('[data-pcmd=options]');
        await check(host, `${tag} proj-question`);
        await host.click('[data-pcmd=reveal]');
        await check(host, `${tag} proj-reveal`);
        await host.click('[data-pcmd=final]');
        await host.waitForTimeout(2000);
        await check(host, `${tag} proj-final`);
        await host.click('[data-pcmd=exit]');
        await hctx.close(); await sctx.close();
        console.log('• checked', tag);
      }
    }
    console.log(problems.length ? '\nPROBLEMS:\n' + problems.join('\n') : '\nNo problems found.');
    assert.deepStrictEqual(errors, [], 'no JavaScript errors');
    assert.strictEqual(problems.length, 0, problems.length + ' problems');
    console.log('\nAUDIT PASSED');
  } catch (e) {
    console.error('FAILED:', e.message);
    console.error('page errors:', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
    process.exit();
  }
})();
