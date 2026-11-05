/*
 * Classroom Game — host page: set list, editor, paste/import/export, past results.
 * The live game is in host-game.js and projector mode in host-projector.js.
 */
var Host = (function () {
  'use strict';

  var K = CG.STORAGE_KEYS;
  var esc = CG.escapeHtml;
  var H = {};
  var $ = H.$ = function (sel, rootEl) { return (rootEl || document).querySelector(sel); };
  H.esc = esc;
  H.sets = [];
  H.view = null;

  /* ------------------------------------------------------------------ */
  /* Basics                                                             */
  /* ------------------------------------------------------------------ */

  H.show = function (name) {
    ['home', 'editor', 'game', 'projector'].forEach(function (v) { $('#view-' + v).hidden = v !== name; });
    H.view = name;
    window.scrollTo(0, 0);
  };

  var toastTimer;
  H.toast = function (msg, ms) {
    var el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 3200);
  };

  H.loadSets = function () {
    var stored = CG.storage.get(K.sets, null);
    if (!Array.isArray(stored)) {
      stored = [CG.sampleSet()];
      CG.storage.set(K.sets, stored);
    }
    H.sets = stored.map(CG.cleanSet);
  };

  H.saveSets = function () {
    var ok = CG.storage.set(K.sets, H.sets);
    if (!ok) H.toast('Could not save! Browser storage may be full or blocked (private window?). Export a backup now.', 8000);
    return ok;
  };

  H.getSet = function (id) { return H.sets.find(function (s) { return s.id === id; }); };

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  H.plural = plural;

  H.toggleFullscreen = function () {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch (e) { /* not supported */ }
  };

  /* ------------------------------------------------------------------ */
  /* Home: list of sets                                                 */
  /* ------------------------------------------------------------------ */

  H.renderHome = function () {
    var grid = $('#setGrid');
    if (!H.sets.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No question sets yet.<br><br>' +
        '<button class="btn btn-primary" data-home="new">＋ Create a set</button> ' +
        '<button class="btn" data-home="sample">Add the sample set</button></div>';
    } else {
      grid.innerHTML = H.sets.map(function (s) {
        var issues = CG.validateSet(s);
        var types = {};
        s.questions.forEach(function (q) { types[q.type] = (types[q.type] || 0) + 1; });
        var typeText = Object.keys(types).map(function (t) { return types[t] + ' ' + CG.TYPE_LABELS[t].toLowerCase(); }).join(', ');
        return '<div class="card set-card" data-id="' + esc(s.id) + '">' +
          '<h3>' + esc(s.title) + '</h3>' +
          '<div class="meta">' + plural(s.questions.length, 'question') + (typeText ? ' · ' + esc(typeText) : '') +
          '<br>Updated ' + esc(CG.formatDateTime(s.updatedAt).slice(0, 16)) + '</div>' +
          (issues.length ? '<div><span class="chip warn">⚠ ' + (issues[0].index < 0 ? 'No questions yet' : plural(issues.length, 'question') + ' need fixing') + '</span></div>' : '') +
          '<div class="actions">' +
          '<button class="btn btn-primary btn-small" data-act="play">▶ Play live</button>' +
          '<button class="btn btn-small" data-act="projector">📽 Projector mode</button>' +
          '<button class="btn btn-small" data-act="edit">✏️ Edit</button>' +
          '<button class="btn btn-small" data-act="dup">⧉ Duplicate</button>' +
          '<button class="btn btn-small" data-act="export">⬇ Export</button>' +
          '<button class="btn btn-small btn-ghost" data-act="delete" title="Delete set">🗑 Delete</button>' +
          '</div></div>';
      }).join('');
    }
    H.renderResumeBanner();
    H.renderHistory();
  };

  H.goHome = function () {
    H.loadSets();
    H.renderHome();
    H.show('home');
  };

  H.newSet = function (title, questions) {
    var s = CG.cleanSet({ title: title || 'New set', questions: questions || [CG.blankQuestion('mc')] });
    H.sets.unshift(s);
    H.saveSets();
    return s;
  };

  H.duplicateSet = function (id) {
    var src = H.getSet(id);
    if (!src) return;
    var copy = CG.clone(src);
    copy.id = CG.makeId('set_');
    copy.title = src.title + ' (copy)';
    copy.createdAt = copy.updatedAt = Date.now();
    copy.questions.forEach(function (q) { q.id = CG.makeId('q_'); });
    H.sets.splice(H.sets.indexOf(src) + 1, 0, copy);
    H.saveSets();
    H.renderHome();
    H.toast('Duplicated "' + src.title + '"');
  };

  H.deleteSet = function (id) {
    var s = H.getSet(id);
    if (!s) return;
    if (!confirm('Delete "' + s.title + '"?\n\nThis cannot be undone (unless you exported a backup).')) return;
    H.sets.splice(H.sets.indexOf(s), 1);
    H.saveSets();
    H.renderHome();
    H.toast('Deleted "' + s.title + '"');
  };

  /** Checks a set before playing. Returns a playable copy, or null (and opens the editor). */
  H.prepareForPlay = function (id) {
    var s = H.getSet(id);
    if (!s) return null;
    var issues = CG.validateSet(s);
    if (issues.length) {
      alert('This set is not ready to play yet:\n\n' + issues.slice(0, 6).map(function (it) {
        return (it.index >= 0 ? 'Question ' + (it.index + 1) + ': ' : '') + it.problems.join(' ');
      }).join('\n') + '\n\nThe editor will open so you can fix it.');
      H.editSet(id);
      return null;
    }
    var copy = CG.clone(s);
    copy.questions = copy.questions.map(CG.playableQuestion);
    return copy;
  };

  function onHomeClick(e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.home === 'new') return H.editSet(H.newSet().id);
    if (b.dataset.home === 'sample') {
      var sample = CG.sampleSet();
      if (H.getSet(sample.id)) sample.id = CG.makeId('set_');
      H.sets.unshift(sample);
      H.saveSets();
      return H.renderHome();
    }
    var card = b.closest('[data-id]');
    if (!card) return;
    var id = card.dataset.id;
    switch (b.dataset.act) {
      case 'play': var p = H.prepareForPlay(id); if (p) H.Game.start(p); break;
      case 'projector': var pp = H.prepareForPlay(id); if (pp) H.Projector.start(pp); break;
      case 'edit': H.editSet(id); break;
      case 'dup': H.duplicateSet(id); break;
      case 'export': H.exportSets([H.getSet(id)], 'classroom-game-' + CG.slug(H.getSet(id).title) + '.json'); break;
      case 'delete': H.deleteSet(id); break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Import / export                                                    */
  /* ------------------------------------------------------------------ */

  H.exportSets = function (sets, filename) {
    var data = { app: CG.APP, version: CG.FORMAT_VERSION, exportedAt: new Date().toISOString(), sets: sets.map(CG.cleanSet) };
    CG.download(filename, JSON.stringify(data, null, 2), 'application/json');
    H.toast('Downloaded ' + filename);
  };

  H.importText = function (text) {
    var data;
    try { data = JSON.parse(text); } catch (e) {
      alert('That file is not a Classroom Game backup (it is not valid JSON).');
      return;
    }
    var list = Array.isArray(data) ? data : Array.isArray(data.sets) ? data.sets : (data && Array.isArray(data.questions) ? [data] : null);
    if (!list) { alert('No question sets were found in that file.'); return; }
    var incoming = list.map(CG.cleanSet);
    var clashes = incoming.filter(function (s) { return H.getSet(s.id); });
    var replace = false;
    if (clashes.length) {
      replace = confirm(plural(clashes.length, 'set') + ' in this file already exist here:\n\n' +
        clashes.slice(0, 8).map(function (s) { return '• ' + s.title; }).join('\n') +
        '\n\nOK = replace them with the versions from the file\nCancel = keep both (imported copies get "(imported)" in the title)');
    }
    incoming.forEach(function (s) {
      var existing = H.getSet(s.id);
      if (existing && replace) {
        H.sets[H.sets.indexOf(existing)] = s;
      } else {
        if (existing) { s.id = CG.makeId('set_'); s.title += ' (imported)'; }
        H.sets.unshift(s);
      }
    });
    H.saveSets();
    H.renderHome();
    H.toast('Imported ' + plural(incoming.length, 'set'));
  };

  /* ------------------------------------------------------------------ */
  /* Past results                                                       */
  /* ------------------------------------------------------------------ */

  H.getHistory = function () { return CG.storage.get(K.history, []) || []; };

  H.addHistory = function (entry) {
    var list = H.getHistory().filter(function (h) { return h.id !== entry.id; });
    list.unshift(entry);
    list = list.slice(0, 40);
    while (!CG.storage.set(K.history, list) && list.length > 1) list.pop();
  };

  H.downloadHistoryCSV = function (entry) {
    CG.download('results-' + CG.slug(entry.title) + '-' + CG.formatDate(entry.startedAt) + '-' + entry.room + '.csv',
      CG.toCSV(entry.rows), 'text/csv;charset=utf-8');
  };

  H.renderHistory = function () {
    var list = H.getHistory();
    var el = $('#historyList');
    if (!list.length) { el.innerHTML = '<div class="empty">No finished games yet.</div>'; return; }
    el.innerHTML = list.map(function (h) {
      return '<div class="card history-item" data-hid="' + esc(h.id) + '">' +
        '<strong>' + esc(h.title) + '</strong>' +
        '<span class="muted">' + esc(CG.formatDateTime(h.startedAt).slice(0, 16)) + ' · ' + esc(h.kind === 'projector' ? 'Projector mode, ' + plural(h.rows.length - 1, 'team') : plural(h.rows.length - 1, 'player')) + ' · room ' + esc(h.room) + '</span>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-small" data-hact="csv">⬇ Download CSV</button>' +
        '<button class="btn btn-small btn-ghost" data-hact="del" title="Remove from this list">🗑</button></div>';
    }).join('');
  };

  function onHistoryClick(e) {
    var b = e.target.closest('button[data-hact]');
    if (!b) return;
    var id = b.closest('[data-hid]').dataset.hid;
    var entry = H.getHistory().find(function (h) { return h.id === id; });
    if (!entry) return;
    if (b.dataset.hact === 'csv') H.downloadHistoryCSV(entry);
    if (b.dataset.hact === 'del' && confirm('Remove the results of "' + entry.title + '" (' + CG.formatDateTime(entry.startedAt).slice(0, 16) + ') from this list?\nDownload the CSV first if you still need it.')) {
      CG.storage.set(K.history, H.getHistory().filter(function (h) { return h.id !== id; }));
      H.renderHistory();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Resume an interrupted game                                         */
  /* ------------------------------------------------------------------ */

  H.renderResumeBanner = function () {
    var el = $('#resumeBanner');
    var g = CG.storage.get(K.activeGame, null);
    var p = CG.storage.get(K.projector, null);
    var html = '';
    var maxAge = 6 * 3600 * 1000;
    if (g && g.savedAt && Date.now() - g.savedAt < maxAge) {
      var where = g.phase === 'lobby' ? 'in the lobby' : g.phase === 'podium' ? 'at the final podium' : 'at question ' + (g.qIndex + 1) + ' of ' + g.set.questions.length;
      html += '<div class="row" style="width:100%"><span>⚡ A live game of <b>' + esc(g.set.title) + '</b> (room <b>' + esc(g.room) + '</b>, ' +
        plural(g.players.length, 'player') + ') was left ' + where + '.</span><span class="spacer"></span>' +
        '<button class="btn btn-primary btn-small" id="btnResumeGame">Resume game</button>' +
        '<button class="btn btn-small btn-ghost" id="btnDiscardGame">Discard</button></div>';
    }
    if (p && p.savedAt && Date.now() - p.savedAt < maxAge) {
      html += '<div class="row" style="width:100%"><span>📽 A projector-mode game of <b>' + esc(p.set.title) + '</b> was left at question ' + (p.qIndex + 1) + '.</span><span class="spacer"></span>' +
        '<button class="btn btn-primary btn-small" id="btnResumeProj">Resume</button>' +
        '<button class="btn btn-small btn-ghost" id="btnDiscardProj">Discard</button></div>';
    }
    el.innerHTML = html;
    el.hidden = !html;
    if ($('#btnResumeGame')) {
      $('#btnResumeGame').onclick = function () { H.Game.resume(g); };
      $('#btnDiscardGame').onclick = function () {
        if (confirm('Discard this game? If it had finished, its results are kept under "Past game results".')) { CG.storage.remove(K.activeGame); H.renderResumeBanner(); }
      };
    }
    if ($('#btnResumeProj')) {
      $('#btnResumeProj').onclick = function () { H.Projector.resume(p); };
      $('#btnDiscardProj').onclick = function () { if (confirm('Discard this projector-mode game?')) { CG.storage.remove(K.projector); H.renderResumeBanner(); } };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Editor                                                             */
  /* ------------------------------------------------------------------ */

  var ed = { set: null, saveTimer: null };

  H.editSet = function (id) {
    var s = H.getSet(id);
    if (!s) return H.goHome();
    ed.set = s;
    $('#setTitle').value = s.title;
    renderQuestions();
    setSaveState('All changes saved');
    H.show('editor');
    if (s.title === 'New set') { $('#setTitle').select(); $('#setTitle').focus(); }
  };

  function setSaveState(t) { $('#saveState').textContent = t; }

  function touch() {
    ed.set.updatedAt = Date.now();
    setSaveState('Saving…');
    clearTimeout(ed.saveTimer);
    ed.saveTimer = setTimeout(flushSave, 400);
  }
  function flushSave() {
    clearTimeout(ed.saveTimer);
    ed.saveTimer = null;
    if (H.saveSets()) setSaveState('All changes saved ✓');
    else setSaveState('⚠ Not saved');
  }
  H.flushEditorSave = function () { if (ed.saveTimer) flushSave(); };

  function shapeSwatch(k) { return '<span class="swatch opt-' + k + '">' + CG.SHAPES[k] + '</span>'; }

  function questionHtml(q, i) {
    var problems = CG.validateQuestion(q);
    var h = '<div class="card q-card' + (problems.length ? ' invalid' : '') + '" data-i="' + i + '">';
    h += '<div class="q-card-head"><span class="q-num">Q' + (i + 1) + '</span>' +
      '<select data-f="type" aria-label="Question type">' +
      ['mc', 'tf', 'id'].map(function (t) { return '<option value="' + t + '"' + (q.type === t ? ' selected' : '') + '>' + CG.TYPE_LABELS[t] + '</option>'; }).join('') +
      '</select><span class="spacer"></span>' +
      '<button class="btn btn-small btn-ghost" data-act="up" title="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button class="btn btn-small btn-ghost" data-act="down" title="Move down"' + (i === ed.set.questions.length - 1 ? ' disabled' : '') + '>↓</button>' +
      '<button class="btn btn-small btn-ghost" data-act="dup" title="Duplicate question">⧉</button>' +
      '<button class="btn btn-small btn-ghost" data-act="del" title="Delete question">🗑</button></div>';
    h += '<div class="field"><label for="qt' + i + '">Question</label><textarea id="qt' + i + '" rows="2" data-f="text" placeholder="Type the question">' + esc(q.text) + '</textarea></div>';

    if (q.type === 'mc') {
      h += '<div class="field"><label>Options <small>(choose the correct one)</small></label>';
      q.options.forEach(function (o, k) {
        h += '<div class="opt-row">' + shapeSwatch(k) +
          '<input data-f="opt" data-k="' + k + '" value="' + esc(o) + '" placeholder="Option ' + CG.LETTERS[k] + '" aria-label="Option ' + CG.LETTERS[k] + '">' +
          '<input type="radio" name="correct' + i + '" data-f="correct" value="' + k + '"' + (q.correct === k ? ' checked' : '') + ' aria-label="Option ' + CG.LETTERS[k] + ' is correct" id="c' + i + '_' + k + '">' +
          '<label class="correct-label" for="c' + i + '_' + k + '">' + (q.correct === k ? '✓ Correct' : 'Correct?') + '</label>' +
          '<button class="btn btn-small btn-ghost" data-act="delopt" data-k="' + k + '" title="Remove option"' + (q.options.length <= 2 ? ' disabled' : '') + '>✕</button></div>';
      });
      if (q.options.length < 4) h += '<button class="btn btn-small" data-act="addopt">＋ Add option</button>';
      h += '</div>';
    } else if (q.type === 'tf') {
      h += '<div class="field"><label>Correct answer</label><div class="row">';
      ['True', 'False'].forEach(function (label, k) {
        h += '<label class="check"><input type="radio" name="correct' + i + '" data-f="correct" value="' + k + '"' + (q.correct === k ? ' checked' : '') + '> ' + label + '</label>';
      });
      h += '</div></div>';
    } else {
      h += '<div class="field"><label for="qa' + i + '">Accepted answers <small>— one per line. Capital letters, spaces and punctuation are ignored when checking.</small></label>' +
        '<textarea id="qa' + i + '" rows="3" data-f="accepted" placeholder="Local Government Code&#10;RA 7160">' + esc(q.accepted.join('\n')) + '</textarea></div>';
    }

    h += '<div class="q-extras">' +
      '<div class="field"><label for="qs' + i + '">Time (seconds)</label><input type="number" id="qs' + i + '" min="' + CG.MIN_TIME + '" max="' + CG.MAX_TIME + '" step="5" data-f="time" value="' + q.time + '"></div>' +
      '<label class="check" title="Shows a dramatic “Trick question!” reveal"><input type="checkbox" data-f="trick"' + (q.trick ? ' checked' : '') + '> 🎭 Trick question</label></div>';
    h += '<div class="field" style="margin-top:0.9em"><label for="qe' + i + '">Explanation <small>(optional, shown after the answer is revealed)</small></label>' +
      '<textarea id="qe' + i + '" rows="2" data-f="explanation" placeholder="Why is this the answer? e.g. Article V, Section 1">' + esc(q.explanation) + '</textarea></div>';
    h += '<ul class="problems">' + problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>';
    return h + '</div>';
  }

  function renderQuestions() {
    var qs = ed.set.questions;
    $('#questionList').innerHTML = qs.length ? qs.map(questionHtml).join('') :
      '<div class="empty">No questions yet. Add one below, or paste several at once.</div>';
    updateCount();
  }

  function updateCount() {
    var issues = CG.validateSet(ed.set).filter(function (x) { return x.index >= 0; }).length;
    $('#editorCount').textContent = plural(ed.set.questions.length, 'question') + (issues ? ' · ⚠ ' + issues + ' need fixing' : ' · ready to play');
  }

  function refreshProblems(card, q) {
    var problems = CG.validateQuestion(q);
    card.classList.toggle('invalid', problems.length > 0);
    $('.problems', card).innerHTML = problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
    updateCount();
  }

  function convertType(q, type) {
    var n = CG.blankQuestion(type);
    n.id = q.id; n.text = q.text; n.time = q.time; n.explanation = q.explanation; n.trick = q.trick;
    // Remember what was typed for each type, so switching back and forth loses nothing.
    var stash = n._stash = Object.assign({}, q._stash);
    stash[q.type] = { options: q.options && q.options.slice(), correct: q.correct, accepted: q.accepted && q.accepted.slice() };
    var back = stash[type];
    if (back) {
      if (type === 'mc') { n.options = back.options; n.correct = back.correct; }
      if (type === 'tf') n.correct = back.correct;
      if (type === 'id') n.accepted = back.accepted;
      return n;
    }
    if (type === 'mc' && q.type === 'tf') { n.options = ['True', 'False']; n.correct = q.correct; }
    if (type === 'id' && q.type === 'mc' && q.options[q.correct]) n.accepted = [q.options[q.correct]];
    if (type === 'mc' && q.type === 'id') { n.options = [q.accepted[0] || '', '', '', '']; n.correct = 0; }
    return n;
  }

  function onEditorInput(e) {
    var el = e.target;
    var f = el.dataset.f;
    var card = el.closest('[data-i]');
    if (!f || !card) return;
    var i = Number(card.dataset.i);
    var q = ed.set.questions[i];
    switch (f) {
      case 'text': q.text = el.value; break;
      case 'explanation': q.explanation = el.value; break;
      case 'opt': q.options[Number(el.dataset.k)] = el.value; break;
      case 'accepted':
        q.accepted = el.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        if (!q.accepted.length) q.accepted = [''];
        break;
      case 'time':
        if (e.type !== 'change') return;
        var t = Math.round(Number(el.value));
        if (!t) t = CG.DEFAULT_TIME;
        q.time = Math.min(CG.MAX_TIME, Math.max(CG.MIN_TIME, t));
        el.value = q.time;
        break;
      case 'trick': q.trick = el.checked; break;
      case 'correct':
        if (!el.checked) return;
        q.correct = Number(el.value);
        if (q.type === 'mc') { touch(); renderQuestions(); return; }
        break;
      case 'type':
        if (e.type !== 'change') return;
        ed.set.questions[i] = convertType(q, el.value);
        touch();
        renderQuestions();
        return;
    }
    touch();
    refreshProblems(card, q);
  }

  function onEditorClick(e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var card = b.closest('[data-i]');
    var i = Number(card.dataset.i);
    var qs = ed.set.questions;
    var q = qs[i];
    switch (b.dataset.act) {
      case 'up': if (i > 0) { qs.splice(i - 1, 0, qs.splice(i, 1)[0]); } break;
      case 'down': if (i < qs.length - 1) { qs.splice(i + 1, 0, qs.splice(i, 1)[0]); } break;
      case 'dup': var c = CG.clone(q); c.id = CG.makeId('q_'); qs.splice(i + 1, 0, c); break;
      case 'del':
        if ((q.text.trim() || i < qs.length - 1) && !confirm('Delete question ' + (i + 1) + '?' + (q.text.trim() ? '\n\n"' + q.text.slice(0, 120) + '"' : ''))) return;
        qs.splice(i, 1);
        break;
      case 'addopt': if (q.options.length < 4) q.options.push(''); break;
      case 'delopt':
        var k = Number(b.dataset.k);
        if (q.options.length <= 2) return;
        q.options.splice(k, 1);
        if (q.correct === k) q.correct = 0; else if (q.correct > k) q.correct--;
        break;
      default: return;
    }
    touch();
    renderQuestions();
  }

  function addQuestion(type) {
    var last = ed.set.questions[ed.set.questions.length - 1];
    var q = CG.blankQuestion(type);
    if (last) q.time = last.time;
    ed.set.questions.push(q);
    touch();
    renderQuestions();
    var cards = document.querySelectorAll('#questionList .q-card');
    var card = cards[cards.length - 1];
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('textarea', card).focus({ preventScroll: true }); }
  }

  function copyAsText() {
    var text = CG.toText(ed.set);
    var done = function () { H.toast('Copied the set as text. Paste it anywhere (e.g. a doc) to keep or share it.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { CG.download(CG.slug(ed.set.title) + '.txt', text); });
    } else {
      CG.download(CG.slug(ed.set.title) + '.txt', text);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Paste dialog                                                       */
  /* ------------------------------------------------------------------ */

  var EXAMPLE = [
    'Title: Lecture 4 — Suffrage',
    '',
    'Q: What is the minimum voting age in the Philippines?',
    'A) 16',
    'B) 18 *',
    'C) 21',
    'D) 25',
    'Explain: Article V, Section 1 of the 1987 Constitution.',
    '',
    'Q: The President may run for re-election.',
    'Answer: False',
    'Trick: yes',
    '',
    'Q: Which law is the Local Government Code of 1991?',
    'Answer: RA 7160 | Republic Act 7160 | Republic Act No. 7160',
    'Time: 30',
    ''
  ].join('\n');

  var lastParse = null;

  H.openPaste = function (targetId) {
    var sel = $('#pasteTarget');
    sel.innerHTML = '<option value="">A new set</option>' + H.sets.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.title) + '</option>';
    }).join('');
    sel.value = targetId || '';
    $('#pasteText').value = '';
    updatePasteReport();
    var d = $('#pasteDialog');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    $('#pasteText').focus();
  };

  function updatePasteReport() {
    var text = $('#pasteText').value;
    var r = lastParse = CG.parseText(text);
    var el = $('#pasteReport');
    if (!text.trim()) { el.innerHTML = ''; $('#pasteOk').disabled = true; return; }
    var h = r.questions.length ? '<b style="color:var(--good)">✓ ' + plural(r.questions.length, 'question') + ' ready</b>' : '<b>No complete questions yet.</b>';
    if (r.title) h += ' · Title: <b>' + esc(r.title) + '</b>';
    if (r.errors.length) {
      h += '<ul>' + r.errors.slice(0, 12).map(function (er) { return '<li>Line ' + er.line + ': ' + esc(er.message) + '</li>'; }).join('') +
        (r.errors.length > 12 ? '<li>…and ' + (r.errors.length - 12) + ' more</li>' : '') + '</ul>';
    }
    el.innerHTML = h;
    $('#pasteOk').disabled = !r.questions.length;
    $('#pasteOk').textContent = r.questions.length ? 'Add ' + plural(r.questions.length, 'question') : 'Add questions';
  }

  function closePaste() { var d = $('#pasteDialog'); if (d.close) d.close(); else d.removeAttribute('open'); }

  function confirmPaste() {
    var r = lastParse;
    if (!r || !r.questions.length) return;
    if (r.errors.length && !confirm(plural(r.errors.length, 'line') + ' had problems and will be skipped.\nAdd the ' + plural(r.questions.length, 'good question') + ' anyway?')) return;
    var targetId = $('#pasteTarget').value;
    var set;
    if (targetId) {
      set = H.getSet(targetId);
      // Replace a lone blank starter question instead of keeping it.
      if (set.questions.length === 1 && !set.questions[0].text.trim()) set.questions = [];
      set.questions = set.questions.concat(r.questions);
      set.updatedAt = Date.now();
      H.saveSets();
    } else {
      set = H.newSet(r.title || 'Pasted questions ' + CG.formatDate(Date.now()), r.questions);
    }
    closePaste();
    H.editSet(set.id);
    H.toast('Added ' + plural(r.questions.length, 'question') + ' to "' + set.title + '"');
  }

  /* ------------------------------------------------------------------ */
  /* Start-up                                                           */
  /* ------------------------------------------------------------------ */

  H.start = function () {
    H.loadSets();

    $('#setGrid').addEventListener('click', onHomeClick);
    $('#historyList').addEventListener('click', onHistoryClick);
    $('#btnNewSet').onclick = function () { H.editSet(H.newSet().id); };
    $('#btnPaste').onclick = function () { H.openPaste(''); };
    $('#btnImport').onclick = function () { $('#importFile').click(); };
    $('#importFile').onchange = function () {
      var file = this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { H.importText(String(reader.result)); };
      reader.readAsText(file);
      this.value = '';
    };
    $('#btnExportAll').onclick = function () {
      if (!H.sets.length) return H.toast('There are no sets to export.');
      H.exportSets(H.sets, 'classroom-game-backup-' + CG.formatDate(Date.now()) + '.json');
    };

    // Editor
    $('#btnEditorBack').onclick = function () { H.flushEditorSave(); H.goHome(); };
    $('#setTitle').addEventListener('input', function () { ed.set.title = this.value || 'Untitled set'; touch(); });
    $('#questionList').addEventListener('input', onEditorInput);
    $('#questionList').addEventListener('change', onEditorInput);
    $('#questionList').addEventListener('click', onEditorClick);
    document.querySelectorAll('[data-add]').forEach(function (b) { b.onclick = function () { addQuestion(b.dataset.add); }; });
    $('#btnEditorPaste').onclick = function () { H.flushEditorSave(); H.openPaste(ed.set.id); };
    $('#btnEditorCopyText').onclick = copyAsText;
    $('#btnEditorPlay').onclick = function () { H.flushEditorSave(); var p = H.prepareForPlay(ed.set.id); if (p) H.Game.start(p); };
    $('#btnEditorProjector').onclick = function () { H.flushEditorSave(); var p = H.prepareForPlay(ed.set.id); if (p) H.Projector.start(p); };

    // Paste dialog
    $('#pasteText').addEventListener('input', updatePasteReport);
    $('#pasteExample').onclick = function () { $('#pasteText').value = EXAMPLE; updatePasteReport(); };
    $('#pasteCancel').onclick = closePaste;
    $('#pasteOk').onclick = confirmPaste;
    $('#pasteForm').addEventListener('submit', function (e) { e.preventDefault(); });

    window.addEventListener('beforeunload', function (e) {
      H.flushEditorSave();
      if (H.view === 'game' || H.view === 'projector') { e.preventDefault(); e.returnValue = ''; }
    });

    H.goHome();
  };

  return H;
})();
