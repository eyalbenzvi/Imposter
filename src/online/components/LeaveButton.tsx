import { useState } from 'react';

/**
 * A guest's way out of a running game.
 *
 * Every screen header already reserves this corner (`pe-14` in `ScreenHeader`),
 * because the single-device game puts its home button there. Online it was left
 * empty, which meant that once the first view arrived a guest had no exit at
 * all: a player whose host had wandered off sat on "reconnecting" forever, and
 * anyone who simply wanted to stop had to close the tab.
 */
export function LeaveButton({ onLeave }: { onLeave: () => void }) {
  const [asking, setAsking] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-label="יציאה מהחדר"
        className="fixed z-40 grid h-11 w-11 place-items-center rounded-xl border
          border-ink-700 bg-ink-900/80 text-lg text-slate-400 backdrop-blur
          transition active:scale-95 hover:border-danger/60 hover:text-danger"
        style={{
          // Logical inset: the end side is the left in an RTL document.
          insetInlineEnd: 'max(0.75rem, env(safe-area-inset-right))',
          top: 'max(0.75rem, env(safe-area-inset-top))',
        }}
      >
        ⌂
      </button>

      {asking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/85 p-6 backdrop-blur-sm">
          <div className="card w-full max-w-sm animate-rise-in text-center">
            <p className="pb-1 text-lg font-bold text-slate-100">לצאת מהחדר?</p>
            <p className="pb-5 text-sm leading-relaxed text-slate-400">
              תצאו מהמשחק והשאר ימשיכו בלעדיכם. אפשר לחזור עם אותו קוד.
            </p>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={onLeave} className="btn-danger w-full">
                כן, לצאת
              </button>
              <button
                type="button"
                onClick={() => setAsking(false)}
                className="btn-ghost w-full"
              >
                לא, ממשיכים לשחק
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
