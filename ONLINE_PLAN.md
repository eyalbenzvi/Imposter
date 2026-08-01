# ONLINE_PLAN.md — משחק במספר מכשירים

תוכנית ביצוע. משלימה את `PLAN.md` ולא מחליפה אותו.
**גרסה 2** — אחרי ביקורת ארכיטקטורה. סעיף 16 מסכם מה השתנה ולמה.

**עקרון-על:** `src/game/` לא משתנה בשורה אחת. כל טסטי הלוגיקה הקיימים חייבים
לעבור בלי נגיעה — קריטריון הקבלה מספר 1.

---

## 0. אילוצים

| אילוץ | השלכה |
|---|---|
| חינם לחלוטין | אין שרת. המארח הוא השרת |
| בלי שירותי צד שלישי | `peerjs` + הברוקר הציבורי, רק ללחיצת יד |
| מעברים ברוב מוכן | סף רוב על מעברי phase |
| הצבעה בו-זמנית | איסוף כוונות והשמעה לפי `voterOrder` |
| הקלדת רמזים לפי תור | תואם ל-`SUBMIT_CLUE` הקיים |
| סבב מילולי (SPEAK) נשמר | נתמך מלא |
| אפס פגיעה בסולו | כל הקוד ב-`src/online/`; `src/game/` לא נוגעים |
| אבטחה מינימלית | אין טוקנים; DTLS של WebRTC בלבד |

---

## 1. ארכיטקטורה

```
      מכשיר המארח (גם שחקן)               אורח           אורח
 ┌────────────────────────────────┐
 │ Room (ref) — סמכות סינכרונית   │
 │   state: GameState             │ ──VIEW──▶  PlayerView
 │   pending: כוונות שנצברות      │ ◀─INTENT─    כוונות
 │   epoch / version              │
 │ reducer() מיובא, לא משתנה      │
 └────────────────────────────────┘
```

- המארח מחזיק `Room` ב-ref ומקדם אותו **סינכרונית** עם `reducer()` המיובא.
  React משמש רק לציור. **המארח לא משתמש ב-`useGame`** (ראו 16.1).
- המארח הוא שחקן רגיל ורואה את אותם מסכים כמו כולם.
- אורח לא מריץ reducer. מקבל `PlayerView`, מצייר, שולח כוונה.
- **`GameState` גולמי לעולם לא עולה על הרשת.**

### הטריק המרכזי: איסוף כוונות והשמעה מחדש

שכבת הרשת אוספת **כוונות**, לא actions. כשהסף מתמלא, ה-driver מתרגם אותן
ל-actions ומשמיע אותן ל-reducer בסדר שהוא מצפה לו.

```
1. כוונות זורמות:  pending.votes = { p0:'p3', p2:'p3', p1:'p0', … }
   כל כוונה מקודמת את version → שידור מיידי של מונה "4 מתוך 6 הצביעו"
2. כשכולם הצביעו — קיפול טרנזקציוני:
     let s = room.state
     try { for (a of actions) s = reducer(s, a) } catch { → דחיית כל האצווה }
   actions = CAST_VOTE לפי voterOrder
3. רק אם כל האצווה עברה — היא נכנסת. אחרת שום דבר לא קורה ו-pending נשמר.
```

### ספים: רוב מול פה-אחד

> **רוב מכריע *מעברים*. קלט שהמנוע דורש מכל שחקן — נדרש מכולם.**

---

## 2. מפת קבצים

```
src/
  App.tsx                 🔧 ~15 שורות: סולו כברירת מחדל, אונליין כשצריך
  SoloApp.tsx             ✨ גוף App.tsx הנוכחי, מועתק מילה במילה

  game/                   ⛔ אפס שינויים
  ui/useGame.ts           ⛔ אפס שינויים (סולו בלבד!)
  ui/storage.ts           ⛔ אפס שינויים
  ui/components/*         ♻️ שימוש חוזר לקריאה בלבד
  ui/screens/SetupScreen  🔧 חילוץ פאנלים + כפתור "כל אחד בטלפון שלו"
  ui/components/settings/ ✨ הפאנלים המחולצים, משותפים

  online/
    protocol.ts    הודעות, קבועים, RejectReason
    view.ts        PlayerView + projectView()
    room.ts        טיפוסי Room/Seat/Pending + יצירה
    driver.ts      ⭐ טהור: אימות, ספים, קיפול טרנזקציוני
    storage.ts     סשן מארח/אורח, מפתח נפרד
    peer.ts        עטיפה מעל PeerJS — נקודת ההחלפה היחידה
    useHost.ts     צנרת: ערוצים ↔ driver ↔ שידור
    useGuest.ts    צנרת: חיבור ↔ view
    OnlineApp.tsx  ניתוב מארח/אורח
    OnlineGame.tsx ניתוב מסכים לפי view.phase
    screens/*
```

### `App.tsx` — הדיף המינימלי

```tsx
export default function App() {
  const [online, setOnline] = useState(shouldStartOnline);   // hash / סשן שמור
  if (online) return <OnlineApp onExit={() => setOnline(false)} />;
  return <SoloApp onGoOnline={() => setOnline(true)} />;
}
```

`SoloApp` = גוף `App.tsx` הנוכחי מילה במילה, כולל `useFreshBuild`, `HomeButton`
ובאנר השגיאה. **⌂ בסולו מתנהג בדיוק כמו היום** (`reset` → SETUP). הכניסה
לאונליין היא כפתור חדש ב-`SetupScreen`. כך "סולו עובד בדיוק כמו קודם" הוא
טענה מילולית, לא בערך.

---

## 3. `protocol.ts`

```ts
export const PROTOCOL_VERSION = 1;
export const PEER_PREFIX = 'imposter-v1-';
export const MAX_NAME_LENGTH = 14;    // כמו SetupScreen
export const MAX_CLUE_LENGTH = 22;    // כמו CluesScreen

export type SeatId = string;

export type GuestMessage =
  | { t:'JOIN';       v:number; name:string; seatId?:SeatId }
  | { t:'LEAVE' }
  | { t:'READY';      key:string }
  | { t:'CHOOSE';     key:string; option:'VOTE'|'ANOTHER_ROUND' }
  | { t:'VOTE';       key:string; target:PlayerId }
  | { t:'CLUE';       key:string; text:string }
  | { t:'NEXT_TURN';  key:string }
  | { t:'SKIP_CLUES'; key:string }
  | { t:'GUESS';      key:string; wordId:string };

export type HostMessage =
  | { t:'WELCOME';  v:number; seatId:SeatId }
  | { t:'VIEW';     view:PlayerView }
  | { t:'REJECTED'; reason:RejectReason; key:string|null; on:GuestMessage['t'] }
  | { t:'CLOSED';   reason:'HOST_LEFT' };

export type RejectReason =
  | 'NAME_TAKEN' | 'NAME_EMPTY' | 'NAME_LONG' | 'ROOM_FULL' | 'ROOM_LOCKED'
  | 'BAD_VERSION' | 'NOT_ALLOWED' | 'STALE' | 'SEAT_TAKEN' | 'BAD_PAYLOAD';
```

### `key` = `epoch`, לא שדות נגזרים

ה-`Room` מחזיק **שני** מונים:

| מונה | עולה כש… | תפקיד |
|---|---|---|
| `epoch` | actions הוחלו על `state` | **זהו ה-`key`.** דוחה כוונות ישנות |
| `version` | *כל* שינוי ב-Room, כולל `pending` | מפעיל render + שידור |

הפרדה זו מכריעה: `epoch` לבדו היה חוסם כוונה תקפה רק כי שחקן אחר הצביע;
`version` לבדו היה מדליף מונים בלי לדחות כוונות ישנות. שדות נגזרים
(`phase|roundNumber|…`) נפסלו — `NEW_ROUND` מאפס את כולם וכוונה מהמשחק הקודם
הייתה מתקבלת (16.3).

---

## 4. `view.ts` — הגבול הביטחוני

```ts
export type ViewPlayer = { id:PlayerId; name:string; alive:boolean; connected:boolean };

export type Waiting = {
  kind: 'REVEAL'|'CLUE'|'VOTE'|'READY'|'CHOOSE';
  done:number; needed:number; total:number;
  youDone:boolean;
  /** רק כשמותר לחשוף מי חסר. תמיד בסדר state.players — לא תלוי תפקיד. */
  names:string[];
};

export type PlayerView = {
  v:number;
  key:string;                        // epoch
  you:{ id:PlayerId; name:string; isHost:boolean; alive:boolean };
  phase:Phase; roundNumber:number; settings:Settings;
  players:ViewPlayer[];              // בלי isImposter. אף פעם.
  waiting:Waiting|null;
  deadlineAt:number|null;
  serverNow:number;                  // תיקון היסט שעון אצל האורח

  reveal:RevealView|null;            // שלך בלבד
  turnOrder:PlayerId[]; discussionOrder:PlayerId[];
  currentPlayerId:PlayerId|null; isYourTurn:boolean;
  clues:Record<PlayerId,string>|null;      // רק כש-phase !== 'CLUES'
  yourChoice:'VOTE'|'ANOTHER_ROUND'|null;
  choiceTally:{ VOTE:number; ANOTHER_ROUND:number };
  voteTargets:PlayerId[]; voteStage:'FIRST'|'RUNOFF'; youVoted:boolean;
  lastVote:VoteResult|null;                 // רק מ-VOTE_RESULT
  guessOptions:{ id:string; word:string }[]|null;   // רק למנחש
  guessingPlayerId:PlayerId|null;
  ending:{ secretWord:string; hintWord:string; hintKind:ImposterHintKind;
           category:string; imposterIds:PlayerId[];
           guessResult:'CORRECT'|'WRONG'|null; winner:Winner|null }|null;
};
```

הוסר `hostConnected` (טאוטולוגיה) ואוחדו `youReady`/`readyCount`/`readyNeeded`
לתוך `waiting` (16.22–23). `guessOptions` נושא `{id, word}` — ה-state מחזיק
ids ו-`SUBMIT_GUESS` מאמת ids, אבל המסך צריך להציג מילים (16.18).

### טבלת ההסתרה

| שדה | נחשף רק ב… |
|---|---|
| `isImposter` / `imposterIds` | `GAME_OVER` (דרך `ending`) |
| המילה הסודית | `GAME_OVER`; ולאזרח ב-`reveal` שלו |
| `hintWord` | `GAME_OVER`; ולמתחזה ב-`reveal` שלו |
| `state.clues` | `phase !== 'CLUES'` |
| `lastVote` | `phase === 'VOTE_RESULT'` ואילך |
| `guessOptions` | רק ל-`state.guessingImposterId` |
| `secretWordId` / `hintIndex` / `clueKind` / `revealOrder` | לעולם |

`projectView` ב-`phase === 'SETUP'` מחזיר תצוגת לובי ולא נוגעת ב-
`getRevealView`/`getSecretEntry` (שזורקות כשאין מילה — 16.15).

---

## 5. `room.ts` — מושבים וזהות

```ts
export type Seat = { seatId:SeatId; name:string; connId:string|null; isHost:boolean };

export type Pending = {
  reveal:PlayerId[]; ready:PlayerId[];
  choice:Record<PlayerId,'VOTE'|'ANOTHER_ROUND'>;
  votes:Record<PlayerId,PlayerId>;
};

export type Room = {
  code:string;
  seats:Seat[];
  /** ננעל ב-START_GAME. index i ↔ playerId 'p'+i. מקור האמת היחיד לזהות. */
  seatOrder:SeatId[]|null;
  locked:boolean;
  settings:Settings;
  state:GameState;
  pending:Pending;
  epoch:number; version:number;
  deadlineAt:number|null;
};
```

- `playerIdOf(room, seatId)` נגזר **רק** מ-`seatOrder`, לעולם לא מ-`seats`
  החי. לפני כל שידור: `assert(seatOrder.length === state.players.length)`,
  ואם לא — סגירת חדר במקום שידור שגוי (16.8).
- `seatOrder` **נשמר** ב-localStorage יחד עם ה-state, כך שרענון של המארח
  משחזר את המיפוי ולא בונה אותו מסדר החיבורים מחדש.
- אימות `JOIN` באותם עוזרים שה-reducer משתמש בהם: `nameKey` להשוואה,
  `MAX_NAME_LENGTH`, שם ריק, `MAX_PLAYERS = 12` (16.7).
- `JOIN` חוזר מאותו `connId` הוא **idempotent** — מחזיר את המושב הקיים ולא
  `NAME_TAKEN` (16.13).
- קוד: 4 ספרות. סשן שמור לאותו קוד → ניסיונות חוזרים על **אותו** קוד לפחות
  45 שניות לפני הגרלה חדשה (16.14).

---

## 6. `driver.ts` — הליבה הטהורה

בלי React, בלי רשת, בלי `Date.now()`, בלי `Math.random()`.

```ts
export type Env = { seed:string; now:number };
export type Outcome = { room:Room; accepted:boolean; reason?:RejectReason };

export function handleJoin(room, connId, msg): Outcome & { seatId?:SeatId };
export function handleIntent(room, seatId, msg, env): Outcome;
export function hostCommand(room, cmd: HostCommand, env): Outcome;
export function startGame(room, env): Outcome;
export function dropConnection(room, connId): Room;
```

`env` מוזרק — כך ה-driver נשאר טהור ובדיק, וגם `START_VOTING`/`CONTINUE`/
`NEW_ROUND`/`ANOTHER_CLUE_ROUND` (שכולם דורשים `seed`) ו-`deadlineAt`
(שדורש שעון) אפשריים בלי לשבור אותה (16.12).

### קיפול טרנזקציוני

```ts
function applyAll(state, actions): GameState | null {
  let s = state;
  try { for (const a of actions) s = reducer(s, a); return s; }
  catch { return null; }          // כל האצווה נדחית. pending נשמר.
}
```

בלי זה, `HIDE_ROLE` שנכשל באמצע היה מותיר `revealViews` על 2 ומקפיא את
ה-phase בלי הודעה (16.5).

### טבלת הרשאות וספים

| phase | כוונה | מי רשאי | ציבור הבוחרים | סף | actions |
|---|---|---|---|---|---|
| `SETUP` | `JOIN` | כל עוד לא נעול | — | — | — |
| `REVEAL` | `READY` | כל שחקן | כל השחקנים | **כולם** | `SHOW_ROLE`,`HIDE_ROLE` × N |
| `CLUES` SPEAK | `NEXT_TURN` | `currentCluePlayer` בלבד | — | 1 | `NEXT_CLUE_TURN` |
| `CLUES` TYPE | `CLUE` | `currentCluePlayer` בלבד | — | 1 | `SUBMIT_CLUE` |
| `CLUES` | `SKIP_CLUES` | חיים | חיים | רוב | `FINISH_CLUES` |
| `DISCUSSION` | `CHOOSE` | חיים | חיים | רוב, או fallback | `START_VOTING` / `ANOTHER_CLUE_ROUND` |
| `VOTING` | `VOTE` | חי, טרם הצביע | חיים | **כולם** | `CAST_VOTE` × N לפי `voterOrder` |
| `VOTE_RESULT` | `READY` | **כולם, גם מודחים** | **כל השחקנים** | רוב | `CONTINUE` |
| `IMPOSTER_GUESS` | `GUESS` | **`guessingImposterId` בלבד — והוא מת** | — | 1 | `SUBMIT_GUESS` |
| `GAME_OVER` | `READY` | **כולם, גם מודחים** | **כל השחקנים** | רוב | `NEW_ROUND` |

`majority(n) = Math.floor(n/2) + 1`

שלוש התיקונים המהותיים בטבלה:
- **`IMPOSTER_GUESS`:** המנחש הוא בדיוק מי שהודח, כלומר `alive === false`.
  בדיקת "חי" גורפת הייתה מקפיאה את המשחק ללא מוצא (16.6).
- **`VOTE_RESULT` / `GAME_OVER`:** הסבב נגמר; מודחים עדיין בחדר עם טלפון ביד.
  הציבור הוא כל השחקנים, לא רק החיים (16.9).
- **`SKIP_CLUES`:** לסולו יש "דלגו לדיון"; לאונליין לא הייתה דרך (16.17).

### שובר שוויון ב-`DISCUSSION`

מספר זוגי של חיים יכול להיתקע 2–2. הכלל: **כשכל החיים בחרו ואין רוב —
`START_VOTING`.** האפשרות שמקדמת את המשחק מנצחת (16.10).

### טיימרים

אחרי כל אצווה מוצלחת, אם ה-phase או `clueTurnIndex` השתנו:

```
deadlineAt = timerFor(state) > 0 ? env.now + timerFor(state)*1000 : null
timerFor: DISCUSSION → discussionSeconds · CLUES+SPEAK → clueTimerSeconds · אחרת 0
```

כל `VIEW` נושא `serverNow`; האורח מחשב `offset = serverNow - Date.now()`.
הטיימר **לא מקדם את המשחק**, כמו היום.

### עקיפות מארח (`HostCommand`)

`FORCE_REVEAL` · `VOTE_FOR {playerId,target}` · `CLUE_FOR {text}` ·
`SKIP_TURN` · `FORCE_CHOICE {option}` · `GUESS_FOR {wordId}` · `FORCE_ADVANCE`

עוברות באותו driver עם בדיקות מוקלות. מופיעות רק אחרי 10 שניות המתנה.
`FORCE_CHOICE` מקבל את האפשרות כארגומנט — ל-`DISCUSSION` יש שני יורשים
ו-"קדם" סתמי לא היה מוגדר (16.10).

---

## 7. `useHost.ts` — צנרת בלבד

```ts
const roomRef  = useRef<Room>(restoreOrCreate());
const [version, setVersion] = useState(roomRef.current.version);
function commit(next: Room) { roomRef.current = next; setVersion(next.version); }
```

- כל כוונה נכנסת דרך `handleIntent` **סינכרונית** מול `roomRef.current` —
  שהוא כבר המצב שאחרי הפעולה הקודמת. אין חלון בו `stateRef` מפגר אחרי
  `dispatch` (16.4).
- `useEffect(() => broadcastAll(), [version])` — כל שינוי, כולל `pending`,
  משדר. המונים החיים באמת חיים (16.2).
- `broadcastTo(channel)` נקרא **מיד** עם כל `WELCOME`/פתיחת ערוץ, כך שאורח
  שחוזר באמצע `DISCUSSION` לא נתקע על מסך ריק עד השינוי הבא (16.11).
- `persist()` על כל שינוי `epoch`: `{code, seats, seatOrder, state, epoch,
  settings}` תחת המפתח של האונליין.
- **המארח לא נוגע ב-`imposter/v1`** — אין `useGame`, אין `saveSnapshot` (16.1).

### התאוששות מרקע (iOS)

Wake Lock לבדו לא מספיק: iOS משעה טאב ברקע ומפיל DataChannels.

- `wakeLock.request('screen')` כל עוד החדר פתוח, מחודש ב-`visibilitychange`.
- ב-`visibilitychange → visible`: `peer.reconnect()` + שידור מלא לכל הערוצים.
- אזהרה חד-פעמית בלובי: "השאירו את המסך פתוח".
- `ConnectionBanner` גם אצל המארח (16.16).

### סגירת חדר

בקרת המארח באונליין היא **"סגירת חדר"**, לא `BACK_TO_SETUP`: שולחת
`CLOSED` לכולם, סוגרת את הפיר, מנקה את הסשן. תצוגת `SETUP` לעולם לא נשלחת
באמצע משחק (16.15).

---

## 8. `useGuest.ts`

- `JOIN` עם `seatId` שמור אם יש. `WELCOME` → שמירה. `VIEW` → ציור.
- `send` מצרף אוטומטית את `key` מה-view האחרון.
- `REJECTED{STALE}` — **שקט**: המארח משדר VIEW מחדש לאותו ערוץ והמסך מתקן
  את עצמו. שגיאה גלויה רק ל-`NOT_ALLOWED`/`BAD_VERSION` (16.20).
- `BAD_VERSION` → מסך עם `loadFreshBuild()` ("יש גרסה חדשה — הקישו לרענון").
  `useFreshBuild` רץ בלובי המארח וב-`JoinScreen` (16.21).
- ניתוק → באנר + ניסיונות חוזרים בהשהיה עולה (1,2,4,8s).

---

## 9. `storage.ts` — מפתח נפרד

```ts
const KEY = 'imposter/online/v1';
type Saved = { host?: HostSession; guest?: GuestSession };
type HostSession  = { code; seats; seatOrder; state; epoch; settings; at };
type GuestSession = { code; seatId; name; at };
```

TTL 6 שעות. הסשן ממופתח לפי `code`, וה-driver דוחה `JOIN` עם `seatId`
שמוחזק כרגע על ידי `connId` חי (`SEAT_TAKEN`) — שני טאבים על טלפון אחד לא
גונבים מושב זה מזה (16.24).

**אפס נגיעה ב-`src/ui/storage.ts`.**

---

## 10. מסכים

| מסך | תוכן |
|---|---|
| `HostLobbyScreen` | קוד ענק · שיתוף קישור · מצטרפים חיים · פאנלי הגדרות · "התחילו" |
| `JoinScreen` | קוד → שם → המתנה. `#join=1234` מדלג לשם |
| `OnlineRevealScreen` | `RevealCard` הקיים → `WaitingPanel` |
| `OnlineCluesScreen` | SPEAK: רצועה + hero, כפתור לתורן. TYPE: שדה לתורן |
| `OnlineDiscussionScreen` | לוח רמזים / סדר דיבור · טיימר · שתי בחירות + מונה |
| `OnlineVotingScreen` | רשת יעדים → נעילה + מונה |
| `OnlineVoteResultScreen` | ספירה מלאה + "מוכן" עם מונה |
| `OnlineGuessScreen` | למנחש 4 מילים; לשאר "דנה מנחשת…" |
| `OnlineGameOverScreen` | הכול נחשף + "מוכן לסבב נוסף" |

רכיבים: `WaitingPanel` · `ConnectionBanner` · `HostStrip` · `PlayerChips`.

**לכל מסך גרסת "שחקן פעיל" וגרסת "קהל"** — אותה פריסה, מונה במקום כפתור.
שימוש חוזר מלא ב-`Screen`/`RevealCard`/`WordHero`/`WordChip`/`TimerBar`.

---

## 11. חילוץ פאנלי ההגדרות

חילוץ מכני, אפס שינוי התנהגות, ל-`src/ui/components/settings/`:
`Panel.tsx` (`Panel`,`Field`,`Toggle`) · `ModePanel` · `CategoriesPanel` ·
`RulesPanel`. חתימה אחידה `{settings, onChange, playerCount}`.

**סדר הדיספאץ' בהתחלת משחק אונליין:**

```
1. SET_PLAYERS {names}         ← יוצר p0..pN לפי סדר seatOrder
2. UPDATE_SETTINGS {settings}  ← עכשיו players.length > 0, הקיצוץ נכון
3. START_GAME {seed}
```

הפוך לא יעבוד — `UPDATE_SETTINGS` מקצץ רק כש-`players.length > 0`.
לפני זה, `startGame` מוודא `state.phase === 'SETUP'` ומחזיר שגיאה גלויה
אם לא.

---

## 12. תרחישי כשל

| תרחיש | טיפול |
|---|---|
| המארח נועל מסך / עובר לאפליקציה אחרת | Wake Lock + התאוששות ב-`visibilitychange` + אזהרה בלובי |
| המארח מרענן | סשן אונליין משחזר `state` **ו-`seatOrder`**; אותו קוד, 45s ניסיונות |
| המארח סוגר סופית | `CLOSED` לכולם + מסך ברור |
| טלפון אורח מת | מושב מסומן מנותק; חוזר עם `seatId`; עקיפות מארח |
| כוונה מאוחרת / כפולה | `epoch` דוחה כ-`STALE`, בשקט, עם שידור מתקן |
| הודעה מעוותת | אימות מלא לפני ה-reducer; `BAD_PAYLOAD` |
| StrictMode במפתח | singleton לפי קוד; teardown idempotent ודחוי; `JOIN` idempotent |
| רשתות שונות / NAT | מצוין באותו wifi; ברשתות שונות ייתכן כשל למיעוט — המחיר של 0$ |
| הברוקר למטה | משחק רץ לא מושפע. רק הצטרפות |
| המארח מציץ ב-devtools | התקבל במודע |

---

## 13. בדיקות

| # | בדיקה | קובץ |
|---|---|---|
| 1 | **כל 142 טסטי `src/game/` עוברים בלי נגיעה** | קיימים |
| 2 | אי-הדלפה: לכל `phase × שחקן`, ה-JSON לא מכיל מילה סודית/`hintWord` של אחרים/זהות מתחזה | `view.test.ts` |
| 3 | **אי-הבחנה חזקה:** ב-HIDDEN, view של מתחזה ואזרח **deep-equal** אחרי איפוס `you`/`reveal`/`voteTargets`/`waiting.youDone`/`yourChoice`/`youVoted` בלבד. כל הפרש אחר = כישלון | `view.test.ts` |
| 4 | שקילות: משחק דרך ה-driver מול `testUtils`, אותו seed → `GameState` זהה | `driver.test.ts` |
| 5 | ספים: רוב/פה-אחד, כולל **אחרי הדחות** ו-`VOTE_RESULT`/`GAME_OVER` עם מודחים | `driver.test.ts` |
| 6 | `epoch`: כוונה עם key ישן נדחית; **כוונה מהמשחק הקודם אחרי `NEW_ROUND` נדחית** | `driver.test.ts` |
| 7 | אימות: לא-תורן, מת (למעט המנחש), יעד לא כשיר, טקסט ריק/ארוך, הצבעה כפולה | `driver.test.ts` |
| 8 | **`IMPOSTER_GUESS`: המנחש המת רשאי** והמשחק מסתיים | `driver.test.ts` |
| 9 | קיפול טרנזקציוני: אצווה שנכשלת לא משנה `state` ולא `revealViews` | `driver.test.ts` |
| 10 | `pending` בלבד מקדם `version` ולא `epoch` → מונה חי בלי לפסול כוונות | `driver.test.ts` |
| 11 | לובי: כל `JOIN` שעבר אימות שורד `START_GAME`. `nameKey`, ריק, ארוך, 13 | `room.test.ts` |
| 12 | `seatOrder`: שחזור מסשן ממפה נכון; אורך לא תואם → סירוב לשדר | `room.test.ts` |
| 13 | `npm run validate:words` · `tsc -b` · `npm run build` | CI |
| 14 | ידני: 3 מכשירים, שני מצבי רמזים, ניתוק, רענון מארח | — |

`vite.config.ts`: `include: ['src/game/**/*.test.ts']` → `['src/**/*.test.ts']`.

---

## 14. שלבי ביצוע

| שלב | תוכן | קריטריון סיום |
|---|---|---|
| **A** | חילוץ הגדרות · `SoloApp` · `App.tsx` · כפתור ב-SetupScreen | 142 טסטים ירוקים, סולו זהה |
| **B** | `protocol` · `room` · `view` · `driver` + בדיקות 2–12 | ירוק, בלי שורת רשת |
| **C** | `peer` · `useHost` · `useGuest` · לובי | 3 מכשירים נפגשים |
| **D** | מסכי המשחק, שני מצבי הרמזים | משחק שלם |
| **E** | עקיפות · ניתוקים · Wake Lock · טיימרים · ליטוש | עמיד |

---

## 15. מה מוותרים עליו במודע

- המארח יכול לרמות דרך devtools.
- המשחק תלוי בטלפון המארח שיישאר בחזית.
- כפילות UI — מחיר אפס-סיכון למשחק הקיים.
- אין מסך משותף/צופה. אין TURN.

---

## 16. מה השתנה אחרי הביקורת

| # | ממצא | התיקון |
|---|---|---|
| 1 | 🔴 המארח כתב את משחק האונליין למפתח של הסולו — חסם התחלה, ובהפעלה הבאה חשף את המתחזה | המארח לא משתמש ב-`useGame` כלל. Room משלו, מפתח משלו |
| 2 | 🔴 `pending` כ-ref לא הפעיל שידור — כל המונים החיים היו מתים | `version` נפרד שעולה על כל שינוי ומפעיל שידור |
| 3 | 🔴 `syncKey` נגזר התנגש אחרי `NEW_ROUND` — כוונה מהמשחק הקודם התקבלה | `epoch` מונוטוני |
| 4 | 🔴 `stateRef` מפגר אחרי `dispatch` — כוונות באותו tick התקבלו על מצב ישן | driver סינכרוני סמכותי; React רק מצייר |
| 5 | 🔴 השמעה לא טרנזקציונית — כשל באמצע השאיר `revealViews: 2` והקפיא phase | קיפול ב-`try`, הכל-או-כלום |
| 6 | 🔴 המנחש ב-`IMPOSTER_GUESS` מת → נדחה → משחק תקוע ללא מוצא | הרשאה per-phase; `GUESS_FOR` למארח |
| 7 | 🔴 השוואת שמות נאיבית → `START_GAME` זורק והחדר מת | `nameKey` + `MAX_PLAYERS` + ריק + אורך |
| 8 | 🔴 רענון מארח איבד את מיפוי המושבים → שחקנים קיבלו כרטיסי חשיפה של אחרים | `seatOrder` קפוא, נשמר, ונאכף לפני שידור |
| 9 | 🟠 רוב לפי חיים בלבד שלל זכות ממודחים ב-`VOTE_RESULT`/`GAME_OVER` | ציבור = כל השחקנים בשני ה-phases |
| 10 | 🟠 `DISCUSSION` נתקע בתיקו זוגי | fallback ל-`START_VOTING`; `FORCE_CHOICE` עם ארגומנט |
| 11 | 🟠 אורח שחוזר לא קיבל `VIEW` עד השינוי הבא | שידור מיידי על כל פתיחת ערוץ |
| 12 | 🟠 חתימת ה-driver לא יכלה לייצר seed/deadline — בדיקה 4 לא ישימה | `env: {seed, now}` מוזרק |
| 13 | 🟠 StrictMode שובר את מחזור החיים של PeerJS | singleton + teardown דחוי + `JOIN` idempotent |
| 14 | 🟠 רענון מארח היה מחליף קוד ומנתק את כולם | ניסיונות על אותו קוד ≥45s |
| 15 | 🟠 ⌂ של המארח שידר `phase:'SETUP'` והפיל מסכים | "סגירת חדר" ייעודית; ⌂ בסולו נשאר כמו היום |
| 16 | 🟠 Wake Lock לא מספיק ב-iOS | התאוששות ב-`visibilitychange` + `peer.reconnect()` + אזהרה |
| 17 | 🟡 אין דרך לדלג לדיון ב-SPEAK | `SKIP_CLUES` ברוב |
| 18 | 🟡 `guessOptions` ערבב ids ומילים | `{id, word}[]` |
| 19 | 🟡 בדיקת אי-ההבחנה הייתה חלשה מדי | deep-equal עם איפוס ממוקד |
| 20 | 🟡 `REJECTED` בלי מזהה | מחזיר `key` + `on`; `STALE` שקט |
| 21 | 🟡 `useFreshBuild` לא חובר לאונליין | בלובי וב-`JoinScreen`; מסך `BAD_VERSION` |
| 22 | ⚪ `hostConnected` טאוטולוגי | הוסר |
| 23 | ⚪ `waiting` וה-triple השטוח שכפלו זה את זה | אוחדו |
| 24 | ⚪ שני טאבים נלחמו על מושב | ראו 17.2 — הוחלף בהשתלטות על המושב |

---

## 17. מה השתנה אחרי ה-QA

בדיקת QA יריבה על הקוד שנכתב, לא על התוכנית. שני ממצאים קריטיים, ושניהם
נגרמים מאירועים רגילים — טלפון שמת, טאב שנטען מחדש — ולא מניסיון לשבור.

| # | ממצא | התיקון |
|---|---|---|
| 1 | 🔴 **`IMPOSTER_GUESS` היה phase ללא מוצא.** המנחש הוא היחיד שרשאי לפעול; אם הטלפון שלו מת, `FORCE_ADVANCE` נדחה, `GUESS_FOR` לא היה נגיש משום UI, ו-`stuck` לא נדלק. גרוע מזה: כפתור המארח נרנדר רק כשיש עקיפות, ו"סגירת החדר" יושב **בתוך** הגיליון שהוא פותח — אז למארח לא הייתה שום שליטה על המסך, ורענון היה מחזיר אותו לאותו מסך מת למשך 6 שעות | `FORCE_ADVANCE` מטפל ב-`IMPOSTER_GUESS` כ**ויתור** (ניחוש שגוי מכוון — מי שלא נכח לא ניצל את ההזדמנות); כפתור המארח מרונדר תמיד; `blockedOnDisconnected` בודק את המנחש |
| 2 | 🔴 **אורח שהתחבר מחדש מהר מדי סולק מהמשחק לצמיתות.** ה-backoff מתחיל אחרי שנייה, אבל המארח מגלה שהערוץ הישן מת רק כשה-ICE נגמר — כמה שניות. בחלון הזה כל `JOIN` עם `seatId` קיבל `SEAT_TAKEN`, וה-guest התייחס לזה כסופי | המושב עובר לערוץ החדש גם אם הישן נראה חי. `SEAT_TAKEN` הוסר לגמרי, ורק סירוב שהשחקן יכול לפעול לגביו עוצר את ה-backoff |
| 3 | 🟠 סירוב אחד הצמיד באנר אדום לשאר המשחק | `reason` מתאפס בכל `VIEW`, והצבעה כפולה נבלעת בשקט במקום להידחות |
| 4 | 🟠 "לדלג על התור" סיים את כל הסבב במצב הקלדה | במצב הקלדה נרשם `—` לשחקן והתור מתקדם |
| 5 | 🟠 לאורח לא הייתה יציאה אחרי שהמשחק התחיל | `LeaveButton` בפינה ש-`ScreenHeader` כבר שומרת |
| 6 | 🟠 עצם פתיחת הלובי חטפה כל הפעלה עתידית של האפליקציה | לא נשמר סשן עד שהחדר משמעותי (מצטרף ראשון או התחלה) |
| 7 | 🟠 הגדרות הלובי אבדו ברענון | נשמרות גם על שינוי הגדרות |
| 8 | 🟠 `setSettings` עקף את הקיצוץ — הלובי הבטיח 2 מתחזים ורץ עם 1 | קיצוץ ב-`setSettings` וגם כששחקן עוזב |
| 9 | 🟠 **בדיקת ה-runoff לא הריצה ולו assertion אחד** — פיצול הקולות לא היה תיקו, ה-`if` היה false, וכל הגוף דולג | 2–2 אמיתי, בלי `if`, ועוד בדיקה לתיקו כפול |
| 10 | 🟡 שלוש פקודות מארח לא היו נגישות משום UI | `VOTE_FOR`/`CLUE_FOR` הוסרו לטובת נתיבים נגישים; `GUESS_FOR` קופל ל-`FORCE_ADVANCE` |
| 11 | 🟡 `FORCE_ADVANCE` בהצבעה בחר יעד שרירותי | הקולות החסרים מצטרפים למי שהחדר כבר נוטה אליו |
| 12 | 🟡 `blockedOnDisconnected` נדלק בסבב רמזים תקין ולא נדלק כשצריך | לפי phase: רק התורן, רק המנחש |
| 13 | 🟡 בקשות "לדלג לדיון" נמחקו בכל תור | דלי משלהן, ששורד עד סוף הסבב |
| 14 | 🟡 `joinHost` הדליף Peer בכל חיבור מחדש | ה-peer הישן נהרס לפני ההחלפה |
| 15 | 🟡 קוד 4 ספרות מתנגש גלובלית על ברוקר משותף | 6 ספרות — 900 אלף במקום 9,000 |
| 16 | 🟡 מושבי רפאים אחרי רענון מארח | `DROP_SEAT` — כפתור הסרה בלובי |
| 17 | 🟡 `JoinScreen` קיבל prop של שגיאה שאיש לא העביר | הסיבה נישאת ב-`Role` |
| 18 | 🟡 האורח לא ראה באילו הגדרות הוא עומד לשחק | שורת סיכום בלובי |
| 19 | ⚪ עברית ביחיד-זכר במסך הניחוש | לרבים, כמו בכל שאר המסכים |
| 20 | ⚪ באנר החיבור כיסה את כפתור המארח | z-index ל-`HostStrip` |
| 21 | ⚪ `seatOrderIsSound` — האינווריאנט שמונע חלוקת כרטיסים לא נכונים — לא נבדק כלל | `room.test.ts`, 16 בדיקות |
| 22 | ⚪ סריקת ההדלפה כיסתה רק משחק אחד של 5 שחקנים | 2 מתחזים, KNOWN, runoff, סבב שני — 4 משחקים מלאים |
