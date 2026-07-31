import { formatClock, type Timer } from '../useTimer';

/**
 * A visible countdown the host controls. It never advances the game — when it
 * hits zero it just says so.
 */
export function TimerBar({ timer, total }: { timer: Timer; total: number }) {
  if (timer.remaining === null) return null;

  const ratio = total > 0 ? timer.remaining / total : 0;
  const urgent = timer.remaining <= 10 && timer.remaining > 0;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={timer.toggle}
        className="flex w-full min-h-[44px] items-center justify-between gap-3 rounded-2xl border border-ink-700 bg-ink-850/70 px-4 py-2 text-start active:scale-[0.99]"
      >
        <span className="text-sm text-slate-400">
          {timer.expired ? 'הזמן נגמר' : timer.running ? 'עצור' : 'המשך'}
        </span>
        <span
          className={`font-display text-2xl font-bold tabular-nums ${
            timer.expired ? 'text-danger' : urgent ? 'text-gold' : 'text-slate-100'
          }`}
        >
          {formatClock(timer.remaining)}
        </span>
      </button>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-linear ${
            timer.expired ? 'bg-danger' : urgent ? 'bg-gold' : 'bg-glow'
          }`}
          style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
        />
      </div>
    </div>
  );
}
