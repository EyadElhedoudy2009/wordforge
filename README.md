# WordForge — SAT vocab game

A daily 15-word vocabulary game: learn the words, play three rounds plus a boss fight, then
spaced-repetition reviews bring each word back until it is truly yours.

## Put it on your iPhone and PC (about 5 minutes, free)

The app is an installable web app. It needs to live at an https address once, then it installs
like a normal app and works offline.

1. Unzip this folder.
2. Go to **app.netlify.com/drop** and drag the whole `wordforge` folder onto the page.
   (GitHub Pages or Cloudflare Pages work too.) You get an https link.
3. **iPhone:** open the link in **Safari** → Share button → **Add to Home Screen**.
4. **PC:** open the link in Chrome or Edge → click the install icon at the right end of the
   address bar (or ⋮ menu → **Install WordForge**).

Just want to try it on a PC right now? Double-click `index.html`. It plays, but without install/offline.

## Every day

Open the app and play the day's level (15 words): each word one at a time, then the match-up, then the boss. Finishing a **new** level keeps your streak alive (once per day). A level unlocks when the one before it is finished. Reviews help you remember but do not count for the streak.

The 300 words are built into the game (`words.js`, 20 levels of 15). Players cannot add or remove levels. To change the words, edit `words.js`; raise `WF_CONTENT_VERSION` in it if saved progress should reset on every device.

## How it helps you memorise

- Word by word: each word gets its own mini-lesson. Its card (meaning and example), then: pick the meaning → see it in an example sentence → drag it into a sentence → spell it (by ear or from the definition). When all are right, the next word begins.
- Match-up: after all the words, tap the matching word/meaning pairs for the whole level.
- Boss battle: 3 hearts and trickier sentences, plus extra questions on the words you missed the most.
- Wrong answers come back a few questions later until you get them right
- Spaced repetition: a word is only **Mastered** after you recall it correctly on 4 separate days (1, 3, 7, 14-day gaps)

## Themes

9 themes, each unlocked by its own task (streaks, perfect rounds, combos, levels, XP, mastered words).
Every theme has a **Preview** button that shows the whole app in that theme before you earn or equip it.

## Voice

**More → Sound and voice** lets you pick which of your device's English voices reads the words. PCs and iPhones offer different voices.

## Backup

Progress is stored on the device. **More → Backup** copies or downloads it, and restores it on another device.

## Files

`index.html` · `styles.css` · `app.js` (screens) · `core.js` (game logic) · `words.js` (the game's levels)
· `sw.js` (offline) · `manifest.webmanifest` · `icons/`

## Recaps and chapters
- Inside a level the questions pile up: word 2 also asks about word 1, and from word 3 on two recap questions about earlier words are mixed in (missed words first). Levels never ask about words from other levels.
- After every 5 days comes a Chapter level (Chapter 1 after Day 5, and so on). It quizzes the five days before it: a 30-question mixed quiz, a match-up and a boss, weighted toward the words you missed before.
