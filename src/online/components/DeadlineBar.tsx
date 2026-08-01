import { useEffect, useState } from 'react';
import { formatClock } from '../../ui/useTimer';
import type { PlayerView } from '../view';

/**
 * A countdown every phone agrees on.
 *
 * The host owns the clock and sends an absolute deadline. Phones disagree about
 * what time it is — usually by a second, occasionally by a lot — so every view
 * also carries the host's clock at send time, and each guest corrects for the
 * difference. Without that, one player's timer can read 0:00 while another's
 * still shows a minute.
 *
 * Like the single-device timer, this never advances the game. It only says the
 * time is up.
 */
export function useDeadline(view: PlayerView): number | null {
  const { deadlineAt, serverNow } = view;
  // Positive when this phone's clock runs behind the host's.
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setOffset(serverNow - Date.now());
  }, [serverNow]);

  useEffect(() => {
    if (deadlineAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadlineAt]);

  if (deadlineAt === null) return null;
  return Math.max(0, Math.ceil((deadlineAt - (now + offset)) / 1000));
}

export function DeadlineBar({ view, total }: { view: PlayerView; total: number }) {
  const remaining = useDeadline(view);
  if (remaining === null || total <= 0) return null;

  const ratio = Math.max(0, Math.min(1, remaining / total));
  const urgent = remaining <= 10 && remaining > 0;
  const expired = remaining === 0;

  return (
    <div className="w-full">
      <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-2xl border border-ink-700 bg-ink-850/70 px-4 py-2">
        <span className="text-sm text-slate-400">
          {expired ? 'הזמן נגמר' : 'זמן שנותר'}
        </span>
        <span
          className={`font-display text-2xl font-bold tabular-nums ${
            expired ? 'text-danger' : urgent ? 'text-gold' : 'text-slate-100'
          }`}
        >
          {formatClock(remaining)}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-linear ${
            expired ? 'bg-danger' : urgent ? 'bg-gold' : 'bg-glow'
          }`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
