import { useState } from 'react';
import { Screen, ScreenFooter, ScreenHeader } from '../../ui/components/Screen';
import { useFreshBuild } from '../../ui/useFreshBuild';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH } from '../protocol';

/**
 * Code, then name. A shared link fills the code in and lands straight on the
 * name, which is the whole reason the link exists.
 */
export function JoinScreen({
  initialCode,
  onJoin,
  onBack,
  error,
}: {
  initialCode: string | null;
  onJoin: (code: string, name: string) => void;
  onBack: () => void;
  error?: string | null;
}) {
  const [code, setCode] = useState(initialCode ?? '');
  const [name, setName] = useState('');
  // A host on an older build turns newer guests away, and the guest is the one
  // staring at the dead end — so offer the reload here.
  const build = useFreshBuild(true);

  const codeOk = new RegExp(`^\\d{${ROOM_CODE_LENGTH}}$`).test(code);
  const nameOk = name.trim().length > 0;

  return (
    <>
    <Screen scrollable>
      <ScreenHeader eyebrow="כל אחד בטלפון שלו" title="הצטרפות לחדר" />

      {/* A plain flow container, not `ScreenBody`. `ScreenBody` is `flex-1`
          with no overflow of its own, which is right for a fixed-height game
          screen and wrong for a form: when the phone keyboard halves the
          viewport its content spills over the footer, and the buttons end up
          drawn on top of the inputs. */}
      <div className="flex flex-col gap-6 pb-4 pt-4">
        <div className="w-full">
          <label
            htmlFor="room-code"
            className="block pb-2 text-base font-bold text-slate-200"
          >
            קוד החדר
          </label>
          <input
            id="room-code"
            dir="ltr"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH))
            }
            inputMode="numeric"
            autoComplete="off"
            placeholder="123456"
            enterKeyHint="next"
            className="num w-full rounded-2xl border-2 border-ink-600 bg-ink-850 px-4 py-4
              text-center font-display text-4xl tabular-nums tracking-[0.18em] text-slate-50
              outline-none transition placeholder:text-slate-700 focus:border-glow focus:bg-ink-800"
          />
          <p className="pt-2 text-xs text-slate-500">
            {ROOM_CODE_LENGTH} ספרות, מהמכשיר שפתח את החדר
          </p>
        </div>

        <div className="w-full">
          <label
            htmlFor="player-name"
            className="block pb-2 text-base font-bold text-slate-200"
          >
            השם שלכם
          </label>
          <input
            id="player-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && codeOk && nameOk) onJoin(code, name.trim());
            }}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            placeholder="איך קוראים לכם?"
            enterKeyHint="done"
            className="niqqud w-full rounded-2xl border-2 border-ink-600 bg-ink-850 px-4 py-4
              text-center font-display text-2xl text-slate-50 outline-none transition
              placeholder:text-slate-600 focus:border-glow focus:bg-ink-800"
          />
          <p className="pt-2 text-xs text-slate-500">
            השם שיופיע לכולם. צריך להיות שונה מכל שם אחר בחדר
          </p>
        </div>

        {error && (
          <p className="w-full rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-center text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <ScreenFooter>
        <button
          type="button"
          disabled={!codeOk || !nameOk}
          onClick={() => onJoin(code, name.trim())}
          className="btn-primary w-full text-xl"
        >
          הצטרפו למשחק
        </button>
        <button type="button" onClick={onBack} className="btn-ghost w-full">
          חזרה
        </button>
      </ScreenFooter>
    </Screen>
    {build.stale && (
      <ConnectionBanner action={{ label: 'רענון', onClick: build.reload }}>
        יש גרסה חדשה של המשחק
      </ConnectionBanner>
    )}
    </>
  );
}
