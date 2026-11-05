/*
 * Classroom Game — student phone screen.
 * Connects to the teacher's laptop with PeerJS and keeps reconnecting by itself
 * if the phone sleeps, switches networks or the page is reloaded.
 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var esc = CG.escapeHtml;
  var K = CG.STORAGE_KEYS;
  var HOST_SILENCE_MS = 15000;
  var PING_MS = 4000;

  var me = null;          // { room, pid, name, at }
  var peer = null, conn = null;
  var welcomed = false;   // the host has accepted us at least once (so keep retrying)
  var welcomedThisLoad = false;
  var connected = false;
  var lastMsgAt = 0;
  var attempt = 0;
  var retryTimer = null, openTimer = null, pingTimer = null, barTimer = null;
  var state = null;       // last state from the host
  var deadlineLocal = 0;  // local clock time when the current question closes
  var pending = null;     // { qi, a } answer sent but not yet confirmed
  var stopped = false;
  var wakeLock = null;

  /* ------------------------------------------------------------------ */
  /* Identity                                                           */
  /* ------------------------------------------------------------------ */

  function saveMe() { me.at = Date.now(); CG.storage.set(K.player, me); }
  function forgetMe() { CG.storage.remove(K.player); }

  /* ------------------------------------------------------------------ */
  /* UI helpers                                                         */
  /* ------------------------------------------------------------------ */

  function showForm(error) {
    stopped = true;
    state = null;
    pending = null;
    clearInterval(barTimer);
    teardown();
    $('#joinForm').hidden = false;
    $('#screen').hidden = true;
    $('#head').hidden = true;
    $('#net').hidden = true;
    $('#leaveBtn').hidden = true;
    $('#footJoin').hidden = false;
    $('#joinBtn').disabled = false;
    $('#joinBtn').textContent = 'Join game';
    var fe = $('#formError');
    fe.hidden = !error;
    fe.textContent = error || '';
  }

  function showScreen(html) {
    $('#joinForm').hidden = true;
    var s = $('#screen');
    s.hidden = false;
    s.className = 's-center';
    s.style.cssText = '';
    s.innerHTML = html.replace(/class="s-emoji"/g, 'class="s-emoji" aria-hidden="true"');
    $('#footJoin').hidden = true;
    announce(s.textContent);
  }

  /** Tell screen readers what changed (the visible screen is redrawn often). */
  var lastAnnounced = '';
  function announce(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text || text === lastAnnounced) return;
    lastAnnounced = text;
    $('#announce').textContent = text;
  }

  function setNet(text, bad) {
    var n = $('#net');
    n.hidden = !text;
    n.textContent = text || '';
    n.classList.toggle('bad', !!bad);
  }

  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } }

  function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
        navigator.wakeLock.request('screen').then(function (l) {
          wakeLock = l;
          l.addEventListener('release', function () { wakeLock = null; });
        }, function () { /* not allowed: fine */ });
      }
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* Connection                                                         */
  /* ------------------------------------------------------------------ */

  function teardown() {
    clearTimeout(retryTimer); clearTimeout(openTimer);
    connected = false;
    if (conn) { var c = conn; conn = null; try { c.close(); } catch (e) { /* ignore */ } }
    if (peer) { var p = peer; peer = null; try { p.destroy(); } catch (e) { /* ignore */ } }
  }

  function scheduleRetry(why) {
    if (stopped) return;
    teardown();
    var delay = Math.min(8000, 1000 * Math.pow(2, attempt));
    attempt++;
    setNet(welcomed ? 'Reconnecting… your score is safe.' : 'Connecting…', attempt > 3);
    if (why && window.console) console.log('[retry]', why, 'in', delay, 'ms');
    retryTimer = setTimeout(connect, delay);
  }

  function connect() {
    if (stopped) return;
    teardown();
    if (!welcomed) showScreen('<div class="s-emoji">📡</div><div class="s-title">Joining…</div><div class="s-sub">Room ' + esc(me.room) + '</div>');
    setNet(welcomed ? 'Reconnecting… your score is safe.' : '', false);

    if (typeof Peer === 'undefined') {
      CG.loadScript(CG.LIBS.peer, 'Peer').then(connect, function () {
        setNet('Could not load the game. Check your internet connection.', true);
        retryTimer = setTimeout(connect, 5000);
      });
      return;
    }

    var p = peer = new Peer(CG.peerOptions());
    openTimer = setTimeout(function () { if (p === peer && !connected) scheduleRetry('open timeout'); }, 15000);

    p.on('open', function () {
      if (p !== peer) return;
      var c = conn = p.connect(CG.PEER_PREFIX + me.room, { serialization: 'json', reliable: true });
      c.on('open', function () {
        if (c !== conn) return;
        clearTimeout(openTimer);
        connected = true;
        lastMsgAt = Date.now();
        c.send({ t: 'join', pid: me.pid, name: me.name });
      });
      c.on('data', function (msg) { if (c === conn) onMessage(msg); });
      c.on('close', function () { if (c === conn) scheduleRetry('conn closed'); });
      c.on('error', function () { if (c === conn) scheduleRetry('conn error'); });
    });
    p.on('error', function (err) {
      if (p !== peer) return;
      var type = err && err.type;
      if (type === 'peer-unavailable') {
        if (!welcomed) {
          forgetMe();
          showForm('Room “' + me.room + '” was not found. Check the code on the screen and try again.');
          return;
        }
        if (!welcomedThisLoad && attempt > 8) {
          forgetMe();
          showForm('Room “' + me.room + '” is not open any more. If your class is still playing, check the code on the screen.');
          return;
        }
        setNet('Waiting for the teacher’s screen to come back…', false);
        scheduleRetry('host unavailable');
        return;
      }
      if (type === 'browser-incompatible') {
        showForm('This browser cannot join live games. Try Chrome or Safari (not an in-app browser).');
        return;
      }
      scheduleRetry(type || 'peer error');
    });
    p.on('disconnected', function () {
      // Lost the introduction server only; the game connection may still be fine.
      if (p === peer && !connected) scheduleRetry('signalling lost');
    });
  }

  function send(msg) {
    if (conn && conn.open) { try { conn.send(msg); return true; } catch (e) { /* ignore */ } }
    return false;
  }

  function watchdog() {
    if (stopped || !me) return;
    if (connected && Date.now() - lastMsgAt > HOST_SILENCE_MS) { scheduleRetry('host silent'); return; }
    if (connected) send({ t: 'ping' });
  }

  /* ------------------------------------------------------------------ */
  /* Messages from the host                                             */
  /* ------------------------------------------------------------------ */

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    lastMsgAt = Date.now();
    switch (msg.t) {
      case 'welcome':
        welcomed = true;
        welcomedThisLoad = true;
        attempt = 0;
        me.pid = msg.pid; me.name = msg.name;
        saveMe();
        setNet('');
        $('#leaveBtn').hidden = false;
        keepAwake();
        break;
      case 'state':
        onState(msg);
        break;
      case 'error':
        if (msg.code === 'name-taken' || msg.code === 'name') { stopped = true; forgetMe(); showForm(msg.message); $('#nick').focus(); }
        else { forgetMe(); showForm(msg.message || 'Could not join.'); }
        break;
      case 'kicked':
        // Remember the removal for this room, so a new nickname on this phone is also refused.
        if (me) CG.storage.set(K.removed, { room: me.room, pid: me.pid });
        stopped = true; forgetMe(); teardown(); setNet('');
        $('#head').hidden = true; $('#leaveBtn').hidden = true;
        showScreen('<div class="s-emoji">🚪</div><div class="s-title">You were removed from the game</div><div class="s-sub">Ask your teacher if this was a mistake.</div><button class="btn btn-primary" id="again">OK</button>');
        $('#again').onclick = function () { showForm(); };
        break;
      case 'closed':
        stopped = true; forgetMe(); teardown(); setNet('');
        $('#leaveBtn').hidden = true;
        showScreen('<div class="s-emoji">👋</div><div class="s-title">The game is closed</div><div class="s-sub">Thanks for playing!</div><button class="btn btn-primary" id="again">Join another game</button>');
        $('#again').onclick = function () { showForm(); };
        break;
    }
  }

  function onState(s) {
    var prev = state;
    state = s;
    if (s.q && s.phase === 'question') deadlineLocal = Date.now() + s.q.remaining;
    if (pending && s.q && s.q.i === pending.qi && s.my && s.my.answered) pending = null;
    // Re-send an answer that was lost while we were reconnecting.
    if (pending && s.phase === 'question' && s.q && s.q.i === pending.qi && !s.q.paused && !s.my.answered) send({ t: 'answer', qi: pending.qi, a: pending.a });
    if (pending && (!s.q || s.q.i !== pending.qi || s.phase !== 'question')) pending = null;

    $('#head').hidden = false;
    $('#who').textContent = s.name;
    $('#pts').textContent = s.score + ' pts';

    var changed = !prev || prev.phase !== s.phase || (prev.q && s.q && prev.q.i !== s.q.i) || (!prev.q && s.q) ||
      (prev.my && s.my && prev.my.answered !== s.my.answered) || (prev.q && s.q && prev.q.paused !== s.q.paused) ||
      (prev.my && s.my && prev.my.correct !== s.my.correct);
    if (changed) render();
    if (s.phase === 'reveal' && prev && prev.phase !== 'reveal') vibrate(s.my && s.my.correct ? [60, 40, 60] : 200);
  }

  /* ------------------------------------------------------------------ */
  /* Screens                                                            */
  /* ------------------------------------------------------------------ */

  function render() {
    var s = state;
    clearInterval(barTimer);
    if (!s || stopped) return; // nothing to draw after leaving / being removed
    var q = s.q;

    if (s.phase === 'lobby') {
      showScreen('<div class="s-emoji">🎉</div><div class="s-title">You’re in!</div>' +
        '<div class="s-sub">Look for <b>' + esc(s.name) + '</b> on the big screen.<br>The game starts soon.</div>' +
        '<div class="chip" style="margin-top:1em">' + esc(s.title) + '</div>');
      return;
    }

    if (s.phase === 'intro') {
      showScreen('<div class="s-sub">Question ' + q.n + ' of ' + q.total + '</div><div class="s-title">Get ready…</div>' +
        '<div class="chip">' + esc(CG.TYPE_LABELS[q.type]) + '</div>');
      return;
    }

    if (s.phase === 'question') {
      if (s.my.answered || pending) {
        showScreen('<div class="s-emoji">🔒</div><div class="s-title">Answer locked in</div>' +
          '<div class="s-sub">' + (s.my.answered ? 'Waiting for the others…' : 'Sending…') + '</div>' + answerWasHtml(q, s.my.answered ? s.my.a : pending.a));
        return;
      }
      if (q.paused) {
        showScreen('<div class="s-emoji">⏸</div><div class="s-title">Paused</div><div class="s-sub">Your teacher paused the timer.</div>');
        return;
      }
      renderQuestion(q);
      return;
    }

    if (s.phase === 'reveal' || s.phase === 'leaderboard') {
      var r = s.reveal;
      var cls, title, emoji;
      if (r.skipped) { cls = 'none'; emoji = '⏭'; title = 'Question skipped'; }
      else if (s.my.correct) { cls = 'good'; emoji = '✅'; title = 'Correct!'; }
      else if (s.my.answered) { cls = 'bad'; emoji = '❌'; title = 'Not quite'; }
      else { cls = 'none'; emoji = '⌛'; title = 'Time’s up'; }
      var h = (r.trick ? '<div class="trick-badge">🎭 Trick question!</div>' : '') +
        '<div class="s-result ' + cls + '"><div class="s-emoji">' + emoji + '</div><div class="s-title">' + title + '</div>' +
        (s.my.correct ? '<div class="gain">+' + s.my.points + ' points</div>' : '') + '</div>';
      if (!s.my.correct && !r.skipped) h += '<div class="s-answer-was">Correct answer: <b>' + esc(r.correctText) + '</b></div>';
      if (r.explanation) h += '<div class="s-answer-was" style="font-weight:400">' + esc(r.explanation) + '</div>';
      h += '<div class="s-sub">You are <b>' + CG.ordinal(s.rank) + '</b> of ' + s.players + ' · ' + s.score + ' pts</div>';
      showScreen(h);
      return;
    }

    if (s.phase === 'podium') {
      var f = s.final;
      var medal = f.rank === 1 ? '🥇' : f.rank === 2 ? '🥈' : f.rank === 3 ? '🥉' : '🎓';
      showScreen('<div class="s-emoji">' + medal + '</div><div class="s-sub">Final rank</div><div class="rank-big">' + CG.ordinal(f.rank) + '</div>' +
        '<div class="s-sub">of ' + s.players + ' players</div>' +
        '<div class="s-answer-was center"><b>' + f.score + '</b> points · <b>' + f.correct + '</b> of ' + f.played + ' correct</div>' +
        (f.top.length ? '<div class="s-answer-was">' + f.top.map(function (t) { return t.rank + '. ' + esc(t.name) + ' — ' + t.score; }).join('<br>') + '</div>' : '') +
        '<div class="s-sub">Thanks for playing!</div>');
      return;
    }
  }

  function answerWasHtml(q, a) {
    if (a == null) return '';
    var text = q.type === 'id' ? a : (q.options[a] || '');
    return '<div class="s-answer-was">You answered: <b>' + esc(text) + '</b></div>';
  }

  function renderQuestion(q) {
    var head = '<div class="s-qinfo" style="width:100%"><span><span aria-hidden="true">Q' + q.n + ' / ' + q.total + '</span><span class="sr-only">Question ' + q.n + ' of ' + q.total + '</span></span><span id="secs" aria-hidden="true"></span></div>' +
      '<div class="s-timebar" style="width:100%" aria-hidden="true"><div id="bar"></div></div>' +
      '<div class="s-qtext">' + esc(q.text) + '</div>';
    var s = $('#screen');
    $('#joinForm').hidden = true;
    s.hidden = false;
    s.className = '';
    s.style.cssText = 'display:flex;flex-direction:column;gap:14px;flex:1';
    if (q.type === 'id') {
      s.innerHTML = head + '<form class="s-type" id="typeForm" autocomplete="off">' +
        '<input id="typed" maxlength="' + CG.MAX_TEXT_ANSWER + '" placeholder="Type your answer" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" aria-label="Your answer">' +
        '<button class="btn btn-primary" type="submit">Submit</button></form>';
      $('#typeForm').onsubmit = function (e) {
        e.preventDefault();
        var v = $('#typed').value.trim();
        if (!CG.normalizeAnswer(v)) { $('#typed').focus(); return; }
        submit(q.i, v);
      };
      setTimeout(function () { var t = $('#typed'); if (t) t.focus(); }, 50);
    } else {
      s.innerHTML = head + '<div class="s-answers' + (q.options.length === 2 ? ' two' : '') + '">' + q.options.map(function (o, k) {
        return '<button class="ans opt-' + k + '" data-k="' + k + '"><span class="shape" aria-hidden="true">' + CG.SHAPES[k] + '</span><span>' + esc(o) + '</span></button>';
      }).join('') + '</div>';
      s.querySelectorAll('.ans').forEach(function (b) {
        b.onclick = function () { b.classList.add('picked'); submit(q.i, Number(b.dataset.k)); };
      });
    }
    announce('Question ' + q.n + ' of ' + q.total + ': ' + q.text + (q.type === 'id' ? ' Type your answer.' : ' Choose: ' + q.options.join(', ')));
    var tickBar = function () {
      var bar = $('#bar');
      if (!bar || !state || state.phase !== 'question') { clearInterval(barTimer); return; }
      var left = Math.max(0, deadlineLocal - Date.now());
      bar.style.width = (100 * left / q.time) + '%';
      $('#secs').textContent = Math.ceil(left / 1000) + 's';
    };
    tickBar();
    barTimer = setInterval(tickBar, 250);
  }

  function submit(qi, a) {
    pending = { qi: qi, a: a };
    send({ t: 'answer', qi: qi, a: a });
    vibrate(30);
    // Show "locked in" immediately; the host's reply confirms it.
    setTimeout(render, 120);
  }

  /* ------------------------------------------------------------------ */
  /* Start-up                                                           */
  /* ------------------------------------------------------------------ */

  function begin() {
    stopped = false;
    welcomed = false;
    attempt = 0;
    state = null;
    $('#joinForm').hidden = true;
    connect();
  }

  $('#code').addEventListener('input', function () {
    var v = CG.cleanRoomCode(this.value);
    if (v !== this.value) this.value = v;
    if (v.length === CG.ROOM_LENGTH && !$('#nick').value) $('#nick').focus();
  });

  $('#joinForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var room = CG.cleanRoomCode($('#code').value);
    var name = CG.cleanName($('#nick').value);
    if (room.length !== CG.ROOM_LENGTH) { showForm('The room code has ' + CG.ROOM_LENGTH + ' characters. Check the code on the big screen.'); $('#code').focus(); return; }
    if (!name) { showForm('Please type a nickname.'); $('#nick').focus(); return; }
    var old = CG.storage.get(K.player, null);
    var removed = CG.storage.get(K.removed, null);
    var pid = removed && removed.room === room ? removed.pid
      : old && old.room === room && old.name === name && old.pid ? old.pid : CG.makeId('p_');
    me = { room: room, name: name, pid: pid };
    saveMe();
    try { history.replaceState(null, '', location.pathname + '?room=' + room + (CG.peerServerParam() ? '&peerserver=' + encodeURIComponent(CG.peerServerParam()) : '')); } catch (err) { /* ignore */ }
    $('#joinBtn').disabled = true;
    $('#joinBtn').textContent = 'Joining…';
    begin();
  });

  $('#leaveBtn').onclick = function () {
    if (!confirm('Leave the game? Your score stays on the teacher’s screen, but you will need to join again to keep playing.')) return;
    forgetMe();
    showForm();
  };

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || stopped || !me) return;
    keepAwake();
    // Phones often drop the connection while the screen is off: check right away.
    if (!connected || Date.now() - lastMsgAt > 6000) { attempt = 0; scheduleRetry('back from background'); }
    else send({ t: 'sync' });
  });
  window.addEventListener('online', function () { if (!stopped && me && !connected) { attempt = 0; scheduleRetry('online again'); } });
  pingTimer = setInterval(watchdog, PING_MS);
  // Start downloading the connection library now, while the student types their name.
  CG.loadScript(CG.LIBS.peer, 'Peer').catch(function () { /* retried when joining */ });

  // Fill in the room code from the QR link, and rejoin automatically after a reload.
  var params = new URLSearchParams(location.search);
  var urlRoom = CG.cleanRoomCode(params.get('room'));
  var saved = CG.storage.get(K.player, null);
  if (urlRoom) $('#code').value = urlRoom;
  if (saved && saved.name) $('#nick').value = saved.name;
  var fresh = saved && saved.at && Date.now() - saved.at < 4 * 3600 * 1000;
  if (saved && fresh && saved.pid && saved.name && (!urlRoom || urlRoom === saved.room)) {
    me = saved;
    $('#code').value = saved.room;
    begin();
    // After a reload, keep trying even if the room isn't reachable yet.
    welcomed = true;
    showScreen('<div class="s-emoji">🔄</div><div class="s-title">Rejoining as ' + esc(saved.name) + '…</div>' +
      '<div class="s-sub">Room ' + esc(saved.room) + '</div><button class="linkish" id="notMe">Not you? Join with another name</button>');
    $('#notMe').onclick = function () { forgetMe(); showForm(); };
  } else {
    showForm();
    if (urlRoom) $('#nick').focus(); else $('#code').focus();
  }
})();
