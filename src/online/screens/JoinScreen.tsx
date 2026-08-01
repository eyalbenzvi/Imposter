import { useState } from 'react';
import { Screen, ScreenBody, ScreenFooter, ScreenHeader } from '../../ui/components/Screen';
import { MAX_NAME_LENGTH } from '../protocol';

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

  const codeOk = /^\d{4}$/.test(code);
  const nameOk = name.trim().length > 0;

  return (
    <Screen scrollable>
      <ScreenHeader eyebrow="כל אחד בטלפון שלו" title="הצטרפות לחדר" />

      <ScreenBody className="justify-start gap-6 pt-4">
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
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="1234"
            enterKeyHint="next"
            className="num w-full rounded-2xl border-2 border-ink-600 bg-ink-850 px-4 py-4
              text-center font-display text-4xl tabular-nums tracking-[0.3em] text-slate-50
              outline-none transition placeholder:text-slate-700 focus:border-glow focus:bg-ink-800"
          />
          <p className="pt-2 text-xs text-slate-500">
            ארבע ספרות, מהמכשיר שפתח את החדר
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
      </ScreenBody>

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
  );
}
