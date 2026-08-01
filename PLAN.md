# PLAN.md — משחק "מתחזה"

תוכנית לאישור לפני כתיבת קוד. Stack: Vite + React + TypeScript + Tailwind + Vitest.
`src/game/` = לוגיקה טהורה, אפס React, אפס `Math.random`/`Date.now`.

---

## 1. סכמת ה-State

כל ה-state הוא אובייקט אחד, serializable ל-JSON במלואו (בלי `Date`/`Map`/`Set`/class).

```ts
type PlayerId = string;                       // 'p0', 'p1', ...
type Phase = 'SETUP' | 'REVEAL' | 'CLUES' | 'DISCUSSION'
           | 'VOTING' | 'VOTE_RESULT' | 'IMPOSTER_GUESS' | 'GAME_OVER';

type GameMode = 'HIDDEN' | 'KNOWN';           // סמוי (ברירת מחדל) | גלוי
type ClueMode = 'SPEAK' | 'TYPE';             // דיבור (ברירת מחדל) | הקלדה
type Winner  = 'CITIZENS' | 'IMPOSTERS';

type Settings = {
  mode: GameMode;                 // 'HIDDEN'
  clueMode: ClueMode;             // 'SPEAK'
  imposterCount: number;          // 1, או 2 כהצעה ב-7+ שחקנים
  discussionSeconds: 0 | 60 | 90 | 120;   // 0 = ללא טיימר
  clueTimerSeconds: number;       // 0 = ללא
  imposterGuessEnabled: boolean;  // true
};

type Player = {
  id: PlayerId;
  name: string;
  isImposter: boolean;            // אמת פנימית — לא נחשפת ל-UI דרך getPlayerView
  alive: boolean;
};

type GameState = {
  phase: Phase;
  settings: Settings;
  players: Player[];              // סדר קבוע = סדר ההזנה
  imposterIds: PlayerId[];

  // הסבב הנוכחי
  roundNumber: number;            // 1-based
  secretWordId: string | null;    // מפתח לערך במחסן
  hintIndex: number | null;       // איזה מ-5 הרמזים נבחר
  hintWord: string | null;        // המילה המנוקדת עצמה (העתק לנוחות ה-UI)

  // REVEAL
  revealIndex: number;            // איזה שחקן בתור לראות (אינדקס ב-players)
  revealShown: boolean;           // false = מסך "העבירו את המכשיר", true = המילה חשופה

  // CLUES
  turnOrder: PlayerId[];          // מוגרל מחדש בכל סבב
  clueTurnIndex: number;
  clues: Record<PlayerId, string>;   // רק במצב הקלדה; מתאפס בכל סבב

  // VOTING
  voteStage: 'FIRST' | 'RUNOFF';
  eligibleTargets: PlayerId[];       // ב-RUNOFF רק המובילים; אחרת כל החיים
  voterIndex: number;                // אינדקס בתוך voterOrder
  voterOrder: PlayerId[];            // השחקנים החיים, סדר קבוע
  votes: { voter: PlayerId; target: PlayerId }[];   // מוסתר מה-UI עד שכולם הצביעו

  // VOTE_RESULT
  lastVote: {
    tally: { playerId: PlayerId; count: number }[];  // ממוין יורד
    votes: { voter: PlayerId; target: PlayerId }[];  // ספירה מלאה — מי הצביע למי
    ejectedId: PlayerId | null;
    ejectedWasImposter: boolean | null;
    outcome: 'EJECTED' | 'TIE_RUNOFF' | 'TIE_NO_EJECTION';
  } | null;

  // IMPOSTER_GUESS
  guessingImposterId: PlayerId | null;
  guessOptions: string[] | null;     // 4 wordIds מאותה קטגוריה, מעורבבים
  guessResult: 'CORRECT' | 'WRONG' | null;

  winner: Winner | null;
};
```

### איך שני מצבי המשחק מיוצגים

* המצב הוא `settings.mode` **בתוך ה-state** — לא flag ב-UI.
* בשכבת הלוגיקה יש **פרויקציה** אחת שדרכה בלבד ה-UI מקבל מה שמוצג לשחקן:

```ts
// rules.ts — זה כל מה שמסך החשיפה מקבל
type RevealView =
  | { kind: 'PLAIN';    playerName: string; word: string }            // מצב סמוי — תמיד
  | { kind: 'CITIZEN';  playerName: string; word: string }            // מצב גלוי, אזרח
  | { kind: 'IMPOSTER'; playerName: string; word: string };           // מצב גלוי, מתחזה

getRevealView(state, playerId): RevealView
```

* **מצב סמוי:** `getRevealView` מחזיר `kind:'PLAIN'` לכל שחקן — אזרח מקבל `word = המילה הסודית`, מתחזה מקבל `word = hintWord`. באובייקט המוחזר **אין שום שדה** שמסמן תפקיד, ואי אפשר להסיק ממנו כלום. זה מה שהבדיקה תאמת.
* **מצב גלוי:** `kind` הוא `CITIZEN`/`IMPOSTER`. המתחזה מקבל `word = hintWord` + הכיתוב "אַתָּה הַמִּתְחַזֶּה". בשני המצבים אין שדה שמכיל את זהות המתחזה השני.
* **אנטי-הדלפה ב-UI:** קומפוננטת `<RevealCard>` אחת מרנדרת את שלושת המקרים באותה מסגרת בדיוק — אותו גובה, אותו `font-size` למילה, אותו מספר שורות (במצב סמוי שורת התפקיד היא `visibility:hidden` באותו גובה), אותו משך אנימציה. אין תלות בין משך המסך לתפקיד.

---

## 2. Actions

```ts
type Action =
  // SETUP
  | { type: 'SET_PLAYERS'; names: string[] }     // שמות חוזרים נחסמים ב-START_GAME
  | { type: 'UPDATE_SETTINGS'; patch: Partial<Settings> }
  | { type: 'START_GAME'; seed: string }        // בוחר מילה, רמז מ-5, מתחזים, סדר תורות

  // REVEAL
  | { type: 'SHOW_ROLE' }                       // מסך ביניים → חשיפה
  | { type: 'HIDE_ROLE' }                       // "הבנתי, הסתר" → השחקן הבא / CLUES

  // CLUES
  | { type: 'SUBMIT_CLUE'; playerId: PlayerId; text: string }   // מצב הקלדה
  | { type: 'NEXT_CLUE_TURN' }                                  // מצב דיבור
  | { type: 'FINISH_CLUES' }                    // → DISCUSSION

  // DISCUSSION / VOTING
  | { type: 'START_VOTING' }
  | { type: 'CAST_VOTE'; voter: PlayerId; target: PlayerId }    // ההצבעה האחרונה מסיימת → VOTE_RESULT

  // VOTE_RESULT
  | { type: 'CONTINUE'; seed: string }          // → VOTING(runoff) | CLUES | IMPOSTER_GUESS | GAME_OVER

  // IMPOSTER_GUESS
  | { type: 'SUBMIT_GUESS'; wordId: string }    // → GAME_OVER

  // GAME_OVER
  | { type: 'NEW_ROUND'; seed: string }         // אותם שחקנים + הגדרות → REVEAL
  | { type: 'BACK_TO_SETUP' };
```

**רנדומליות:** כל action שדורש הגרלה מקבל `seed: string`. ה-reducer גוזר ממנו תת-זרעים דטרמיניסטיים (`cyrb128` → `mulberry32`) בסדר קבוע: `word → hintIndex → imposters → turnOrder → guessDistractors`. אותו seed ⇒ אותו משחק בדיוק. ה-UI הוא זה שמייצר seed (`crypto.randomUUID()`) ומעביר אותו — כך שמצב אונליין עתידי פשוט ישלח seed מהשרת.

---

## 3. מעברי Phases

| מ- | Action | ל- | תנאי |
|---|---|---|---|
| SETUP | `START_GAME` | REVEAL | 3–12 שחקנים, **שם אחר לכל אחד**, `1 ≤ imposterCount < aliveCitizens` |
| REVEAL | `SHOW_ROLE` | REVEAL | `revealShown=true` |
| REVEAL | `HIDE_ROLE` | REVEAL | יש עוד שחקנים חיים לחשוף |
| REVEAL | `HIDE_ROLE` | CLUES | השחקן האחרון סיים |
| CLUES | `SUBMIT_CLUE` / `NEXT_CLUE_TURN` | CLUES | יש עוד תורות |
| CLUES | `SUBMIT_CLUE` / `NEXT_CLUE_TURN` / `FINISH_CLUES` | DISCUSSION | הסבב תם |
| DISCUSSION | `START_VOTING` | VOTING | — |
| VOTING | `CAST_VOTE` | VOTING | נשארו מצביעים |
| VOTING | `CAST_VOTE` | VOTE_RESULT | כולם הצביעו → ספירה |
| VOTE_RESULT | `CONTINUE` | VOTING | `outcome=TIE_RUNOFF` (`voteStage='RUNOFF'`, מועמדים = המובילים) |
| VOTE_RESULT | `CONTINUE` | CLUES | `TIE_NO_EJECTION`, או הודח ואין מנצח → סבב חדש: `roundNumber++`, מילה **נשארת**, `turnOrder` מוגרל מחדש, `clues` מתאפס |
| VOTE_RESULT | `CONTINUE` | IMPOSTER_GUESS | הודח המתחזה האחרון + `imposterGuessEnabled` |
| VOTE_RESULT | `CONTINUE` | GAME_OVER | יש מנצח ואין ניחוש |
| IMPOSTER_GUESS | `SUBMIT_GUESS` | GAME_OVER | נכון ⇒ `winner='IMPOSTERS'`, שגוי ⇒ `'CITIZENS'` |
| GAME_OVER | `NEW_ROUND` | REVEAL | מילה+רמז+מתחזים חדשים, אותם שחקנים והגדרות |
| כל phase | `BACK_TO_SETUP` | SETUP | — |

כל שילוב אחר של (phase, action) ⇒ `throw new InvalidTransitionError(phase, action.type)`.

### לוגיקת ניצחון (`rules.ts`)

```
aliveImposters ≥ aliveCitizens        → IMPOSTERS
aliveImposters === 0                  → CITIZENS (אלא אם ניחוש נכון)
```
עם מתחזה אחד זה מתלכד עם "נשארו 2 שחקנים והוא אחד מהם" — אותו כלל מכסה גם 2 מתחזים.

### תיקו

`voteStage='FIRST'` ותיקו ⇒ `TIE_RUNOFF`, הצבעה חוזרת רק בין המובילים.
`voteStage='RUNOFF'` ותיקו ⇒ `TIE_NO_EJECTION`, ממשיכים לסבב רמזים נוסף.

---

## 4. מחסן המילים

`src/game/words/<category>.json` (20 קבצים) + `index.ts` שמאחד לרשימה שטוחה ולמפת `id → WordEntry`.
`WordEntry = { id, word, hints[5], category }`, הכל ניקוד מלא ו-NFC.
`niqqud.ts`: `stripNiqqud(s) = s.normalize('NFC').replace(/[֑-ׇ]/g, '')` — **כל** השוואה/dedup עוברת דרכו, אין עמודת `plain` בנתונים.
`scripts/validate-words.ts` (`npm run validate:words`) — 5 הבדיקות שביקשת.
הקוד לא מניח 1000 ערכים בשום מקום; האפליקציה עובדת עם מחסן חלקי.
מסך הניחוש: המילה הנכונה + 3 מסיחים מאותה קטגוריה (dedup ללא ניקוד), מעורבבים ב-PRNG לפי seed.

---

## 5. הנחות שלקחתי (תקן אותי אם לא)

1. **אסור להצביע לעצמך** — `eligibleTargets` של מצביע לא מכיל אותו.
2. **מודחים לא מצביעים ולא אומרים רמזים** — הם רק צופים.
3. **המילה הסודית נשארת אותה מילה לכל אורך המשחק** — סבב רמזים נוסף אחרי הדחה לא מחליף מילה, רק מגריל סדר תורות מחדש. `NEW_ROUND` (סבב נוסף מהמסך סיום) כן מגריל מילה חדשה.
4. **הצבעה נדרשת** — אין "פסילה"/הימנעות.
5. **`REVEAL` בסבב הבא של אותו משחק לא חוזר** — התפקידים נחשפים פעם אחת בתחילת המשחק בלבד.
6. **טיימרים הם UI בלבד** — לא ב-state (כדי לא להכניס זמן ל-reducer). פקיעת טיימר רק מציעה למנחה להתקדם, לא מפעילה action לבד.
7. **מסך הניחוש מציג 4 אפשרויות** גם אם הקטגוריה קטנה — ולכן validate דורש ≥4 ערכים בקטגוריה.

---

## 6. שלבי ביצוע (commit בסוף כל שלב)

1. scaffold + `types` + `reducer` + `rules` + `niqqud` + טסטים עוברים
2. `validate-words.ts` + קטגוריה אחת (50 ערכים) — **עצירה לאישור איכות הניקוד והרמזים**
3. מסכי setup + חלוקת תפקידים, שני המצבים
4. סבב רמזים, דיון, הצבעה
5. סיום, ניחוש מתחזה, סבב נוסף
6. ליטוש עיצובי ואנימציות
7. 19 הקטגוריות הנותרות, אחת-אחת + `WORDS_PROGRESS.md`
