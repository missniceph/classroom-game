# Classroom Game

A free live quiz game for class, in the style of Kahoot. Made for PA 106 (Citizenship and Governance) at UP NCPAG, but it works for any class.

- **You** open the host page on your laptop and project it.
- **Students** join on their phones by typing a short room code (or scanning the QR code) and a nickname.
- No accounts, no fees, no database. Phones connect straight to your laptop. Your question sets and results are saved only in your laptop's browser.
- If the connection fails in class, switch to **Projector mode**, which needs no phones and no internet.

| Page | Address (after setup) | Who uses it |
|---|---|---|
| Student page | `https://missniceph.github.io/classroom-game/` | Students, on their phones |
| Host page | `https://missniceph.github.io/classroom-game/host.html` | You, on the laptop you project from |

---

## 1. One-time setup (about 5 minutes)

1. Merge the changes into the `main` branch of this repository on GitHub.
2. On GitHub, open the repository, then go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, choose branch **`main`** and folder **`/ (root)`**, then click **Save**.
4. Wait a minute or two. GitHub will show the site address, `https://missniceph.github.io/classroom-game/`.
5. On the laptop you teach with, open the **host page** (`…/classroom-game/host.html`) and bookmark it.

You will find a **sample set of 5 questions** on citizenship and governance already loaded, so you can try everything right away.

> **Try it before your first class.** Open the host page on your laptop, click **▶ Play live** on the sample set, then join from your own phone using mobile data. Play through the 5 questions.

---

## 2. Running a game in class

**Before class**

- Plug in your laptop and turn off sleep mode for the session. The game runs in your browser tab, so **keep that tab open**.
- Use **Chrome, Edge or Firefox** on the laptop.

**In class**

1. Open the host page and click **▶ Play live** on the set for today's lecture.
2. The lobby shows the website address, a big **room code** and a **QR code**. Students either scan the QR code or go to the address and type the code, then enter a nickname.
3. Names appear on the screen as students join. To remove a player (for example, an inappropriate nickname), click the name.
4. Click **Start game ▶** or press the **Space bar**.
5. For each question:
   - The screen shows "Question 1 of 5", then the question, the answer options and a timer. Students tap their answer on their phones. The screen counts how many have answered.
   - The answer is revealed when the timer runs out, or as soon as everyone has answered (you can turn this off in the lobby), or when you click **Show answer now**.
   - The reveal shows the correct answer, your explanation and how the class answered.
   - Click **Leaderboard ▶** to show the top 5, then **Next question ▶**.
6. After the last question, click **Final results 🏆** to show the podium.
7. Click **⬇ Download results (CSV)** to save the participation record.
8. Click **Close room & back to my sets** when you're done.

**Controls during the game**

| Button | Key | What it does |
|---|---|---|
| Next / Show answer / Leaderboard | Space, Enter or → | Moves the game forward |
| ⏸ Pause / ▶ Resume | P | Freezes the timer (phones show "Paused") |
| ⏭ Skip question | | Drops the current question. Nobody gets points for it |
| End game | | Jumps straight to the final results |
| ⛶ | F | Full screen |

**Late students** can join at any time. They start with 0 points.

**Identification questions:** on the reveal screen you see everything the class typed. If a student typed a correct answer you didn't list (for example, a Filipino term), click the green **✓** next to it. Everyone who typed it gets their points.

### If something goes wrong

- **A student's phone locks, loses signal or the page reloads.** The phone reconnects by itself, usually within a few seconds, and keeps its name and score. If the student closed the browser, they can open the link or scan the QR code again. They are put back into the game automatically. If their phone died completely, they can join from another phone **with the same nickname** and they keep their score.
- **"That nickname is taken."** Two students chose the same name. Ask one to add an initial or a number.
- **Your laptop's tab reloads or the browser closes.** Open the host page again. A yellow banner says a game was interrupted. Click **Resume game**. The room code, players and scores are restored, and phones reconnect by themselves. If you were in the middle of a question, the game comes back paused so nobody loses time. Click **▶ Resume** when the phones are back.
- **Students can't join at all** (the campus Wi-Fi blocks it, or the free connection server is down). Students on Wi-Fi can try switching to mobile data. If it still fails, click **End game** or **Close room** and use **Projector mode**.

---

## 3. Projector mode (no phones needed)

This is the backup plan if the connection fails, or if you just want team play.

1. On the host page, click **📽 Projector mode** on a set.
2. Name the teams (2 to 8, for example *Mabini*, *Rizal*, *Silang*) and click **Start**.
3. For each question, press **Space** to move through the steps: show the question, then **show the options**, then **reveal the answer** (with the explanation and the trick-question effect), then go to the **next question**.
4. Award points by **tapping a team's tile** (+1), or press its number key (1–8). The small **−** on a tile takes a point away.
5. Press **T** to start or pause an optional countdown timer. **◀ Back** (or the ← key) goes back a step.
6. At the end, **Final standings** shows a podium. You can download the team scores as a CSV.

Projector mode works without internet once the host page has loaded. If you refresh by accident, use the **Resume** banner.

---

## 4. Making question sets

Make one set per lecture. On the host page you can:

- **＋ New set**: opens the editor.
- **✏️ Edit**: change the title or questions. Changes save automatically.
- **⧉ Duplicate**: copy a set, for example to make a version for another section.
- **🗑 Delete**: removes the set. This cannot be undone unless you exported a backup.
- **📋 Paste questions**: type or paste many questions at once (format below).

### Question types

| Type | What students see | How it's checked |
|---|---|---|
| **Multiple choice** | 2 to 4 coloured answer buttons | The one correct option |
| **True or false** | Two big buttons | True or False |
| **Identification** | A box to type a short answer | Matches any of your accepted answers. Capital letters, accents, spaces and punctuation are ignored, so `R.A. No. 7160`, `ra no 7160` and `RA  No 7160` all count as the same answer |

Every question can also have:

- **Time.** 20 seconds by default. You can set anything from 5 to 240.
- **Explanation** (optional). Shown on the projector and on phones after the answer is revealed.
- **🎭 Trick question.** The reveal starts with a big "TRICK QUESTION!" stamp, and the question is marked as a trick on every screen.

**Points.** A correct answer earns between 500 and 1,000 points. Answering instantly gives 1,000, and answering at the last second gives 500. A wrong answer or no answer earns 0. Ties on the leaderboard share a rank.

### The paste format

Click **📋 Paste questions** (or **Paste more questions** inside a set). As you type, the box shows how many questions it understood and which lines have problems, with line numbers. Click **Insert an example** to see a sample.

```
Title: Lecture 3 — Suffrage and Elections

Q: Under the 1987 Constitution, what is the minimum voting age?
A) 16
B) 18 *
C) 21
D) 25
Time: 30
Explain: Article V, Section 1 of the 1987 Constitution.

Q: The President may run for re-election.
Answer: False
Explain: Article VII, Section 4: the President is not eligible for any reelection.

Q: What law is also known as the Local Government Code of 1991?
Answer: RA 7160 | Republic Act 7160 | Republic Act No. 7160 | Local Government Code

Q: Which principle mainly decides Philippine citizenship at birth?
A) Jus soli (place of birth)
B) Jus sanguinis (blood) *
Trick: yes
```

**Rules**

- Start every question with **`Q:`**. A numbered line such as `1.` or `2)` also works. Blank lines between questions are optional.
- **Multiple choice:** list 2 to 4 options as `A)`, `B)`, `C)`, `D)` (or `A.`). Put a `*` after the correct option, for example `B) 18 *`. Instead of the `*`, you can write `Answer: B`.
- **True or false:** write `Answer: True` or `Answer: False`, with no options.
- **Identification:** write `Answer:` followed by the correct answer, with no options. Separate alternative answers with `|`, for example `Answer: Senate | Senado`. If the identification answer is literally the word "true" or "false", add the line `Type: ID`.
- **Optional lines:** `Time: 30` (seconds), `Explain: …` (explanation), `Trick: yes`.
- If the question or explanation is long, you can continue it on the next line.
- `Title: …` on the first line names the new set.
- Lines starting with `#` are ignored, so you can use them for notes to yourself.

Inside the editor, **📄 Copy as text** copies the whole set in this same format. You can keep it in Google Docs or share it with a co-teacher, who can paste it back in.

---

## 5. Backing up your sets

Your sets are saved **in this browser on this laptop**. They are not online. That means:

- They stay on the laptop even after you close the browser.
- They will **not** appear on another laptop or in another browser.
- They are **deleted** if you clear your browser's history or site data, or if you use a private or incognito window.

So make a backup regularly, for example after preparing each lecture:

- **⬇ Export all sets (JSON)** downloads one file with all your sets (e.g. `classroom-game-backup-2026-11-05.json`). Keep it in Google Drive or email it to yourself.
- **⬇ Export** on a single set downloads just that set, for example to share it with a co-teacher.
- **⬆ Import backup (JSON)** loads sets from a backup file. Use it on a new laptop, or to restore your sets. If a set in the file already exists, you can choose to replace it or keep both.

---

## 6. Results and privacy

- At the end of a live game, **⬇ Download results (CSV)** saves a spreadsheet that opens in Excel or Google Sheets. Columns:
  `Rank, Nickname, Score, Correct answers, Questions answered, Questions played, Time joined`, then one column per question (`1` = correct, `0` = wrong, blank = no answer).
- **Time joined** uses your laptop's clock and time zone. If the laptop is set to Philippine time (UTC+8), that's what the CSV shows.
- The last 40 games are also listed under **Past game results** on the host page, so you can download a CSV again later. This list is kept only in this browser. Download the CSVs you need.
- **Nothing is sent anywhere else.** Answers go straight from each phone to your laptop. The free PeerJS server is used only to introduce the phones to your laptop (like a phone directory). It never sees questions, answers, names or scores. On very restrictive networks, the data may pass through a free relay server, but it is encrypted end-to-end. There is no tracking and no analytics.
- Tip: ask students to use their real name or student number as the nickname if you use the CSV for attendance.

---

## 7. Good to know

- **Phones:** works in the normal browser on Android (Chrome) and iPhone (Safari). If a student opens the link inside Messenger or Facebook and has trouble, they can tap "Open in browser".
- **Networks:** works on campus Wi-Fi or mobile data. Phones and laptop don't need to be on the same network. On very restrictive networks the connection goes through a free relay server, which can be a little slower.
- **Number of students:** meant for a normal class of a few dozen phones. The first time you use it with a full class, do a quick trial round with the sample set.
- **Keep the host tab open and visible.** You can switch to your slides and come back, but closing the tab ends the room (use **Resume game** to recover).
- **Free services used:** [PeerJS](https://peerjs.com/) (its free public server, loaded from the jsDelivr CDN), a QR code library, and the Lexend font from Google Fonts. If a CDN is blocked, a second CDN is tried automatically.

---

## For developers

Plain HTML, CSS and JavaScript. No build step.

```
index.html          student (phone) page
host.html           host page: sets, editor, live game, projector mode
css/style.css       all styles
js/core.js          shared logic: answer checking, scoring, paste-format parser, CSV, sample set
js/host-sets.js     set list, editor, paste, import/export, past results
js/host-game.js     live game host (PeerJS server side, game flow, scoring)
js/host-projector.js projector mode
js/student.js       phone client (join, auto-reconnect, answer screens)
tests/              automated tests (not needed to run the game)
```

To run it locally, serve the folder with any static server, for example `python3 -m http.server`, then open `http://localhost:8000/host.html`.

**Tests** (need Node.js 18+):

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

- `core.test.js` covers answer matching, scoring, the paste parser, CSV and the sample set.
- `e2e-live.test.js` runs a full live game in a real browser: one host and three phones on a private local PeerJS server. It covers duplicate nicknames, a wrong room code, a phone that disconnects and rejoins, pause and resume, the host page reloading mid-game and resuming, identification matching, the trick reveal, accepting a typed answer, and the CSV export.
- `e2e-host-ui.test.js` covers the editor, paste format errors, duplicate and delete, JSON export and import, and Projector mode (including resume after a refresh).

Advanced: add `?peerserver=host:port` to the host page address to use your own PeerJS server instead of the free public one. The QR code passes the setting along to phones.
