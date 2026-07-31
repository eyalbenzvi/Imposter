import type { ReactNode } from 'react';

/**
 * The "pass the phone to X" interstitial. Used before every private screen —
 * reveal, typed clue, vote — so the flow always looks the same and nobody
 * glimpses the previous player's screen.
 */
export function PassDevice({
  name,
  hint,
  cta,
  onContinue,
  progress,
  children,
}: {
  name: string;
  hint?: string;
  cta?: string;
  onContinue: () => void;
  progress?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 w-full flex-1 animate-rise-in flex-col items-center justify-center gap-6 text-center">
      {progress && <div className="text-sm text-slate-400">{progress}</div>}

      <div className="flex flex-col items-center gap-2">
        <p className="text-lg text-slate-400">העבירו את המכשיר ל</p>
        <p
          className="niqqud font-display font-bold text-glow-soft"
          style={{ fontSize: 'clamp(2.2rem, 11vw, 3.6rem)' }}
        >
          {name}
        </p>
      </div>

      <div
        aria-hidden
        className="h-24 w-24 animate-pulse-ring rounded-full border border-glow/40 bg-glow/10"
        style={{ animationDelay: '150ms' }}
      />

      {hint && <p className="max-w-[24ch] text-sm text-slate-400">{hint}</p>}
      {children}

      <button type="button" onClick={onContinue} className="btn-primary w-full max-w-sm">
        {cta ?? `אני ${name}`}
      </button>
    </div>
  );
}
