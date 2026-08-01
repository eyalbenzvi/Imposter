import type { Waiting } from '../view';

/**
 * The single most important component in the online mode.
 *
 * Multi-device play lives or dies on dead time: a player who has done their bit
 * and sees nothing looks up from the phone and the round loses them. Every
 * screen therefore has an audience state, and this is it — always saying what
 * the room is waiting for, how far along it is, and where possible on whom.
 */
export function WaitingPanel({
  waiting,
  label,
}: {
  waiting: Waiting;
  /** Overrides the default wording when a phase needs something specific. */
  label?: string;
}) {
  const text = label ?? DEFAULT_LABEL[waiting.kind];
  const ratio = waiting.needed > 0 ? Math.min(1, waiting.done / waiting.needed) : 0;

  return (
    <div className="w-full animate-rise-in rounded-2xl border border-ink-700 bg-ink-850/60 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-slate-300">{text}</p>
        <p className="num shrink-0 text-sm font-bold tabular-nums text-glow-soft">
          {waiting.done} / {waiting.needed}
        </p>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full bg-glow transition-[width] duration-300"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>

      {waiting.names.length > 0 && (
        <p className="niqqud pt-2 text-xs leading-relaxed text-slate-500">
          {waiting.names.join(' · ')}
        </p>
      )}
    </div>
  );
}

const DEFAULT_LABEL: Record<Waiting['kind'], string> = {
  REVEAL: 'מחכים שכולם יראו את המילה שלהם',
  CLUE: 'מחכים לרמזים',
  VOTE: 'מחכים שכולם יצביעו',
  READY: 'מחכים שכולם יהיו מוכנים',
  CHOOSE: 'מחכים להחלטה של הקבוצה',
};
