# ONLINE_PLAN.md — משחק במספר מכשירים

תוכנית ביצוע מפורטת. משלימה את `PLAN.md` ולא מחליפה אותו.

**עקרון-על:** `src/game/` לא משתנה בשורה אחת. כל טסטי הלוגיקה הקיימים חייבים
לעבור בלי נגיעה, וזה קריטריון הקבלה מספר 1.

---

## 0. אילוצים שקיבלנו

| אילוץ | השלכה |
|---|---|
| חינם לחלוטין, אפס תשלומים | אין שרת בענן. המארח הוא השרת |
| בלי שירותי צד שלישי (עד כמה שאפשר) | `peerjs` + הברוקר הציבורי שלו, רק ללחיצת יד |
| מעברים ברוב מוכן | סף `floor(alive/2)+1` על מעברי phase |
| הצבעה בו-זמנית | איסוף כוונות והשמעה ל-reducer לפי `voterOrder` |
| הקלדת רמזים לפי תור | תואם ל-`SUBMIT_CLUE` הקיים כמות שהוא |
| סבב מילולי (SPEAK) חייב להישאר | נתמך מלא במולטי |
| אפס פגיעה במצב מכשיר-אחד | כל הקוד החדש ב-`src/online/`; `src/ui/screens/` כמעט לא נוגעים |
| אבטחה מינימלית | אין טוקנים, אין הצפנה מעבר ל-DTLS של WebRTC |

---

## 1. ארכיטקטורה

```
      מכשיר המארח (גם שחקן)                אורח              אורח
 ┌──────────────────────────────┐
 │ useGame()   ← הקוד הקיים!    │
 │ GameState מלא                │ ──VIEW──▶  PlayerView  PlayerView
 │ pending intents (מחוץ ל-state)│ ◀─INTENT─   כוונות      כוונות
 │ projectView(state, playerId) │
 └──────────────────────────────┘
        │ מציג לעצמו
        ▼ projectView(state, hostPlayerId)
```

- המארח מריץ את ה-hook `useGame()` הקיים, ללא שינוי.
- המארח הוא שחקן רגיל ורואה בדיוק את אותם מסכים כמו כולם.
- אורח לא מריץ reducer בכלל. מקבל `PlayerView`, מצייר, שולח כוונה.
- **`GameState` גולמי לעולם לא עולה על הרשת.**

### הטריק המרכזי: איסוף כוונות והשמעה מחדש

שכבת הרשת אוספת **כוונות** (`{t:'VOTE', target}`), לא actions. כשהסף מתמלא,
המארח מתרגם אותן ל-actions ומשמיע אותן ל-reducer **בסדר שה-reducer מצפה לו**.

דוגמה — הצבעה בו-זמנית מול reducer שדורש תור:

```
1. כוונות זורמות פנימה:  pending.votes = { p0:'p3', p2:'p3', p1:'p0', ... }
   בינתיים משודר רק מונה: "4 מתוך 6 הצביעו"
2. כשכולם הצביעו, המארח משמיע לפי voterOrder:
     dispatch CAST_VOTE {voter: voterOrder[0], target: pending.votes[voterOrder[0]]}
     dispatch CAST_VOTE {voter: voterOrder[1], ...}
3. ה-reducer רואה רצף חוקי לחלוטין ולא יודע ששום דבר השתנה.
```

### הכלל: רוב מול פה-אחד

> **רוב מכריע *מעברים*. קלט שהמנוע דורש מכל שחקן — נדרש מכולם.**

| דורש את כולם | מספיק רוב |
|---|---|
| חשיפת תפקידים | דיון → הצבעה / סבב נוסף |
| הצבעה | תוצאות הצבעה → הלאה |
| רמז בתורו (TYPE) | סוף משחק → סבב נוסף |

לכל מקום שמחכה לכולם יש **כפתור עקיפה למארח**.

---

## 2. מפת קבצים

```
src/
  App.tsx                    🔧 בורר מצב בלבד (~25 שורות)
  SoloApp.tsx                ✨ גוף App.tsx הנוכחי, מועתק כמות שהוא

  game/                      ⛔ אפס שינויים
  ui/useGame.ts              ♻️ המארח משתמש בו כמו שהוא
  ui/storage.ts              ⛔ אפס שינויים (מפתח נפרד לאונליין)
  ui/components/*            ♻️ שימוש חוזר לקריאה בלבד
  ui/screens/SetupScreen.tsx 🔧 חילוץ מכני של פאנלי ההגדרות
  ui/components/settings/    ✨ הפאנלים המחולצים, משותפים לשני המצבים

  online/                    ✨ כל הקוד החדש
    protocol.ts     טיפוסי הודעות + קבועים
    view.ts         PlayerView + projectView()
    seats.ts        מושבים, קוד חדר, מיפוי seat↔playerId
    peer.ts         עטיפה דקה מעל PeerJS — נקודת ההחלפה היחידה
    storage.ts      זיכרון חיבור מחדש, מפתח נפרד
    useHost.ts      חיבורים + איסוף כוונות + השמעה
    useGuest.ts     חיבור + view + שליחת כוונות
    OnlineApp.tsx   ניתוב: HomeScreen → Host/Guest → OnlineGame
    OnlineGame.tsx  ניתוב מסכים לפי view.phase
    screens/*.tsx   מסכי המולטי
    wakeLock.ts     שמירת מסך המארח דלוק
```

### `App.tsx` החדש

```tsx
type Mode = 'SOLO' | 'ONLINE';

function initialMode(): Mode | null {
  if (readJoinCodeFromHash() !== null) return 'ONLINE';  // #join=1234
  if (loadGame() !== null) return 'SOLO';                // משחק סולו חי
  if (loadOnlineSession() !== null) return 'ONLINE';     // חיבור מחדש
  return null;
}

export default function App() {
  const [mode, setMode] = useState<Mode | null>(initialMode);
  if (mode === 'SOLO') return <SoloApp onExit={() => setMode(null)} />;
  if (mode === 'ONLINE') return <OnlineApp onExit={() => setMode(null)} />;
  return <HomeScreen onPick={setMode} />;
}
```

`initialMode` מחזיר `'SOLO'` כשיש משחק סולו שמור — כך שמי שהיה באמצע משחק
ורענן חוזר ישירות למשחק שלו ולא רואה בורר. **התנהגות המצב הקיים נשמרת.**

`SoloApp` = גוף `App.tsx` הנוכחי מילה במילה, פלוס `onExit` שנקרא כשמסך הפתיחה
מבוקש. שינוי היחיד: `HomeButton` מקבל גם `onExit` כדי לחזור לבורר במקום להישאר
ב-SETUP. (ברירת מחדל: להשאיר את התנהגות `reset` הקיימת; ראו סעיף 12.)

---

## 3. `src/online/protocol.ts`

```ts
export const PROTOCOL_VERSION = 1;
export const PEER_PREFIX = 'imposter-v1-';
export const ROOM_CODE_LENGTH = 4;
export const MAX_NAME_LENGTH = 14;   // זהה ל-SetupScreen
export const MAX_CLUE_LENGTH = 22;   // זהה ל-CluesScreen

export type SeatId = string;   // 's' + מונה עולה, ייחודי בתוך חדר

export type GuestMessage =
  | { t: 'JOIN'; v: number; name: string; seatId?: SeatId }
  | { t: 'LEAVE' }
  | { t: 'READY'; key: string }
  | { t: 'CHOOSE'; key: string; option: 'VOTE' | 'ANOTHER_ROUND' }
  | { t: 'VOTE'; key: string; target: PlayerId }
  | { t: 'CLUE'; key: string; text: string }
  | { t: 'NEXT_TURN'; key: string }
  | { t: 'GUESS'; key: string; wordId: string };

export type HostMessage =
  | { t: 'WELCOME'; v: number; seatId: SeatId }
  | { t: 'VIEW'; view: PlayerView }
  | { t: 'REJECTED'; reason: RejectReason }
  | { t: 'CLOSED'; reason: 'HOST_LEFT' };

export type RejectReason =
  | 'NAME_TAKEN' | 'ROOM_FULL' | 'ROOM_LOCKED'
  | 'BAD_VERSION' | 'NOT_ALLOWED' | 'STALE';
```

### `key` — חותם סנכרון (anti-stale)

כל כוונה נושאת `key` — מחרוזת שמזהה **בדיוק לאיזה רגע במשחק** היא שייכת:

```ts
syncKey(state) = `${phase}|${roundNumber}|${voteStage}|${clueTurnIndex}|${voterIndex}`
```

ה-`key` מגיע לאורח בתוך ה-`PlayerView` והוא מחזיר אותו בכל כוונה. המארח דוחה
(`STALE`) כל כוונה שה-`key` שלה לא תואם למצב הנוכחי. זה מכסה את כל מקרי המרוץ:
אורח שלוחץ בדיוק כשהמצב מתקדם, הודעה שמגיעה מאוחר, לחיצה כפולה.

---

## 4. `src/online/view.ts` — הגבול הביטחוני

הקוד היחיד שמחליט מה שחקן רואה.

```ts
export type ViewPlayer = {
  id: PlayerId; name: string; alive: boolean; connected: boolean;
};

export type WaitingOn = {
  kind: 'REVEAL' | 'CLUE' | 'VOTE' | 'READY';
  done: number; total: number;
  /** שמות מי שעוד לא — ל-READY/VOTE מציגים מונה בלבד. */
  names: string[];
};

export type PlayerView = {
  v: number;
  key: string;                       // syncKey — חוזר בכוונות
  you: { id: PlayerId; name: string; isHost: boolean; alive: boolean };
  phase: Phase;
  roundNumber: number;
  settings: Settings;
  players: ViewPlayer[];             // בלי isImposter. אף פעם.
  hostConnected: true;

  waiting: WaitingOn | null;
  deadlineAt: number | null;         // epoch ms לפי שעון המארח
  serverNow: number;                 // לתיקון היסט שעון אצל האורח

  // REVEAL
  reveal: RevealView | null;         // שלך בלבד
  youAcked: boolean;

  // CLUES
  turnOrder: PlayerId[];
  currentPlayerId: PlayerId | null;
  isYourTurn: boolean;
  clues: Record<PlayerId, string> | null;   // רק מ-DISCUSSION ואילך

  // DISCUSSION
  discussionOrder: PlayerId[];
  yourChoice: 'VOTE' | 'ANOTHER_ROUND' | null;
  choiceTally: { VOTE: number; ANOTHER_ROUND: number };

  // VOTING
  voteTargets: PlayerId[];           // כבר בלי עצמך
  voteStage: 'FIRST' | 'RUNOFF';
  youVoted: boolean;

  // VOTE_RESULT
  lastVote: VoteResult | null;

  // IMPOSTER_GUESS
  guessOptions: string[] | null;     // רק למנחש
  guessingPlayerId: PlayerId | null;

  // GAME_OVER
  ending: {
    secretWord: string; hintWord: string; hintKind: ImposterHintKind;
    category: string; imposterIds: PlayerId[];
    guessResult: 'CORRECT' | 'WRONG' | null; winner: Winner | null;
  } | null;

  youReady: boolean;
  readyCount: number;
  readyNeeded: number;
};
```

### טבלת ההסתרה

| שדה | נחשף רק ב… |
|---|---|
| `isImposter` / `imposterIds` | `GAME_OVER` (דרך `ending`) |
| המילה הסודית | `GAME_OVER`, ולאזרח במסך החשיפה שלו |
| `hintWord` | `GAME_OVER`, ולמתחזה במסך החשיפה שלו |
| `state.clues` | `phase !== 'CLUES'` בלבד |
| `state.votes` / `lastVote` | `phase === 'VOTE_RESULT'` ואילך |
| `guessOptions` | רק ל-`guessingImposterId` |
| `hintIndex` / `clueKind` / `secretWordId` | לעולם לא (נגזרים בלבד) |

### אי-הבחנה במצב סמוי

`getRevealView` הקיים כבר מחזיר `{kind:'PLAIN', playerName, word}` זהה מבנית
לכולם. `projectView` מעביר אותו הלאה בלי לגעת. כל שאר השדות ב-`PlayerView`
מחושבים בלי תלות בתפקיד — כך שגם ה-JSON על החוט זהה מבנית.

---

## 5. `src/online/seats.ts`

```ts
export type Seat = {
  seatId: SeatId;
  name: string;
  connId: string | null;   // מזהה החיבור של PeerJS; null = מנותק
  isHost: boolean;
};
```

- מושבים נוצרים בלובי לפי סדר ההצטרפות; המארח הוא `seats[0]` תמיד.
- **מיפוי `seat → playerId`:** בהתחלת המשחק המארח שולח `SET_PLAYERS` עם השמות
  בסדר המושבים. ה-reducer מייצר `p0..pN` באותו סדר, ולכן
  `playerId(seatIndex) = 'p' + seatIndex`. המיפוי ננעל עם המשחק.
- **הסדר ננעל:** אחרי `START_GAME` החדר נעול; מצטרף חדש מקבל `ROOM_LOCKED`.
  שחקן קיים שחוזר עם `seatId` מוכר מתחבר מחדש למושב שלו.
- קוד חדר: 4 ספרות (`1000`–`9999`). אם ה-peer id תפוס — הגרלה חוזרת עד 5 פעמים.

---

## 6. `src/online/peer.ts`

עטיפה דקה מעל `peerjs`, כדי שהחלפת ספריית ה-signaling תיגע בקובץ אחד.

```ts
export type Channel = {
  id: string;
  send(msg: unknown): void;
  close(): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
};

export function openHost(code: string): Promise<HostPeer>;
// HostPeer: { onConnect(cb: (ch: Channel) => void), close(), channels() }

export function joinHost(code: string): Promise<Channel>;
```

- מזהה ה-peer של המארח: `imposter-v1-<code>`.
- כל ההודעות JSON. אין binary.
- שגיאת `unavailable-id` → קוד חדש.
- לאורח: ניסיונות חיבור חוזרים בהשהיה עולה (1s, 2s, 4s, 8s, מקסימום 8s).

---

## 7. `src/online/useHost.ts`

```ts
export function useHost(hostName: string): {
  status: 'OPENING' | 'OPEN' | 'ERROR';
  code: string | null;
  seats: Seat[];
  view: PlayerView | null;      // התצוגה של המארח עצמו
  send: (msg: GuestMessage) => void;   // המארח שולח לעצמו, דרך אותו צינור
  settings: Settings; setSettings(patch): void;
  start(): void;
  hostOverride: HostOverride;    // עקיפות
  closeRoom(): void;
};
```

### מבנה פנימי

```ts
const game = useGame();                  // ה-hook הקיים
const stateRef = useRef(game.state);     // גישה עדכנית מתוך callbacks
stateRef.current = game.state;

const pending = useRef({
  reveal: new Set<PlayerId>(),
  ready:  new Set<PlayerId>(),
  choice: new Map<PlayerId, 'VOTE'|'ANOTHER_ROUND'>(),
  votes:  new Map<PlayerId, PlayerId>(),
});
```

`pending` הוא **ref, לא state** — הוא לא חלק מ-`GameState`, לא נשמר, ולא עובר
על הרשת. הוא מתאפס בכל שינוי `syncKey`.

### מחזור החיים של כוונה

```
1. handleIntent(seatId, msg)
2. אימות: seat מוכר? key תואם? phase נכון? השחקן חי? רשאי?
   ← אם לא: REJECTED, ויציאה. אף פעם לא מגיע ל-reducer.
3. רישום ב-pending
4. checkThresholds(): הסף התמלא?
   ← כן: מנקים את הדלי הרלוונטי ומשמיעים actions ל-reducer
5. useEffect([game.state]) → broadcast() לכל הערוצים
```

**שידור:** `useEffect(() => broadcastAll(), [game.state, seats, deadlineAt])`.
לכל ערוץ נשלח `{t:'VIEW', view: projectView(state, playerIdOf(seat), ctx)}`.
תמיד snapshot מלא — אין דלתאות, אין מספרי רצף, אין replay.

### טבלת הספים

| phase | כוונה | סף | ה-actions שמושמעים |
|---|---|---|---|
| `REVEAL` | `READY` | **כל החיים** | `SHOW_ROLE`,`HIDE_ROLE` × N לפי `revealOrder` |
| `CLUES` SPEAK | `NEXT_TURN` | התורן בלבד | `NEXT_CLUE_TURN` |
| `CLUES` TYPE | `CLUE` | התורן בלבד | `SUBMIT_CLUE {playerId, text}` |
| `DISCUSSION` | `CHOOSE` | **רוב** לאחת האפשרויות | `START_VOTING` / `ANOTHER_CLUE_ROUND` |
| `VOTING` | `VOTE` | **כל החיים** | `CAST_VOTE` × N לפי `voterOrder` |
| `VOTE_RESULT` | `READY` | **רוב** | `CONTINUE` |
| `IMPOSTER_GUESS` | `GUESS` | המנחש בלבד | `SUBMIT_GUESS` |
| `GAME_OVER` | `READY` | **רוב** | `NEW_ROUND` |

`majority(alive) = Math.floor(alive/2) + 1`

### עקיפות המארח (`HostOverride`)

| מתי מופיע | מה עושה |
|---|---|
| ממתינים לחשיפה ויש מנותק | `forceReveal()` — משלים את החסרים ומשמיע |
| ממתינים להצבעה ויש מנותק | `voteFor(playerId, target)` — המארח מצביע במקומו |
| `CLUES` והתורן מנותק | `skipTurn()` / `clueFor(text)` |
| תמיד | `forceAdvance()` — מדלג על סף הרוב |
| תמיד | `closeRoom()` |

העקיפות זמינות רק למארח ורק אחרי 10 שניות של המתנה, כדי שלא ילחצו עליהן מיד.

### טיימרים

```ts
deadlineAt = Date.now() + seconds * 1000   // נדרך בכניסה ל-phase
```

- `DISCUSSION` → `settings.discussionSeconds`
- `CLUES` SPEAK, בכל תור → `settings.clueTimerSeconds`
- `0` → `deadlineAt = null`
- כל `VIEW` נושא גם `serverNow: Date.now()`; האורח מחשב
  `offset = serverNow - Date.now()` ומצייר `deadlineAt - (Date.now() + offset)`.
- הטיימר **לא מקדם את המשחק**, בדיוק כמו היום. הוא רק אומר שהזמן נגמר.

---

## 8. `src/online/useGuest.ts`

```ts
export function useGuest(code: string, name: string): {
  status: 'CONNECTING' | 'JOINING' | 'PLAYING' | 'REJECTED' | 'CLOSED';
  view: PlayerView | null;
  send: (msg: GuestMessage) => void;
  reason: RejectReason | null;
  retry(): void;
};
```

- שולח `JOIN` עם `seatId` שמור אם יש, אחרת בלי.
- מקבל `WELCOME` → שומר `seatId` ב-localStorage.
- מקבל `VIEW` → מציב ומצייר. אין לוגיקה, אין reducer.
- ניתוק → באנר "מתחבר מחדש…" + ניסיונות חוזרים בהשהיה עולה.
- `CLOSED` → מסך "המארח סגר את החדר".
- `send` מצרף אוטומטית את `key` מה-view האחרון.

---

## 9. `src/online/storage.ts`

מפתח **נפרד** מהסולו, כדי שאי אפשר יהיה להתנגש:

```ts
const KEY = 'imposter/online/v1';
type Session = { code: string; seatId: SeatId; name: string; role: 'HOST'|'GUEST'; at: number };
```

- TTL: 6 שעות. סשן ישן יותר נזרק.
- `loadOnlineSession()`, `saveOnlineSession()`, `clearOnlineSession()`.
- **אין נגיעה ב-`src/ui/storage.ts`.**

---

## 10. המסכים

### חדשים — `src/online/screens/`

| מסך | תוכן |
|---|---|
| `HomeScreen` (ב-`src/`) | שתי בחירות: `מכשיר אחד` · `כל אחד בטלפון שלו` |
| `HostLobbyScreen` | קוד 4 ספרות ענק · "שתפו קישור" (Web Share API / העתקה) · רשימת מצטרפים חיה · פאנלי ההגדרות המשותפים · "התחילו" (מ-3 שחקנים) |
| `JoinScreen` | קוד → שם → המתנה. `#join=1234` מדלג ישר לשם |
| `GuestLobbyScreen` | מי כבר כאן + "מחכים למארח" |
| `OnlineRevealScreen` | `RevealCard` הקיים; אחריו `WaitingPanel` |
| `OnlineCluesScreen` | SPEAK: רצועת תורות + hero של התורן; רק לתורן כפתור. TYPE: רק לתורן שדה קלט |
| `OnlineDiscussionScreen` | לוח רמזים / סדר דיבור · טיימר · שני כפתורי בחירה + מונה |
| `OnlineVotingScreen` | רשת יעדים; אחרי הצבעה — נעילה + מונה |
| `OnlineVoteResultScreen` | ספירה מלאה + "מוכן" עם מונה רוב |
| `OnlineGuessScreen` | למנחש: 4 מילים. לשאר: "דנה מנחשת…" |
| `OnlineGameOverScreen` | הכול נחשף + "מוכן לסבב נוסף" |

### רכיבים חדשים

| רכיב | תפקיד |
|---|---|
| `WaitingPanel` | "מחכים ל…" + מונה + שמות (כשמותר) |
| `ConnectionBanner` | מצב חיבור, בסגנון באנר הגרסה החדשה הקיים |
| `HostStrip` | סרגל תחתון דק, רק למארח: עקיפות + סגירת חדר |
| `PlayerChips` | רצועת שמות עם סימון חי/מת/מנותק |

### עקרון עיצוב

**לכל מסך גרסת "שחקן פעיל" וגרסת "קהל"** — אותה פריסה, אותם רכיבים, הקהל מקבל
מונה במקום הכפתור. שימוש חוזר מלא ב-`Screen`/`ScreenHeader`/`ScreenBody`/
`ScreenFooter`/`RevealCard`/`WordHero`/`WordChip`/`TimerBar`. RTL, ניקוד,
פונטים ו-mobile-first — ללא שינוי.

---

## 11. חילוץ פאנלי ההגדרות

חילוץ **מכני בלבד**, אפס שינוי התנהגות. מתוך `SetupScreen.tsx` יוצאים ל-
`src/ui/components/settings/`:

| קובץ | תוכן |
|---|---|
| `Panel.tsx` | `Panel`, `Field`, `Toggle` — כמות שהם |
| `ModePanel.tsx` | פאנל "מצב משחק" + `MODE_CARDS` |
| `CategoriesPanel.tsx` | פאנל "קטגוריות" + `toggleCategory` |
| `RulesPanel.tsx` | פאנל "הגדרות" + `TIMER_OPTIONS` |

חתימה אחידה:

```ts
type PanelProps = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  playerCount: number;
};
```

`SetupScreen` מעביר `settings={state.settings}`, `onChange={set}`,
`playerCount={names.length}` — התנהגות זהה לחלוטין. הלובי מעביר את ה-state
המקומי שלו.

**סדר הדיספאץ' בהתחלת משחק במולטי** (חשוב):

```
1. SET_PLAYERS {names}        ← יוצר p0..pN וגם מקצץ imposterCount לפי הגודל
2. UPDATE_SETTINGS {settings} ← עכשיו players.length > 0, אז הקיצוץ נכון
3. START_GAME {seed}
```

הפוך לא יעבוד: `UPDATE_SETTINGS` מקצץ רק כש-`players.length > 0`.

---

## 12. תרחישי כשל

| תרחיש | טיפול |
|---|---|
| **המארח נועל מסך** — התקלה מספר 1 | `navigator.wakeLock.request('screen')` כל עוד החדר פתוח, מחודש ב-`visibilitychange`. כשל = שקט, לא שובר |
| המארח מרענן | `useGame` + `localStorage` הקיימים משחזרים; הפיר נפתח מחדש באותו קוד; אורחים מתחברים לבד |
| המארח סוגר סופית | `CLOSED` לכולם + מסך ברור. בלי מסך תקוע |
| טלפון של אורח מת | המושב מסומן מנותק. חוזר עם אותו `seatId`. המארח יכול לעקוף |
| אורח סוגר לגמרי | המושב נשאר; המשחק ממשיך עם עקיפות המארח |
| רשתות שונות / NAT | עובד מצוין באותו wifi. ברשתות שונות ייתכן שמיעוט לא יתחבר בלי TURN — המחיר של 0$ |
| הברוקר של PeerJS למטה | משחק רץ לא מושפע (הנתונים P2P). רק הצטרפות חדשה |
| קוד תפוס | הגרלה חוזרת, עד 5 ניסיונות |
| כוונה מאוחרת / לחיצה כפולה | `syncKey` דוחה אותה כ-`STALE` |
| הודעה מעוותת / זדונית | אימות מלא לפני ה-reducer; `REJECTED` |
| שני חדרים באותו קוד | `imposter-v1-` namespace + הברוקר מונע כפילות id |
| המארח מציץ ב-devtools | **התקבל במודע.** אין הגנה בלי שרת |
| מחסן מילים ב-bundle | קיים כבר היום. התקבל |

---

## 13. בדיקות

| # | בדיקה | קובץ |
|---|---|---|
| 1 | **כל טסטי `src/game/` עוברים בלי נגיעה** — קריטריון הקבלה מספר 1 | קיימים |
| 2 | **אי-הדלפה:** לכל `phase × שחקן`, `JSON.stringify(projectView(...))` לא מכיל את המילה הסודית, לא `hintWord` של אחרים, ולא זהות מתחזה — עד `GAME_OVER` | `view.test.ts` |
| 3 | **אי-הבחנה:** במצב `HIDDEN`, ה-view של המתחזה זהה מבנית (אותם מפתחות, אותה סכמה) לזה של אזרח | `view.test.ts` |
| 4 | **שקילות מצבים:** משחק שלם דרך `testUtils` מול משחק שלם דרך ה-driver, אותו seed → `GameState` סופי זהה בית-בית | `driver.test.ts` |
| 5 | **ספים:** רוב/פה-אחד מחושבים נכון, כולל אחרי הדחות | `driver.test.ts` |
| 6 | **`syncKey`:** כוונה עם key ישן נדחית ולא משנה state | `driver.test.ts` |
| 7 | **אימות כוונות:** לא-תורן, מת, יעד לא כשיר, טקסט ריק, טקסט ארוך מדי — כולם נדחים לפני ה-reducer | `driver.test.ts` |
| 8 | **מיפוי מושבים:** `seat[i] ↔ p{i}` נשמר גם אחרי `NEW_ROUND` | `seats.test.ts` |
| 9 | `npm run validate:words` + `npm run build` + `tsc -b` | CI קיים |
| 10 | ידני: 3 מכשירים, שני מצבי רמזים, ניתוק וחיבור מחדש | — |

**הדרישה שנגזרת:** לוגיקת ההשמעה חייבת להיות **פונקציה טהורה שאפשר לבדוק ב-Node
בלי React ובלי רשת.** לכן היא יושבת ב-`src/online/driver.ts` ולא בתוך ה-hook:

```ts
// טהור, בלי React, בלי רשת
export function handleIntent(
  state: GameState, pending: Pending, seat: SeatRef, msg: GuestMessage
): { accepted: boolean; reason?: RejectReason; actions: Action[]; pending: Pending };
```

`useHost` הוא רק צנרת סביבו. זה מה שהופך את בדיקות 4–7 לאפשריות.

`vite.config.ts`: `include: ['src/game/**/*.test.ts']` → `['src/**/*.test.ts']`.

---

## 14. שלבי ביצוע

| שלב | תוכן | קריטריון סיום |
|---|---|---|
| **A** | חילוץ ההגדרות · `App.tsx` → בורר · `SoloApp.tsx` · `HomeScreen` | סולו עובד בדיוק כמו קודם; `npm test` ירוק |
| **B** | `protocol.ts` · `view.ts` · `seats.ts` · `driver.ts` + כל הטסטים הטהורים | בדיקות 2–8 ירוקות, בלי שורת רשת אחת |
| **C** | `peer.ts` · `useHost` · `useGuest` · לובי | 3 מכשירים רואים זה את זה |
| **D** | מסכי המשחק, שני מצבי הרמזים | משחק שלם מקצה לקצה |
| **E** | עקיפות מארח · ניתוקים · Wake Lock · טיימרים · ליטוש | עמיד לתקלות |

**שלב B לפני C** בכוונה: כל הלוגיקה הקשה נכתבת ונבדקת בלי רשת בכלל. שלב C
נשאר צנרת דקה.

---

## 15. מה מוותרים עליו במודע

- **המארח יכול לרמות** דרך devtools. אין דרך אחרת בלי שרת.
- **המשחק תלוי בטלפון של המארח** שיישאר פתוח.
- **כפילות UI** — מסכי המולטי נכתבים מעל אותם רכיבי תצוגה במקום לשתף מסכים.
  זה המחיר של אפס סיכון למשחק הקיים.
- **אין מסך משותף / צופה.**
- **אין TURN** — רשתות שונות עלולות להיכשל למיעוט.
