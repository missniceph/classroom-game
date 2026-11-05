/*
 * Classroom Game — live game on the host (teacher) laptop.
 *
 * The host browser *is* the server: students' phones connect straight to it with PeerJS
 * (WebRTC data channels). The free public PeerJS server is only used to introduce the
 * phones to the laptop; game data and results never leave the classroom devices.
 */
Host.Game = (function (H) {
  'use strict';

  var $ = H.$, esc = H.esc, plural = H.plural;
  var K = CG.STORAGE_KEYS;
  var INTRO_MS = 3000;
  var PING_MS = 4000;
  var PLAYER_TIMEOUT_MS = 20000;

  var G = null;          // the game (saved to localStorage so a refresh can resume it)
  var peer = null;
  var conns = {};        // pid -> PeerJS DataConnection (not saved)
  var online = {};       // pid -> { lastSeen }
  var keepCode = false;  // once students know the code, never change it
  var tickTimer = null, introTimer = null, pingTimer = null, saveTimer = null, autoRevealTimer = null, retryTimer = null;
  var qrLib = null;
  var shownTrickFor = -1;
  var tagsShown = {};    // pids already drawn in the lobby (only new names animate in)

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */

  function now() { return Date.now(); }
  function cur() { return G.set.questions[G.qIndex]; }
  function total() { return G.set.questions.length; }
  function playerList() { return G.order.map(function (pid) { return G.players[pid]; }).filter(Boolean); }
  function isOnline(pid) { return !!online[pid]; }
  function onlineCount() { return playerList().filter(function (p) { return isOnline(p.pid); }).length; }

  function remaining() {
    if (G.phase !== 'question') return 0;
    if (G.paused) return G.remaining;
    return Math.max(0, G.deadline - now());
  }

  function statsOf(p) {
    var s = 0, c = 0, n = 0;
    G.revealed.forEach(function (qi) {
      var a = p.answers[qi];
      if (!a) return;
      n++;
      if (a.correct) { c++; s += a.points; }
    });
    return { score: s, correct: c, answered: n };
  }

  function standings() {
    var rows = playerList().map(function (p) {
      var st = statsOf(p);
      var lastQ = G.revealed[G.revealed.length - 1];
      var last = lastQ != null ? p.answers[lastQ] : null;
      return { p: p, name: p.name, score: st.score, correct: st.correct, answered: st.answered, gain: last && last.correct ? last.points : 0 };
    });
    return CG.rank(rows, function (a, b) { return (b.correct - a.correct) || a.name.localeCompare(b.name); });
  }

  function joinUrl() {
    var u = new URL('./', location.href);
    u.search = '';
    u.hash = '';
    var params = '?room=' + G.room;
    var ps = CG.peerServerParam();
    if (ps) params += '&peerserver=' + encodeURIComponent(ps);
    return u.href + params;
  }
  function shortUrl() {
    var u = new URL('./', location.href);
    return (u.host + u.pathname).replace(/\/$/, '');
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  function saveNow() {
    if (!G) return;
    clearTimeout(saveTimer);
    var copy = Object.assign({}, G, { savedAt: now(), remaining: remaining() });
    CG.storage.set(K.activeGame, copy);
  }

  /* ------------------------------------------------------------------ */
  /* Networking                                                         */
  /* ------------------------------------------------------------------ */

  function setNet(state, text) {
    var dot = $('#netDot');
    dot.className = 'net-dot ' + (state === 'ok' ? 'ok' : state === 'wait' ? 'wait' : '');
    $('#netText').textContent = text;
  }

  function openPeer() {
    clearTimeout(retryTimer);
    if (peer) { try { peer.destroy(); } catch (e) { /* ignore */ } }
    setNet('wait', 'Connecting to the game server…');
    var p = peer = new Peer(CG.PEER_PREFIX + G.room, CG.peerOptions());

    p.on('open', function () {
      if (p !== peer) return;
      keepCode = true;
      setNet('ok', 'Online');
    });
    p.on('connection', onConnection);
    p.on('disconnected', function () {
      if (p !== peer || p.destroyed) return;
      setNet('wait', 'Reconnecting to the game server… (players already in can keep playing)');
      retryTimer = setTimeout(function () {
        if (p === peer && !p.destroyed && p.disconnected) { try { p.reconnect(); } catch (e) { openPeer(); } }
      }, 2000);
    });
    p.on('error', function (err) {
      if (p !== peer) return;
      var type = err && err.type;
      if (type === 'peer-unavailable') return; // not relevant for the host
      if (type === 'unavailable-id') {
        if (!keepCode && !G.order.length) {
          // Someone else has this code right now: pick another one.
          G.room = CG.makeRoomCode();
          renderLobbyIfShown();
          openPeer();
        } else {
          setNet('wait', 'Getting room ' + G.room + ' back from the server… this can take up to a minute.');
          retryTimer = setTimeout(openPeer, 5000);
        }
        return;
      }
      if (type === 'browser-incompatible') {
        setNet('bad', 'This browser cannot host live games. Use Chrome, Edge or Firefox — or Projector mode.');
        return;
      }
      setNet('bad', 'Cannot reach the game server (' + (type || 'error') + '). Retrying… If the internet is down, use Projector mode.');
      retryTimer = setTimeout(function () {
        if (p !== peer) return;
        if (p.open && !p.disconnected) { setNet('ok', 'Online'); return; }
        if (!p.destroyed && p.disconnected && p.id) { try { p.reconnect(); return; } catch (e) { /* fall through */ } }
        openPeer();
      }, 4000);
    });
  }

  function onConnection(conn) {
    conn.on('data', function (msg) { onData(conn, msg); });
    conn.on('close', function () { dropConn(conn); });
    conn.on('error', function () { dropConn(conn); });
  }

  function dropConn(conn) {
    var pid = conn._pid;
    if (pid && conns[pid] === conn) {
      delete conns[pid];
      delete online[pid];
      onPlayersChanged();
    }
  }

  function send(pid, msg) {
    var c = conns[pid];
    if (c && c.open) { try { c.send(msg); } catch (e) { /* ignore */ } }
  }

  function sendState(pid, table) {
    var p = G.players[pid];
    if (p) send(pid, stateFor(p, table || standings()));
  }

  function broadcast() {
    var table = standings();
    Object.keys(conns).forEach(function (pid) { if (G.players[pid]) send(pid, stateFor(G.players[pid], table)); });
  }

  function onData(conn, msg) {
    if (!msg || typeof msg !== 'object' || !G) return;
    var pid = conn._pid;
    if (pid) online[pid] = { lastSeen: now() };
    switch (msg.t) {
      case 'join': return onJoin(conn, msg);
      case 'answer': if (pid) onAnswer(pid, msg); return;
      case 'ping': if (pid) send(pid, { t: 'pong' }); return;
      case 'sync': if (pid) sendState(pid); return;
    }
  }

  function onJoin(conn, msg) {
    var pid = String(msg.pid || '').slice(0, 40);
    var name = CG.cleanName(msg.name);
    if (!pid) return;
    var reply = function (m) { try { conn.send(m); } catch (e) { /* ignore */ } };

    if (G.banned.indexOf(pid) >= 0) { reply({ t: 'kicked' }); setTimeout(function () { conn.close(); }, 500); return; }

    var p = G.players[pid];
    if (!p) {
      if (!name) { reply({ t: 'error', code: 'name', message: 'Please type a nickname.' }); return; }
      var clash = playerList().find(function (x) { return x.name.toLowerCase() === name.toLowerCase(); });
      if (clash && isOnline(clash.pid)) {
        reply({ t: 'error', code: 'name-taken', message: '“' + name + '” is already taken. Add an initial or a number.' });
        return;
      }
      if (clash) {
        p = clash; // same nickname coming back on a new browser: let them continue with their score
      } else if (G.phase === 'podium') {
        reply({ t: 'error', code: 'over', message: 'This game has already ended.' });
        return;
      } else {
        p = { pid: pid, name: name, joinedAt: now(), answers: {} };
        G.players[pid] = p;
        G.order.push(pid);
      }
    }
    var old = conns[p.pid];
    if (old && old !== conn) { old._pid = null; try { old.close(); } catch (e) { /* ignore */ } }
    conn._pid = p.pid;
    conns[p.pid] = conn;
    online[p.pid] = { lastSeen: now() };
    reply({ t: 'welcome', pid: p.pid, name: p.name, room: G.room });
    sendState(p.pid);
    onPlayersChanged();
    saveSoon();
  }

  function onAnswer(pid, msg) {
    var p = G.players[pid];
    if (!p) return;
    if (G.phase !== 'question' || G.paused || msg.qi !== G.qIndex || p.answers[G.qIndex]) { sendState(pid); return; }
    var q = cur();
    var a = msg.a;
    if (q.type === 'id') {
      a = String(a == null ? '' : a).replace(/\s+/g, ' ').trim().slice(0, CG.MAX_TEXT_ANSWER);
      if (!CG.normalizeAnswer(a)) { sendState(pid); return; }
    } else {
      a = Number(a);
      if (!Number.isInteger(a) || a < 0 || a >= q.options.length) { sendState(pid); return; }
    }
    var limit = q.time * 1000;
    var ms = Math.max(0, Math.min(limit, limit - remaining()));
    var correct = CG.isCorrect(q, a, G.extra[G.qIndex]);
    p.answers[G.qIndex] = { a: a, ms: ms, correct: correct, points: correct ? CG.pointsFor(ms, limit) : 0 };
    sendState(pid);
    updateLive();
    saveSoon();
    maybeAutoReveal();
  }

  function maybeAutoReveal() {
    if (!G.autoReveal || G.phase !== 'question') return;
    var on = playerList().filter(function (p) { return isOnline(p.pid); });
    if (!on.length) return;
    var all = on.every(function (p) { return p.answers[G.qIndex]; });
    if (all) {
      clearTimeout(autoRevealTimer);
      var qi = G.qIndex;
      autoRevealTimer = setTimeout(function () { if (G && G.phase === 'question' && G.qIndex === qi && !G.paused) reveal(); }, 900);
    }
  }

  function heartbeat() {
    if (!G) return;
    var t = now();
    Object.keys(conns).forEach(function (pid) {
      var o = online[pid];
      if (!o || t - o.lastSeen > PLAYER_TIMEOUT_MS) {
        var c = conns[pid];
        delete conns[pid];
        delete online[pid];
        if (c) { c._pid = null; try { c.close(); } catch (e) { /* ignore */ } }
        onPlayersChanged();
      } else {
        send(pid, { t: 'ping' });
      }
    });
  }

  function onPlayersChanged() {
    if (!G) return;
    var n = G.order.length, on = onlineCount();
    $('#playerCountChip').textContent = plural(n, 'player') + (on < n ? ' · ' + on + ' online' : '');
    if (G.phase === 'lobby') renderPlayers();
    updateLive();
    maybeAutoReveal();
  }

  /* ------------------------------------------------------------------ */
  /* State sent to each phone                                           */
  /* ------------------------------------------------------------------ */

  function stateFor(p, table) {
    var row = table.find(function (r) { return r.p === p; }) || { score: 0, rank: table.length + 1, correct: 0 };
    var msg = { t: 'state', phase: G.phase, name: p.name, title: G.set.title, score: row.score, rank: row.rank, players: table.length };
    if (G.qIndex >= 0 && G.phase !== 'podium' && G.phase !== 'lobby') {
      var q = cur();
      msg.q = {
        i: G.qIndex, n: G.qIndex + 1, total: total(), type: q.type, text: q.text,
        options: q.type === 'id' ? null : q.options,
        time: q.time * 1000, remaining: remaining(), paused: G.paused,
        introLeft: G.phase === 'intro' ? Math.max(0, G.introEnd - now()) : 0
      };
      var a = p.answers[G.qIndex];
      msg.my = { answered: !!a, a: a ? a.a : null };
      if (G.phase === 'reveal' || G.phase === 'leaderboard') {
        msg.reveal = { correct: q.type === 'id' ? null : q.correct, correctText: CG.correctText(q), trick: q.trick, explanation: q.explanation, skipped: G.skipped.indexOf(G.qIndex) >= 0 };
        msg.my.correct = !!(a && a.correct);
        msg.my.points = a && a.correct ? a.points : 0;
      }
    }
    if (G.phase === 'podium') {
      msg.final = { rank: row.rank, score: row.score, correct: row.correct, played: G.revealed.length,
        top: table.slice(0, 3).map(function (r) { return { name: r.name, score: r.score, rank: r.rank }; }) };
    }
    return msg;
  }

  /* ------------------------------------------------------------------ */
  /* Game flow                                                          */
  /* ------------------------------------------------------------------ */

  function clearTimers() {
    clearInterval(tickTimer); tickTimer = null;
    clearTimeout(introTimer); introTimer = null;
    clearTimeout(autoRevealTimer); autoRevealTimer = null;
  }

  function goIntro(qi) {
    clearTimers();
    G.qIndex = qi;
    G.phase = 'intro';
    G.paused = false;
    G.introEnd = now() + INTRO_MS;
    introTimer = setTimeout(startQuestion, INTRO_MS);
    afterChange();
  }

  function startQuestion() {
    clearTimers();
    var q = cur();
    G.phase = 'question';
    G.paused = false;
    G.deadline = now() + q.time * 1000;
    tickTimer = setInterval(tick, 200);
    afterChange();
  }

  function tick() {
    if (!G || G.phase !== 'question') return;
    updateLive();
    if (!G.paused && remaining() <= 0) reveal();
  }

  function togglePause() {
    if (G.phase !== 'question') return;
    if (G.paused) {
      G.deadline = now() + G.remaining;
      G.paused = false;
      if (!tickTimer) tickTimer = setInterval(tick, 200);
    } else {
      G.remaining = remaining();
      G.paused = true;
    }
    afterChange(true);
  }

  function reveal() {
    if (G.phase !== 'question' && G.phase !== 'intro') return;
    clearTimers();
    G.phase = 'reveal';
    if (G.revealed.indexOf(G.qIndex) < 0) G.revealed.push(G.qIndex);
    afterChange();
  }

  function skip() {
    if (G.phase !== 'question' && G.phase !== 'intro') return;
    clearTimers();
    var qi = G.qIndex;
    playerList().forEach(function (p) { delete p.answers[qi]; });
    if (G.skipped.indexOf(qi) < 0) G.skipped.push(qi);
    H.toast('Skipped question ' + (qi + 1) + ' (no points given)');
    if (qi + 1 < total()) goIntro(qi + 1);
    else podium();
  }

  function showLeaderboard() {
    G.phase = 'leaderboard';
    afterChange();
  }

  function next() {
    if (!G) return;
    switch (G.phase) {
      case 'lobby':
        if (!G.order.length && !confirm('No students have joined yet. Start anyway?')) return;
        G.startedPlayAt = now();
        goIntro(0);
        break;
      case 'intro': startQuestion(); break;
      case 'question': reveal(); break;
      case 'reveal': showLeaderboard(); break;
      case 'leaderboard':
        if (G.qIndex + 1 < total()) goIntro(G.qIndex + 1); else podium();
        break;
    }
  }

  function podium() {
    clearTimers();
    G.phase = 'podium';
    G.finishedAt = now();
    H.addHistory({ id: G.id, kind: 'live', title: G.set.title, room: G.room, startedAt: G.startedAt, endedAt: G.finishedAt, rows: resultRows() });
    afterChange();
  }

  function acceptAlternative(raw) {
    var qi = G.qIndex;
    var q = cur();
    (G.extra[qi] = G.extra[qi] || []).push(raw);
    var key = CG.normalizeAnswer(raw);
    var changed = 0;
    playerList().forEach(function (p) {
      var a = p.answers[qi];
      if (a && !a.correct && CG.normalizeAnswer(a.a) === key) {
        a.correct = true;
        a.points = CG.pointsFor(a.ms, q.time * 1000);
        changed++;
      }
    });
    H.toast('Accepted “' + raw + '” — ' + plural(changed, 'student') + ' now marked correct');
    afterChange();
  }

  function afterChange(keepStage) {
    saveNow();
    broadcast();
    if (keepStage) updateLive(); else renderStage();
    renderControls();
  }

  /* ------------------------------------------------------------------ */
  /* Results                                                            */
  /* ------------------------------------------------------------------ */

  function resultRows() {
    var header = ['Rank', 'Nickname', 'Score', 'Correct answers', 'Questions answered', 'Questions played', 'Time joined'];
    var played = G.revealed.slice().sort(function (a, b) { return a - b; });
    played.forEach(function (qi) { header.push('Q' + (qi + 1) + ' correct (1/0)'); });
    var rows = [header];
    standings().forEach(function (r) {
      var row = [r.rank, r.name, r.score, r.correct, r.answered, played.length, CG.formatDateTime(r.p.joinedAt)];
      played.forEach(function (qi) { var a = r.p.answers[qi]; row.push(a ? (a.correct ? 1 : 0) : ''); });
      rows.push(row);
    });
    return rows;
  }

  function downloadCSV() {
    H.downloadHistoryCSV({ title: G.set.title, startedAt: G.startedAt, room: G.room, rows: resultRows() });
  }

  function showFullResults() {
    var rows = resultRows();
    var d = document.createElement('dialog');
    d.setAttribute('aria-labelledby', 'allResultsTitle');
    d.innerHTML = '<h2 id="allResultsTitle">All results — ' + esc(G.set.title) + '</h2><div style="overflow:auto;max-height:65vh" tabindex="0" role="region" aria-label="Results table"><table class="results-table"><thead><tr>' +
      rows[0].slice(0, 7).map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.slice(1).map(function (r) { return '<tr>' + r.slice(0, 7).map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div><div class="row" style="margin-top:1em"><span class="spacer"></span><button class="btn" data-x="csv">⬇ Download CSV</button><button class="btn btn-primary" data-x="close">Close</button></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) {
      var b = e.target.closest('[data-x]');
      if (!b) return;
      if (b.dataset.x === 'csv') downloadCSV();
      if (b.dataset.x === 'close') { d.close(); d.remove(); }
    });
    d.addEventListener('close', function () { d.remove(); });
    d.showModal();
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                          */
  /* ------------------------------------------------------------------ */

  function optionHtml(q, k, extra) {
    return '<div class="option opt-' + k + (extra && extra.cls ? ' ' + extra.cls : '') + '"><span class="shape" aria-hidden="true">' + CG.SHAPES[k] + '</span>' +
      '<span class="opt-label">' + esc(q.options[k]) + '</span>' + (extra && extra.after ? extra.after : '') + '</div>';
  }

  function renderStage() {
    var st = $('#stage');
    if (G.phase !== 'reveal') document.querySelectorAll('.trick-overlay').forEach(function (o) { o.remove(); });
    var q = G.qIndex >= 0 ? cur() : null;
    $('#gameJoinHint').innerHTML = G.phase === 'lobby' ? '' : 'Join: ' + esc(shortUrl()) + ' · code <b>' + esc(G.room) + '</b>';

    if (G.phase === 'lobby') {
      st.innerHTML = '<div class="lobby">' +
        '<div class="join-panel card">' +
        '<div class="step">1. On your phone, go to</div><div class="url">' + esc(shortUrl()) + '</div>' +
        '<div class="step" style="margin-top:0.5em">2. Enter the room code</div><div class="room-code" id="roomCode">' + esc(G.room) + '</div>' +
        '<div class="qr" id="qrBox" role="img" aria-label="QR code that opens the join page with this room code"></div><div class="step" style="font-size:1rem;margin-top:0.4em">or scan the QR code</div></div>' +
        '<div><div class="players-head"><span class="count" id="lobbyCount">0</span> <span>joined</span></div>' +
        '<div class="player-cloud" id="playerCloud"></div>' +
        '<p class="muted lobby-note">' + esc(G.set.title) + ' · ' + plural(total(), 'question') + '. Click a name to remove a player. ' +
        '<label class="check" style="margin-left:0.6em"><input type="checkbox" id="autoReveal"' + (G.autoReveal ? ' checked' : '') + '> Reveal the answer as soon as everyone has answered</label></p>' +
        '</div></div>';
      $('#autoReveal').onchange = function () { G.autoReveal = this.checked; saveSoon(); };
      renderQR();
      renderPlayers();
      return;
    }

    if (G.phase === 'intro') {
      st.innerHTML = '<div class="intro"><div><div class="type">' + esc(CG.TYPE_LABELS[q.type]) + '</div>' +
        '<div class="big">Question ' + (G.qIndex + 1) + ' <span class="muted">of ' + total() + '</span></div>' +
        '<div class="q-text small" style="margin-top:3vh">' + esc(q.text) + '</div>' +
        '<div class="count" id="introCount">3</div></div></div>';
      var t0 = G.introEnd;
      (function countdown() {
        var el = $('#introCount');
        if (!el || G.phase !== 'intro') return;
        el.textContent = Math.max(1, Math.ceil((t0 - now()) / 1000));
        setTimeout(countdown, 200);
      })();
      return;
    }

    if (G.phase === 'question') {
      var body = q.type === 'id'
        ? '<div class="id-prompt">⌨️ Type your answer on your phone</div>'
        : '<div class="options">' + q.options.map(function (o, k) { return optionHtml(q, k); }).join('') + '</div>';
      st.innerHTML = '<div class="q-top"><span class="q-progress">Question ' + (G.qIndex + 1) + ' / ' + total() + '</span>' +
        '<span class="spacer"></span><span class="chip">' + esc(CG.TYPE_LABELS[q.type]) + '</span></div>' +
        '<div class="q-text">' + esc(q.text) + '</div>' +
        '<div class="q-middle"><div class="timer" id="timer"><span id="timerNum"></span></div>' +
        '<div class="answer-count"><span id="ansCount">0</span><small>answers</small></div></div>' + body;
      updateLive();
      return;
    }

    if (G.phase === 'reveal') { renderReveal(st, q); return; }

    if (G.phase === 'leaderboard') {
      var table = standings();
      var lastQ = G.revealed[G.revealed.length - 1];
      var right = playerList().filter(function (p) { var a = p.answers[lastQ]; return a && a.correct; }).length;
      st.innerHTML = '<h1 class="board-title">🏆 Top 5</h1><div class="board">' +
        (table.length ? table.slice(0, 5).map(function (r, i) {
          return '<div class="board-row" style="animation-delay:' + (i * 0.08) + 's"><span class="rk">' + r.rank + '</span><span class="nm">' + esc(r.name) + '</span>' +
            (r.gain ? '<span class="gain">+' + r.gain + '</span>' : '') + '<span class="sc">' + r.score + '</span></div>';
        }).join('') : '<div class="empty">No players</div>') +
        '</div><p class="center stat-line">After question ' + (G.qIndex + 1) + ' of ' + total() + ' · ' + right + ' of ' + table.length + ' got it right</p>';
      return;
    }

    if (G.phase === 'podium') {
      var tb = standings();
      var pods = [2, 1, 3].map(function (pos) {
        var r = tb[pos - 1];
        if (!r) return '<div class="pod p' + pos + '" style="visibility:hidden"><div class="block">' + pos + '</div></div>';
        return '<div class="pod p' + pos + '"><div class="pname">' + esc(r.name) + '</div><div class="pscore">' + r.score + ' pts · ' + r.correct + ' correct</div>' +
          '<div class="block">' + r.rank + '</div></div>';
      }).join('');
      st.innerHTML = '<h1 class="board-title">🎉 Final results</h1><div class="podium">' + pods + '</div>' +
        '<p class="center muted">' + esc(G.set.title) + ' · ' + plural(tb.length, 'player') + ' · ' + plural(G.revealed.length, 'question') + ' played</p>';
      confetti();
      return;
    }
  }

  function renderReveal(st, q) {
    var players = playerList();
    var answered = players.filter(function (p) { return p.answers[G.qIndex]; });
    var right = answered.filter(function (p) { return p.answers[G.qIndex].correct; }).length;
    var pct = answered.length ? Math.round(100 * right / answered.length) : 0;
    var h = '<div class="q-top"><span class="q-progress">Question ' + (G.qIndex + 1) + ' / ' + total() + '</span>' +
      (q.trick ? '<span class="trick-badge">🎭 Trick question!</span>' : '') + '<span class="spacer"></span>' +
      '<span class="stat-line"><span class="pct">' + right + '</span> of ' + answered.length + ' correct' + (answered.length ? ' (' + pct + '%)' : '') + '</span></div>' +
      '<div class="q-text small">' + esc(q.text) + '</div>';

    if (q.type === 'id') {
      var also = q.accepted.slice(1).concat(G.extra[G.qIndex] || []);
      var alsoText = also.slice(0, 4).join(' · ') + (also.length > 4 ? ' · …' : '');
      h += '<div class="id-answer">✓ ' + esc(q.accepted[0]) + (also.length ? '<small>Also accepted: ' + esc(alsoText) + '</small>' : '') + '</div>';
      var groups = {};
      answered.forEach(function (p) {
        var a = p.answers[G.qIndex];
        var key = CG.normalizeAnswer(a.a);
        var g = groups[key] || (groups[key] = { raw: a.a, n: 0, ok: a.correct });
        g.n++;
      });
      var list = Object.keys(groups).map(function (k) { return groups[k]; })
        .sort(function (a, b) { return (b.ok - a.ok) || (b.n - a.n); });
      if (list.length) {
        h += '<div><div class="muted" style="margin-bottom:0.4em;font-weight:700">What the class typed' + (list.some(function (g) { return !g.ok; }) ? ' — click ✓ to accept an answer you think is right' : '') + ':</div><div class="typed-list">' +
          list.slice(0, 30).map(function (g) {
            return '<span class="typed' + (g.ok ? ' ok' : '') + '">' + esc(g.raw) + ' <span class="n">' + g.n + '</span>' +
              (g.ok ? '' : '<button class="btn btn-small btn-good" data-accept="' + esc(g.raw) + '" title="Accept this answer as correct">✓</button>') + '</span>';
          }).join('') + (list.length > 30 ? '<span class="muted">…and ' + (list.length - 30) + ' more</span>' : '') + '</div></div>';
      }
    } else {
      var counts = q.options.map(function () { return 0; });
      answered.forEach(function (p) { counts[p.answers[G.qIndex].a]++; });
      var max = Math.max.apply(null, counts.concat([1]));
      h += '<div class="options">' + q.options.map(function (o, k) {
        return optionHtml(q, k, {
          cls: k === q.correct ? 'right' : 'dim',
          after: (k === q.correct ? '<span class="check-mark" aria-label="correct answer">✓</span>' : '') + '<span class="tally"><span class="sr-only">answers: </span>' + counts[k] + '</span><span class="bar" data-w="' + (100 * counts[k] / max) + '"></span>'
        });
      }).join('') + '</div>';
    }
    if (q.explanation) h += '<div class="explain"><b>Why?</b> ' + esc(q.explanation) + '</div>';
    st.innerHTML = h;
    requestAnimationFrame(function () {
      st.querySelectorAll('.bar[data-w]').forEach(function (b) { b.style.width = b.dataset.w + '%'; });
    });
    st.querySelectorAll('[data-accept]').forEach(function (b) {
      b.onclick = function () { acceptAlternative(b.dataset.accept); };
    });
    if (q.trick && shownTrickFor !== G.qIndex) {
      shownTrickFor = G.qIndex;
      var ov = document.createElement('div');
      ov.className = 'trick-overlay';
      ov.setAttribute('aria-hidden', 'true');
      ov.innerHTML = '<div class="stamp">🎭 Trick<br>question!<small>Not what it seemed…</small></div>';
      document.body.appendChild(ov);
      setTimeout(function () { ov.remove(); }, 2700);
    }
  }

  function confetti() {
    var colors = ['#ffd23f', '#e5484d', '#3e63dd', '#2fbf71', '#ffffff', '#d6409f'];
    for (var i = 0; i < 90; i++) {
      var c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = (3 + Math.random() * 3) + 's';
      c.style.animationDelay = (1.8 + Math.random() * 1.5) + 's';
      c.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
      document.body.appendChild(c);
      setTimeout(c.remove.bind(c), 9000);
    }
  }

  function renderPlayers() {
    var cloud = $('#playerCloud');
    if (!cloud) return;
    var list = playerList();
    $('#lobbyCount').textContent = list.length;
    cloud.innerHTML = list.length ? list.map(function (p) {
      var isNew = !tagsShown[p.pid];
      tagsShown[p.pid] = true;
      return '<button class="player-tag' + (isNew ? ' new' : '') + (isOnline(p.pid) ? '' : ' off') + '" data-pid="' + esc(p.pid) + '" title="Click to remove" aria-label="' + esc(p.name) + (isOnline(p.pid) ? '' : ' (offline)') + '. Click to remove from the game">' + esc(p.name) + '</button>';
    }).join('') : '<span class="lobby-empty">Waiting for students to join…</span>';
  }

  function renderLobbyIfShown() { if (G && G.phase === 'lobby') renderStage(); }

  function renderQR() {
    var box = $('#qrBox');
    if (!box) return;
    var draw = function () {
      var b = $('#qrBox');
      if (!b || !window.qrcode) return;
      var qr = window.qrcode(0, 'M');
      qr.addData(joinUrl());
      qr.make();
      b.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    };
    if (qrLib) return qrLib.then(draw);
    qrLib = CG.loadScript(CG.LIBS.qr, 'qrcode').then(draw, function () { box.hidden = true; });
  }

  /** Fast-changing bits (timer, answer count) without rebuilding the stage. */
  function updateLive() {
    if (!G || G.phase !== 'question') return;
    var q = cur();
    var rem = remaining();
    var timer = $('#timer');
    if (timer) {
      timer.style.setProperty('--p', Math.max(0, rem / (q.time * 1000)).toFixed(3));
      timer.classList.toggle('low', !G.paused && rem <= 5000);
      timer.classList.toggle('paused', G.paused);
      $('#timerNum').textContent = G.paused ? 'PAUSED' : Math.ceil(rem / 1000);
    }
    var n = playerList().filter(function (p) { return p.answers[G.qIndex]; }).length;
    var el = $('#ansCount');
    if (el) {
      el.textContent = n;
      el.nextElementSibling.textContent = 'of ' + G.order.length + ' answered';
    }
    var pb = $('#btnPause');
    if (pb) pb.textContent = G.paused ? '▶ Resume' : '⏸ Pause';
  }

  function renderControls() {
    var ph = G.phase;
    $('#btnPause').hidden = ph !== 'question';
    $('#btnPause').textContent = G.paused ? '▶ Resume' : '⏸ Pause';
    $('#btnSkip').hidden = !(ph === 'question' || ph === 'intro');
    $('#btnEndGame').hidden = ph === 'podium';
    $('#btnEndGame').textContent = ph === 'lobby' ? 'Close room' : 'End game';
    var foot = $('#stageFoot');
    var label = {
      lobby: 'Start game ▶',
      intro: 'Start now ▶',
      question: 'Show answer now',
      reveal: 'Leaderboard ▶',
      leaderboard: G.qIndex + 1 < total() ? 'Next question ▶' : 'Final results 🏆'
    }[ph];
    if (ph === 'podium') {
      foot.innerHTML = '<button class="btn btn-primary btn-big" data-cmd="csv">⬇ Download results (CSV)</button>' +
        '<button class="btn btn-big" data-cmd="all">📋 All results</button><span class="spacer"></span>' +
        '<button class="btn" data-cmd="exit">Close room &amp; back to my sets</button>';
    } else {
      foot.innerHTML = '<span class="kbd-hint">Keys: Space = next · P = pause · F = full screen</span><span class="spacer"></span>' +
        '<button class="btn btn-primary btn-big" data-cmd="next" id="btnNext">' + label + '</button>';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Starting, resuming, leaving                                        */
  /* ------------------------------------------------------------------ */

  function bindOnce() {
    if (bindOnce.done) return;
    bindOnce.done = true;
    window.addEventListener('pagehide', saveNow);
    $('#stageFoot').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cmd]');
      if (!b || !G) return;
      if (b.dataset.cmd === 'next') next();
      if (b.dataset.cmd === 'csv') downloadCSV();
      if (b.dataset.cmd === 'all') showFullResults();
      if (b.dataset.cmd === 'exit') exit(false);
    });
    $('#stage').addEventListener('click', function (e) {
      var tag = e.target.closest('.player-tag');
      if (tag && G) kick(tag.dataset.pid);
    });
    $('#btnPause').onclick = function () { togglePause(); };
    // After a mouse click, give focus back to the page so Space/P/F shortcuts keep working.
    $('#view-game').addEventListener('click', H.blurAfterMouse);
    $('#btnSkip').onclick = function () { if (confirm('Skip this question? Nobody gets points for it.')) skip(); };
    $('#btnFullscreen').onclick = H.toggleFullscreen;
    $('#btnEndGame').onclick = function () {
      if (!G) return;
      if (G.phase === 'lobby') { if (confirm('Close this room and go back to your sets?')) exit(true); return; }
      if (confirm('End the game now and show the final results?')) podium();
    };
    document.addEventListener('keydown', function (e) {
      if (H.view !== 'game' || !G) return;
      if (H.skipShortcut(e)) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        if (G.phase !== 'podium') { e.preventDefault(); next(); }
      } else if (e.key === 'p' || e.key === 'P') togglePause();
      else if (e.key === 'f' || e.key === 'F') H.toggleFullscreen();
    });
  }

  function kick(pid) {
    var p = G.players[pid];
    if (!p || !confirm('Remove “' + p.name + '” from the game?')) return;
    send(pid, { t: 'kicked' });
    G.banned.push(pid);
    var c = conns[pid];
    setTimeout(function () { if (c) try { c.close(); } catch (e) { /* ignore */ } }, 400);
    delete conns[pid];
    delete online[pid];
    delete G.players[pid];
    G.order = G.order.filter(function (x) { return x !== pid; });
    onPlayersChanged();
    saveSoon();
  }

  function launch() {
    bindOnce();
    conns = {};
    online = {};
    shownTrickFor = G.phase === 'reveal' ? G.qIndex : -1;
    H.show('game');
    onPlayersChanged();
    renderStage();
    renderControls();
    clearInterval(pingTimer);
    pingTimer = setInterval(heartbeat, PING_MS);
    setNet('wait', 'Loading…');
    CG.loadScript(CG.LIBS.peer, 'Peer').then(openPeer, function () {
      setNet('bad', 'Could not load the connection library (no internet?). Use Projector mode instead.');
    });
  }

  function start(set) {
    keepCode = false;
    G = {
      id: CG.makeId('game_'), room: CG.makeRoomCode(), set: set, phase: 'lobby', qIndex: -1,
      players: {}, order: [], banned: [], revealed: [], skipped: [], extra: {},
      startedAt: now(), deadline: 0, remaining: 0, paused: false, introEnd: 0, autoReveal: true
    };
    saveNow();
    launch();
  }

  function resume(saved) {
    keepCode = true;
    G = saved;
    G.extra = G.extra || {};
    if (G.phase === 'intro' || G.phase === 'question') {
      // Come back paused so nobody loses time while phones reconnect.
      var full = cur().time * 1000;
      var rem = G.phase === 'question' ? (G.paused ? G.remaining : G.deadline - G.savedAt) : full;
      G.phase = 'question';
      G.paused = true;
      G.remaining = Math.max(5000, Math.min(full, rem || full));
      tickTimer = setInterval(tick, 200);
      H.toast('Game resumed and paused. Press ▶ Resume when students have reconnected.', 6000);
    }
    launch();
  }

  function exit(silent) {
    if (!silent && !confirm('Close the room? Students will be disconnected. Results stay under “Past game results”.')) return;
    clearTimers();
    clearInterval(pingTimer);
    clearTimeout(retryTimer);
    Object.keys(conns).forEach(function (pid) { send(pid, { t: 'closed' }); });
    var p = peer;
    peer = null;
    setTimeout(function () { if (p) try { p.destroy(); } catch (e) { /* ignore */ } }, 600);
    CG.storage.remove(K.activeGame);
    G = null;
    if (document.fullscreenElement) try { document.exitFullscreen(); } catch (e) { /* ignore */ }
    H.goHome();
  }

  // Exposed for the automated tests.
  function debugState() { return G ? JSON.parse(JSON.stringify(G)) : null; }

  return { start: start, resume: resume, next: next, debugState: debugState };
})(Host);
