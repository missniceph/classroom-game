/*
 * Classroom Game — shared helpers used by the host page, the student page and the tests.
 * Plain JavaScript, no build step. Exposes window.CG in the browser and module.exports in Node.
 */
(function (root) {
  'use strict';

  var CG = {};

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  CG.APP = 'classroom-game';
  CG.FORMAT_VERSION = 1;
  // Prefix for PeerJS ids on the shared public server, so our room codes don't clash with other apps.
  CG.PEER_PREFIX = 'classroomgame-upncpag-v1-';
  // No 0/O, 1/I/L — easy to read off a projector and type on a phone.
  CG.ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  CG.ROOM_LENGTH = 5;
  CG.DEFAULT_TIME = 20;
  CG.MIN_TIME = 5;
  CG.MAX_TIME = 240;
  CG.MAX_NAME = 20;
  CG.MAX_TEXT_ANSWER = 80;
  CG.LETTERS = ['A', 'B', 'C', 'D'];
  CG.SHAPES = ['▲', '◆', '●', '■'];

  CG.STORAGE_KEYS = {
    sets: 'classroomgame.sets.v1',
    seeded: 'classroomgame.seeded.v1',
    activeGame: 'classroomgame.activeGame.v1',
    history: 'classroomgame.history.v1',
    projector: 'classroomgame.projector.v1',
    player: 'classroomgame.player.v1'
  };

  /* ------------------------------------------------------------------ */
  /* Small utilities                                                     */
  /* ------------------------------------------------------------------ */

  function randomInt(max) {
    var c = root.crypto || (typeof require === 'function' ? require('crypto').webcrypto : null);
    if (c && c.getRandomValues) {
      var a = new Uint32Array(1);
      c.getRandomValues(a);
      return a[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  CG.makeId = function (prefix) {
    var s = '';
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < 12; i++) s += chars[randomInt(chars.length)];
    return (prefix || '') + s;
  };

  CG.makeRoomCode = function () {
    var s = '';
    for (var i = 0; i < CG.ROOM_LENGTH; i++) s += CG.ROOM_ALPHABET[randomInt(CG.ROOM_ALPHABET.length)];
    return s;
  };

  // The alphabet has no O/0/I/1/L, so simply strip anything that is not in it.
  CG.cleanRoomCode = function (s) {
    return String(s || '').toUpperCase().split('').filter(function (ch) {
      return CG.ROOM_ALPHABET.indexOf(ch) >= 0;
    }).join('').slice(0, CG.ROOM_LENGTH);
  };

  CG.cleanName = function (s) {
    return String(s || '')
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, CG.MAX_NAME)
      .trim();
  };

  CG.escapeHtml = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  CG.clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** Local date-time as "2026-11-05 14:03:22" (uses the laptop's own time zone). */
  CG.formatDateTime = function (ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  };
  CG.formatDate = function (ts) { return CG.formatDateTime(ts).slice(0, 10); };

  CG.ordinal = function (n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  CG.slug = function (s) {
    return String(s || 'set').normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'set';
  };

  /* ------------------------------------------------------------------ */
  /* Answer checking and scoring                                         */
  /* ------------------------------------------------------------------ */

  var NON_ALNUM;
  try { NON_ALNUM = new RegExp('[^\\p{L}\\p{N}]+', 'gu'); } catch (e) { NON_ALNUM = /[^a-z0-9]+/g; }

  /**
   * Normalise a typed answer for comparison: case-insensitive, accents removed,
   * and all spaces and punctuation ignored ("R.A. 7160" == "ra7160" == "RA  7160").
   */
  CG.normalizeAnswer = function (s) {
    return String(s == null ? '' : s)
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(NON_ALNUM, '');
  };

  CG.isCorrect = function (q, answer, extraAccepted) {
    if (!q) return false;
    if (q.type === 'id') {
      var key = CG.normalizeAnswer(answer);
      if (!key) return false;
      var list = (q.accepted || []).concat(extraAccepted || []);
      for (var i = 0; i < list.length; i++) {
        if (CG.normalizeAnswer(list[i]) === key) return true;
      }
      return false;
    }
    return typeof answer === 'number' && answer === q.correct;
  };

  /** 1000 points for an instant correct answer, sliding down to 500 at the buzzer. */
  CG.pointsFor = function (elapsedMs, limitMs) {
    var f = limitMs > 0 ? elapsedMs / limitMs : 1;
    f = Math.min(1, Math.max(0, f));
    return Math.round(500 + 500 * (1 - f));
  };

  /** Text of the correct answer, for display. */
  CG.correctText = function (q) {
    if (q.type === 'id') return (q.accepted || []).join(' / ');
    return (q.options || [])[q.correct] || '';
  };

  /* ------------------------------------------------------------------ */
  /* Questions and sets                                                  */
  /* ------------------------------------------------------------------ */

  CG.TYPE_LABELS = { mc: 'Multiple choice', tf: 'True or false', id: 'Identification' };

  CG.blankQuestion = function (type) {
    type = type || 'mc';
    var q = { id: CG.makeId('q_'), type: type, text: '', time: CG.DEFAULT_TIME, explanation: '', trick: false };
    if (type === 'mc') { q.options = ['', '', '', '']; q.correct = 0; }
    if (type === 'tf') { q.options = ['True', 'False']; q.correct = 0; }
    if (type === 'id') { q.accepted = ['']; }
    return q;
  };

  /** Make any question-like object safe and complete (used on load and import). */
  CG.cleanQuestion = function (raw) {
    raw = raw || {};
    var type = ['mc', 'tf', 'id'].indexOf(raw.type) >= 0 ? raw.type : 'mc';
    var q = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : CG.makeId('q_'),
      type: type,
      text: String(raw.text || ''),
      time: Math.round(Number(raw.time)) || CG.DEFAULT_TIME,
      explanation: String(raw.explanation || ''),
      trick: !!raw.trick
    };
    q.time = Math.min(CG.MAX_TIME, Math.max(CG.MIN_TIME, q.time));
    if (type === 'mc') {
      q.options = (Array.isArray(raw.options) ? raw.options : []).slice(0, 4).map(function (o) { return String(o == null ? '' : o); });
      while (q.options.length < 2) q.options.push('');
      q.correct = Number.isInteger(raw.correct) && raw.correct >= 0 && raw.correct < q.options.length ? raw.correct : 0;
    } else if (type === 'tf') {
      q.options = ['True', 'False'];
      var c = raw.correct;
      if (c === true || c === 'true' || c === 'True') c = 0;
      if (c === false || c === 'false' || c === 'False') c = 1;
      q.correct = c === 1 ? 1 : 0;
    } else {
      q.accepted = (Array.isArray(raw.accepted) ? raw.accepted : [raw.accepted || ''])
        .map(function (a) { return String(a == null ? '' : a); });
      if (!q.accepted.length) q.accepted = [''];
    }
    return q;
  };

  CG.cleanSet = function (raw) {
    raw = raw || {};
    var now = Date.now();
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : CG.makeId('set_'),
      title: String(raw.title || 'Untitled set').slice(0, 120),
      questions: (Array.isArray(raw.questions) ? raw.questions : []).map(CG.cleanQuestion),
      createdAt: Number(raw.createdAt) || now,
      updatedAt: Number(raw.updatedAt) || now
    };
  };

  /** Returns a list of human-readable problems with a question (empty list = OK to play). */
  CG.validateQuestion = function (q) {
    var p = [];
    if (!String(q.text || '').trim()) p.push('The question text is empty.');
    if (q.type === 'mc') {
      var filled = q.options.filter(function (o) { return String(o).trim(); }).length;
      if (q.options.length < 2 || q.options.length > 4) p.push('Multiple choice needs 2 to 4 options.');
      if (filled < q.options.length) p.push('Fill in every option (or remove the empty ones).');
      if (!String(q.options[q.correct] || '').trim()) p.push('Choose which option is correct.');
    }
    if (q.type === 'id') {
      var ok = (q.accepted || []).filter(function (a) { return CG.normalizeAnswer(a); });
      if (!ok.length) p.push('Add at least one correct answer.');
    }
    return p;
  };

  CG.validateSet = function (set) {
    var out = [];
    if (!set.questions.length) out.push({ index: -1, problems: ['This set has no questions yet.'] });
    set.questions.forEach(function (q, i) {
      var p = CG.validateQuestion(q);
      if (p.length) out.push({ index: i, problems: p });
    });
    return out;
  };

  /** Copy of a set ready for play: blank optional fields trimmed, accepted answers de-blanked. */
  CG.playableQuestion = function (q) {
    var c = CG.cleanQuestion(q);
    c.text = c.text.trim();
    c.explanation = c.explanation.trim();
    if (c.options) c.options = c.options.map(function (o) { return String(o).trim(); });
    if (c.accepted) c.accepted = c.accepted.map(function (a) { return a.trim(); }).filter(function (a) { return CG.normalizeAnswer(a); });
    return c;
  };

  /* ------------------------------------------------------------------ */
  /* Paste format                                                        */
  /* ------------------------------------------------------------------ */

  var TRUE_WORDS = ['true', 't', 'tama', 'totoo', 'yes'];
  var FALSE_WORDS = ['false', 'f', 'mali', 'no'];
  var YES_WORDS = ['yes', 'y', 'true', '1', 'oo', 'on'];

  /**
   * Parse questions written in the simple text format (see README).
   * Returns { title, questions: [...], errors: [{ line, message }] }.
   */
  CG.parseText = function (text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var result = { title: '', questions: [], errors: [] };
    var cur = null;
    var lastField = null; // which field a continuation line belongs to

    function finish() {
      if (!cur) return;
      var b = cur; cur = null;
      var q = { id: CG.makeId('q_'), text: b.text.trim(), time: CG.DEFAULT_TIME, explanation: b.explain.trim(), trick: b.trick };
      if (b.time != null) {
        if (!(b.time >= CG.MIN_TIME && b.time <= CG.MAX_TIME)) {
          result.errors.push({ line: b.timeLine, message: 'Time must be a number of seconds from ' + CG.MIN_TIME + ' to ' + CG.MAX_TIME + '.' });
          return;
        }
        q.time = b.time;
      }
      if (!q.text) { result.errors.push({ line: b.line, message: 'Question has no text after "Q:".' }); return; }

      var type = b.type;
      var ans = b.answer == null ? null : b.answer.trim();
      if (!type) {
        if (b.options.length) {
          var lower = b.options.map(function (o) { return o.text.toLowerCase(); });
          type = (b.options.length === 2 && lower[0] === 'true' && lower[1] === 'false') ? 'tf' : 'mc';
        } else if (ans != null && (TRUE_WORDS.indexOf(ans.toLowerCase()) >= 0 || FALSE_WORDS.indexOf(ans.toLowerCase()) >= 0)) {
          type = 'tf';
        } else {
          type = 'id';
        }
      }
      q.type = type;

      if (type === 'mc') {
        if (b.options.length < 2 || b.options.length > 4) {
          result.errors.push({ line: b.line, message: 'Multiple choice needs 2 to 4 options (found ' + b.options.length + ').' });
          return;
        }
        q.options = b.options.map(function (o) { return o.text; });
        var starred = [];
        b.options.forEach(function (o, i) { if (o.star) starred.push(i); });
        if (ans) {
          var li = CG.LETTERS.indexOf(ans.toUpperCase().replace(/[^A-Z]/g, ''));
          if (li < 0) {
            // allow "Answer: 18" — the text of an option
            li = q.options.map(function (o) { return CG.normalizeAnswer(o); }).indexOf(CG.normalizeAnswer(ans));
          }
          if (li >= 0 && li < q.options.length) starred = [li];
          else { result.errors.push({ line: b.answerLine, message: '"Answer: ' + ans + '" does not match any option letter.' }); return; }
        }
        if (starred.length !== 1) {
          result.errors.push({ line: b.line, message: starred.length ? 'Mark only one option as correct.' : 'Mark the correct option with a * (for example "B) 18 *").' });
          return;
        }
        q.correct = starred[0];
      } else if (type === 'tf') {
        var a = ans != null ? ans.toLowerCase() : null;
        if (a == null && b.options.length === 2) {
          var si = b.options.findIndex(function (o) { return o.star; });
          a = si === 0 ? 'true' : si === 1 ? 'false' : null;
        }
        if (a != null && (a === 'a')) a = 'true';
        if (a != null && (a === 'b')) a = 'false';
        if (TRUE_WORDS.indexOf(a) >= 0) q.correct = 0;
        else if (FALSE_WORDS.indexOf(a) >= 0) q.correct = 1;
        else { result.errors.push({ line: b.answerLine || b.line, message: 'True/false question needs "Answer: True" or "Answer: False".' }); return; }
        q.options = ['True', 'False'];
      } else {
        var list = (ans || '').split('|').map(function (s) { return s.trim(); }).filter(function (s) { return CG.normalizeAnswer(s); });
        if (!list.length) { result.errors.push({ line: b.answerLine || b.line, message: 'Identification question needs "Answer: ..." (separate alternatives with |).' }); return; }
        q.accepted = list;
      }
      result.questions.push(CG.cleanQuestion(q));
    }

    lines.forEach(function (rawLine, i) {
      var lineNo = i + 1;
      var line = rawLine.trim();
      if (!line) { lastField = null; return; }
      if (/^(#|\/\/)/.test(line)) return;

      var m;
      if ((m = line.match(/^title\s*:\s*(.*)$/i)) && !cur) { result.title = m[1].trim(); return; }

      if ((m = line.match(/^(?:q(?:uestion)?\s*\d*\s*[:.)]|\d+\s*[.)])\s*(.*)$/i))) {
        finish();
        cur = { line: lineNo, text: m[1], options: [], answer: null, answerLine: null, type: null, time: null, explain: '', trick: false };
        lastField = 'text';
        return;
      }

      if (!cur) {
        result.errors.push({ line: lineNo, message: 'Expected a line starting with "Q:" here.' });
        return;
      }

      if ((m = line.match(/^(\*?)\s*([A-Fa-f])\s*[).]\s*(.*?)\s*(\*?)\s*$/)) || (m = line.match(/^(\*?)\s*([A-Fa-f])\s*:\s+(.*?)\s*(\*?)\s*$/))) {
        // Option line, e.g. "B) 18 *" — but don't swallow "Answer: ..." etc. (handled because those
        // keywords are more than one letter before the colon).
        var letterIndex = m[2].toUpperCase().charCodeAt(0) - 65;
        if (letterIndex !== cur.options.length) {
          result.errors.push({ line: lineNo, message: 'Options should go A, B, C, D in order.' });
        }
        var optText = m[3].replace(/\s*\((correct|tama)\)\s*$/i, function () { m[4] = '*'; return ''; }).trim();
        cur.options.push({ text: optText, star: !!(m[1] || m[4]) });
        lastField = null;
        return;
      }
      if ((m = line.match(/^(?:answer|ans|correct|sagot)s?\s*:\s*(.*)$/i))) { cur.answer = m[1]; cur.answerLine = lineNo; lastField = null; return; }
      if ((m = line.match(/^type\s*:\s*(.*)$/i))) {
        var t = m[1].toLowerCase().replace(/[^a-z]/g, '');
        if (/^(mc|multiplechoice|multiple|choice)$/.test(t)) cur.type = 'mc';
        else if (/^(tf|truefalse|trueorfalse)$/.test(t)) cur.type = 'tf';
        else if (/^(id|identification|text|short|shortanswer)$/.test(t)) cur.type = 'id';
        else result.errors.push({ line: lineNo, message: 'Unknown type "' + m[1] + '". Use MC, TF or ID.' });
        lastField = null;
        return;
      }
      if ((m = line.match(/^(?:time|timer|seconds)\s*:\s*(.*)$/i))) {
        cur.time = parseInt(m[1], 10);
        if (isNaN(cur.time)) cur.time = -1;
        cur.timeLine = lineNo;
        lastField = null;
        return;
      }
      if ((m = line.match(/^(?:explain|explanation|why|note)\s*:\s*(.*)$/i))) { cur.explain = m[1]; lastField = 'explain'; return; }
      if ((m = line.match(/^trick\s*(?::\s*(.*))?$/i))) {
        cur.trick = m[1] == null || m[1].trim() === '' || YES_WORDS.indexOf(m[1].trim().toLowerCase()) >= 0;
        lastField = null;
        return;
      }
      if (/^\[trick\]$/i.test(line)) { cur.trick = true; return; }

      // Continuation of a multi-line question or explanation
      if (lastField === 'text') { cur.text += ' ' + line; return; }
      if (lastField === 'explain') { cur.explain += ' ' + line; return; }
      result.errors.push({ line: lineNo, message: 'Could not understand this line: "' + line.slice(0, 60) + '"' });
    });
    finish();
    return result;
  };

  /** Turn a set back into the paste format (for copying or editing as text). */
  CG.toText = function (set) {
    var out = [];
    if (set.title) out.push('Title: ' + set.title, '');
    set.questions.forEach(function (q) {
      out.push('Q: ' + q.text.replace(/\s*\n\s*/g, ' '));
      if (q.type === 'mc') {
        q.options.forEach(function (o, i) { out.push(CG.LETTERS[i] + ') ' + o + (i === q.correct ? ' *' : '')); });
      } else if (q.type === 'tf') {
        out.push('Answer: ' + (q.correct === 0 ? 'True' : 'False'));
      } else {
        out.push('Answer: ' + (q.accepted || []).filter(function (a) { return a.trim(); }).join(' | '));
        var looksTf = (q.accepted || []).some(function (a) { var l = a.trim().toLowerCase(); return TRUE_WORDS.indexOf(l) >= 0 || FALSE_WORDS.indexOf(l) >= 0; });
        if (looksTf) out.push('Type: ID');
      }
      if (q.time !== CG.DEFAULT_TIME) out.push('Time: ' + q.time);
      if (q.explanation && q.explanation.trim()) out.push('Explain: ' + q.explanation.replace(/\s*\n\s*/g, ' '));
      if (q.trick) out.push('Trick: yes');
      out.push('');
    });
    return out.join('\n');
  };

  /* ------------------------------------------------------------------ */
  /* CSV                                                                 */
  /* ------------------------------------------------------------------ */

  CG.csvCell = function (v) {
    var s = String(v == null ? '' : v);
    // Stop spreadsheet apps from treating a nickname like "=1+1" as a formula.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };

  CG.toCSV = function (rows) {
    // BOM so Excel opens accents (ñ, é) correctly.
    return '﻿' + rows.map(function (r) { return r.map(CG.csvCell).join(','); }).join('\r\n') + '\r\n';
  };

  /* ------------------------------------------------------------------ */
  /* Ranking                                                             */
  /* ------------------------------------------------------------------ */

  /** rows: [{ score, ... }] → same objects sorted, each with .rank (ties share a rank). */
  CG.rank = function (rows, tieBreak) {
    var sorted = rows.slice().sort(function (a, b) {
      return (b.score - a.score) || (tieBreak ? tieBreak(a, b) : 0);
    });
    var lastScore = null, lastRank = 0;
    sorted.forEach(function (r, i) {
      if (r.score !== lastScore) { lastRank = i + 1; lastScore = r.score; }
      r.rank = lastRank;
    });
    return sorted;
  };

  /* ------------------------------------------------------------------ */
  /* Networking options                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * PeerJS options. By default the free public PeerJS server is used.
   * Advanced: add ?peerserver=host:port (or https://host:port/path) to the page address to use your own.
   */
  CG.peerServerParam = function () {
    try { return new URLSearchParams(root.location.search).get('peerserver') || ''; } catch (e) { return ''; }
  };
  CG.peerOptions = function () {
    var opts = { debug: 1 };
    var ps = CG.peerServerParam();
    if (ps) {
      try {
        var u = new URL(/^https?:\/\//.test(ps) ? ps : 'http://' + ps);
        opts.host = u.hostname;
        opts.port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
        opts.secure = u.protocol === 'https:';
        opts.path = u.pathname || '/';
      } catch (e) { /* ignore bad value */ }
    }
    return opts;
  };

  /* ------------------------------------------------------------------ */
  /* Browser storage                                                     */
  /* ------------------------------------------------------------------ */

  CG.storage = {
    get: function (key, fallback) {
      try {
        var raw = root.localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { root.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) {
        if (root.console) console.warn('Could not save', key, e);
        return false;
      }
    },
    remove: function (key) { try { root.localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  };

  /** Load a script from the first URL that works (CDN with a backup CDN). */
  CG.loadScript = function (urls, globalName) {
    return new Promise(function (resolve, reject) {
      if (globalName && root[globalName]) return resolve(root[globalName]);
      var i = 0;
      (function next() {
        if (i >= urls.length) return reject(new Error('Could not load ' + (globalName || 'script')));
        var s = document.createElement('script');
        s.src = urls[i++];
        s.async = true;
        s.onload = function () { if (!globalName || root[globalName]) resolve(root[globalName]); else next(); };
        s.onerror = function () { s.remove(); next(); };
        document.head.appendChild(s);
      })();
    });
  };
  CG.LIBS = {
    peer: ['https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js', 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'],
    qr: ['https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js']
  };

  CG.download = function (filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  };

  /* ------------------------------------------------------------------ */
  /* Sample set                                                          */
  /* ------------------------------------------------------------------ */

  CG.sampleSet = function () {
    return CG.cleanSet({
      id: 'set_sample_pa106',
      title: 'Sample: Citizenship and Governance basics',
      questions: [
        {
          type: 'mc',
          text: 'Under the 1987 Constitution, what is the minimum age to vote in the Philippines?',
          options: ['16', '18', '21', '25'],
          correct: 1,
          time: 20,
          explanation: 'Article V, Section 1: suffrage may be exercised by citizens at least 18 years old who have lived in the Philippines for at least one year, and where they propose to vote for at least six months, before the election.'
        },
        {
          type: 'tf',
          text: 'The President of the Philippines may run for a second consecutive six-year term.',
          correct: 1,
          time: 20,
          explanation: 'False. Article VII, Section 4: "The President shall not be eligible for any reelection."'
        },
        {
          type: 'id',
          text: 'What 1991 law devolved powers and resources to local government units (LGUs)?',
          accepted: ['Local Government Code', 'Local Government Code of 1991', 'RA 7160', 'Republic Act 7160', 'Republic Act No. 7160', 'RA No. 7160', '7160', 'LGC'],
          time: 30,
          explanation: 'Republic Act No. 7160, the Local Government Code of 1991, gave LGUs more powers, responsibilities and resources.'
        },
        {
          type: 'mc',
          text: 'Which principle mainly decides Philippine citizenship at birth?',
          options: ['Jus soli: being born on Philippine soil', 'Jus sanguinis: having a Filipino parent', 'Naturalization', 'Long residence in the Philippines'],
          correct: 1,
          time: 20,
          trick: true,
          explanation: 'Many expect "born here = Filipino", but Article IV, Section 1 follows blood: citizens include those whose father or mother is a citizen of the Philippines. Birth on Philippine soil alone is not enough.'
        },
        {
          type: 'id',
          text: 'Article II, Section 1: "Sovereignty resides in the ______ and all government authority emanates from them."',
          accepted: ['people', 'the people', 'Filipino people', 'the Filipino people', 'mamamayan', 'taumbayan', 'sambayanan'],
          time: 25,
          explanation: 'The Philippines is a democratic and republican State: sovereignty resides in the people.'
        }
      ]
    });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CG;
  else root.CG = CG;
})(typeof window !== 'undefined' ? window : globalThis);
