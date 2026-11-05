/*
 * Classroom Game — Projector mode. Needs no phones and no internet:
 * the teacher reveals each question and answer, and taps team tiles to award points.
 */
Host.Projector = (function (H) {
  'use strict';

  var $ = H.$, esc = H.esc, plural = H.plural;
  var K = CG.STORAGE_KEYS;
  var P = null;
  var timerInt = null;

  function cur() { return P.set.questions[P.qIndex]; }
  function save() { if (P) { P.savedAt = Date.now(); CG.storage.set(K.projector, P); } }

  function start(set) {
    P = {
      id: CG.makeId('proj_'), set: set, phase: 'setup', qIndex: 0, step: 0, startedAt: Date.now(),
      teams: ['Team 1', 'Team 2', 'Team 3', 'Team 4'].map(function (n) { return { name: n, score: 0 }; }),
      timerEnd: 0, timerLeft: 0, timerRunning: false
    };
    open();
  }

  function resume(saved) {
    P = saved;
    if (P.timerRunning) { P.timerRunning = false; P.timerLeft = Math.max(0, P.timerEnd - P.savedAt); }
    open();
  }

  function open() {
    bindOnce();
    $('#projTitle').textContent = P.set.title;
    H.show('projector');
    render();
  }

  /* ------------------------------------------------------------------ */

  function render() {
    document.querySelectorAll('.trick-overlay').forEach(function (o) { o.remove(); });
    clearInterval(timerInt);
    timerInt = null;
    if (P.phase === 'setup') return renderSetup();
    if (P.phase === 'final') return renderFinal();
    renderQuestion();
    renderTeams();
    if (P.timerRunning) timerInt = setInterval(updateTimer, 200);
    save();
  }

  function renderSetup() {
    $('#teamStrip').innerHTML = '';
    $('#projStage').innerHTML = '<div class="view teams-setup" style="margin:0 auto;width:100%">' +
      '<h1>Set up teams</h1><p class="muted">Projector mode needs no phones and no internet. You show each question, reveal the answer, then tap a team to give it a point.</p>' +
      '<div id="teamInputs">' + P.teams.map(function (t, i) {
        return '<div class="team-input-row"><span class="swatch team-' + i + '" style="width:2.6em;border-radius:10px"></span>' +
          '<input data-team="' + i + '" value="' + esc(t.name) + '" maxlength="24" aria-label="Team ' + (i + 1) + ' name">' +
          '<button class="btn btn-ghost" data-rm="' + i + '"' + (P.teams.length <= 2 ? ' disabled' : '') + ' title="Remove team">✕</button></div>';
      }).join('') + '</div>' +
      (P.teams.length < 8 ? '<button class="btn" id="addTeam">＋ Add team</button>' : '') +
      '<p class="muted">' + esc(P.set.title) + ' · ' + plural(P.set.questions.length, 'question') + '</p></div>';
    $('#projFoot').innerHTML = '<span class="spacer"></span><button class="btn btn-primary btn-big" data-pcmd="begin">Start ▶</button>';
    $('#teamInputs').oninput = function (e) {
      var i = e.target.dataset.team;
      if (i != null) P.teams[i].name = e.target.value.slice(0, 24);
    };
    $('#teamInputs').onclick = function (e) {
      var b = e.target.closest('[data-rm]');
      if (b && P.teams.length > 2) { P.teams.splice(Number(b.dataset.rm), 1); renderSetup(); }
    };
    if ($('#addTeam')) $('#addTeam').onclick = function () { P.teams.push({ name: 'Team ' + (P.teams.length + 1), score: 0 }); renderSetup(); };
  }

  function optionsHtml(q, revealed) {
    return '<div class="options">' + q.options.map(function (o, k) {
      var cls = revealed ? (k === q.correct ? ' right' : ' dim') : '';
      return '<div class="option opt-' + k + cls + '"><span class="shape">' + CG.SHAPES[k] + '</span><span class="opt-label">' + esc(o) + '</span>' +
        (revealed && k === q.correct ? '<span class="check-mark">✓</span>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function renderQuestion() {
    var q = cur();
    var n = P.set.questions.length;
    var revealed = P.step === 2;
    var h = '<div class="q-top"><span class="q-progress">Question ' + (P.qIndex + 1) + ' / ' + n + '</span>' +
      (revealed && q.trick ? '<span class="trick-badge">🎭 Trick question!</span>' : '') +
      '<span class="spacer"></span><span class="chip">' + esc(CG.TYPE_LABELS[q.type]) + '</span></div>' +
      '<div class="q-text' + (revealed ? ' small' : '') + '">' + esc(q.text) + '</div>' +
      (revealed ? '' : '<div class="q-middle"><div class="timer" id="pTimer"><span id="pTimerNum">' + q.time + '</span></div>' +
      '<div class="muted" style="font-size:1.2rem;text-align:right">After the reveal, tap a team below to give it a point.<br>Keys 1–' + P.teams.length + ' also add a point.</div></div>');
    if (q.type !== 'id') {
      if (P.step >= 1) h += optionsHtml(q, revealed);
    } else if (revealed) {
      h += '<div class="id-answer">✓ ' + esc(q.accepted[0]) + (q.accepted.length > 1 ? '<small>Also accepted: ' + esc(q.accepted.slice(1).join(' · ')) + '</small>' : '') + '</div>';
    } else {
      h += '<div class="id-prompt">✍️ Write or call out your answer</div>';
    }
    if (revealed && q.explanation) h += '<div class="explain"><b>Why?</b> ' + esc(q.explanation) + '</div>';
    $('#projStage').innerHTML = h;
    updateTimer();

    var main;
    if (P.step === 0 && q.type !== 'id') main = '<button class="btn btn-primary btn-big" data-pcmd="options">Show options ▶</button>';
    else if (P.step < 2) main = '<button class="btn btn-primary btn-big" data-pcmd="reveal">Reveal answer ▶</button>';
    else if (P.qIndex + 1 < n) main = '<button class="btn btn-primary btn-big" data-pcmd="next">Next question ▶</button>';
    else main = '<button class="btn btn-primary btn-big" data-pcmd="final">Final standings 🏆</button>';
    $('#projFoot').innerHTML =
      '<button class="btn" data-pcmd="prev"' + (P.qIndex === 0 && P.step === 0 ? ' disabled' : '') + '>◀ Back</button>' +
      '<button class="btn" data-pcmd="timer">' + (P.timerRunning ? '⏸ Pause timer' : (P.timerLeft > 0 ? '▶ Resume timer' : '⏱ Start timer')) + '</button>' +
      '<button class="btn btn-ghost" data-pcmd="final">End game</button>' +
      '<span class="kbd-hint">Space = next step · T = timer · F = full screen</span><span class="spacer"></span>' + main;

    if (revealed && q.trick && P.trickShown !== P.qIndex) {
      P.trickShown = P.qIndex;
      var ov = document.createElement('div');
      ov.className = 'trick-overlay';
      ov.innerHTML = '<div class="stamp">🎭 Trick<br>question!<small>Not what it seemed…</small></div>';
      document.body.appendChild(ov);
      setTimeout(function () { ov.remove(); }, 2700);
    }
  }

  function renderTeams() {
    $('#teamStrip').innerHTML = P.teams.map(function (t, i) {
      return '<div class="team-tile team-' + i + '" data-tadd="' + i + '" role="button" tabindex="0" aria-label="Add a point to ' + esc(t.name) + '">' +
        '<button class="minus" data-tsub="' + i + '" title="Take a point away" aria-label="Take a point from ' + esc(t.name) + '">−</button>' +
        '<span class="tname">' + esc(t.name) + '</span><span class="tscore">' + t.score + '</span><span class="tplus">tap +1 · key ' + (i + 1) + '</span></div>';
    }).join('');
  }

  function addPoint(i, delta) {
    var t = P.teams[i];
    if (!t || P.phase !== 'play') return;
    t.score = Math.max(0, t.score + delta);
    renderTeams();
    var tile = document.querySelector('[data-tadd="' + i + '"]');
    if (tile && delta > 0) tile.classList.add('bump');
    save();
  }

  function timerSeconds() {
    if (P.timerRunning) return Math.max(0, P.timerEnd - Date.now());
    if (P.timerLeft > 0) return P.timerLeft;
    return null;
  }

  function updateTimer() {
    var el = $('#pTimer');
    if (!el || !P || P.phase !== 'play') return;
    var q = cur();
    var full = q.time * 1000;
    var left = timerSeconds();
    var shown = left == null ? full : left;
    el.style.setProperty('--p', (shown / full).toFixed(3));
    el.classList.toggle('low', P.timerRunning && shown <= 5000);
    $('#pTimerNum').textContent = left === 0 ? '0' : Math.ceil(shown / 1000);
    if (P.timerRunning && left <= 0) {
      P.timerRunning = false;
      P.timerLeft = 0;
      clearInterval(timerInt);
      timerInt = null;
      H.toast("⏰ Time's up!");
      renderQuestion();
      save();
    }
  }

  function toggleTimer() {
    if (P.phase !== 'play') return;
    var q = cur();
    if (P.timerRunning) {
      P.timerLeft = Math.max(1, P.timerEnd - Date.now());
      P.timerRunning = false;
    } else {
      P.timerEnd = Date.now() + (P.timerLeft > 0 ? P.timerLeft : q.time * 1000);
      P.timerRunning = true;
      if (P.step === 0 && q.type !== 'id') P.step = 1;
    }
    render();
  }

  function resetTimer() { P.timerRunning = false; P.timerLeft = 0; P.timerEnd = 0; }

  function cmd(c) {
    if (!P) return;
    var q = P.phase === 'play' ? cur() : null;
    switch (c) {
      case 'begin':
        P.teams = P.teams.map(function (t, i) { return { name: CG.cleanName(t.name) || 'Team ' + (i + 1), score: 0 }; });
        P.phase = 'play'; P.qIndex = 0; P.step = 0; resetTimer();
        break;
      case 'options': P.step = 1; break;
      case 'reveal': P.step = 2; P.timerRunning = false; P.timerLeft = 0; break;
      case 'next': P.qIndex++; P.step = 0; resetTimer(); break;
      case 'prev':
        if (P.step > 0) P.step = (P.step === 2 && q.type === 'id') ? 0 : P.step - 1;
        else if (P.qIndex > 0) { P.qIndex--; P.step = 2; }
        resetTimer();
        break;
      case 'timer': toggleTimer(); return;
      case 'final':
        if (P.step < 2 || P.qIndex + 1 < P.set.questions.length) { if (!confirm('End the game and show the final standings?')) return; }
        P.phase = 'final';
        resetTimer();
        H.addHistory({ id: P.id, kind: 'projector', title: P.set.title, room: 'projector', startedAt: P.startedAt, endedAt: Date.now(), rows: resultRows() });
        break;
      case 'csv': H.downloadHistoryCSV({ title: P.set.title + ' teams', startedAt: P.startedAt, room: 'projector', rows: resultRows() }); return;
      case 'back': P.phase = 'play'; break;
      case 'exit': exit(); return;
    }
    render();
  }

  function standings() {
    return CG.rank(P.teams.map(function (t) { return { name: t.name, score: t.score }; }));
  }

  function resultRows() {
    var rows = [['Rank', 'Team', 'Score']];
    standings().forEach(function (r) { rows.push([r.rank, r.name, r.score]); });
    return rows;
  }

  function renderFinal() {
    var tb = standings();
    $('#teamStrip').innerHTML = '';
    var pods = [2, 1, 3].map(function (pos) {
      var r = tb[pos - 1];
      if (!r) return '<div class="pod p' + pos + '" style="visibility:hidden"><div class="block"></div></div>';
      return '<div class="pod p' + pos + '"><div class="pname">' + esc(r.name) + '</div><div class="pscore">' + plural(r.score, 'point') + '</div><div class="block">' + r.rank + '</div></div>';
    }).join('');
    $('#projStage').innerHTML = '<h1 class="board-title">🎉 Final standings</h1><div class="podium">' + pods + '</div>' +
      (tb.length > 3 ? '<p class="center stat-line">' + tb.slice(3).map(function (r) { return r.rank + '. ' + esc(r.name) + ' — ' + r.score; }).join(' · ') + '</p>' : '');
    $('#projFoot').innerHTML = '<button class="btn" data-pcmd="back">◀ Back to the game</button><button class="btn" data-pcmd="csv">⬇ Team scores (CSV)</button>' +
      '<span class="spacer"></span><button class="btn btn-primary btn-big" data-pcmd="exit">Done</button>';
    save();
  }

  function exit() {
    if (P && P.phase !== 'final' && !confirm('Leave projector mode? Scores will be lost.')) return;
    clearInterval(timerInt);
    CG.storage.remove(K.projector);
    P = null;
    if (document.fullscreenElement) try { document.exitFullscreen(); } catch (e) { /* ignore */ }
    H.goHome();
  }

  function bindOnce() {
    if (bindOnce.done) return;
    bindOnce.done = true;
    $('#projFoot').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pcmd]');
      if (b && !b.disabled) cmd(b.dataset.pcmd);
    });
    $('#teamStrip').addEventListener('click', function (e) {
      var sub = e.target.closest('[data-tsub]');
      if (sub) { addPoint(Number(sub.dataset.tsub), -1); return; }
      var add = e.target.closest('[data-tadd]');
      if (add) addPoint(Number(add.dataset.tadd), 1);
    });
    $('#projExit').onclick = exit;
    $('#projFullscreen').onclick = H.toggleFullscreen;
    document.addEventListener('keydown', function (e) {
      if (H.view !== 'projector' || !P) return;
      if (e.target.closest('input, textarea, select, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[1-8]$/.test(e.key)) { addPoint(Number(e.key) - 1, 1); return; }
      if (e.key === 'f' || e.key === 'F') { H.toggleFullscreen(); return; }
      if ((e.key === 't' || e.key === 'T') && P.phase === 'play') { toggleTimer(); return; }
      if (e.key === 'ArrowLeft' && P.phase === 'play') { cmd('prev'); return; }
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        var main = document.querySelector('#projFoot .btn-big');
        if (main) { e.preventDefault(); main.click(); }
      }
    });
  }

  return { start: start, resume: resume };
})(Host);
