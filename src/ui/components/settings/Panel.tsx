import { useState, type ReactNode } from 'react';
import type { Settings } from '../../../game/types';

/**
 * The setup form's building blocks, shared by the single-device setup screen and
 * the online lobby. Moved here verbatim from `SetupScreen` so the two modes can
 * never drift into offering different settings.
 */

/**
 * A setup card that folds down to its title. Collapsed, the summary keeps the
 * chosen value visible so nothing has to be opened just to check it.
 */
export function Panel({
  title,
  summary,
  defaultOpen = false,
  bodyClassName = '',
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 text-start"
      >
        <h2 className="text-base font-bold text-slate-200">{title}</h2>
        <span className="flex shrink-0 items-center gap-2">
          {summary && <span className="num text-sm text-slate-400">{summary}</span>}
          <span
            aria-hidden
            className={`text-xs text-slate-500 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          >
            ▾
          </span>
        </span>
      </button>
      {open && <div className={`pt-4 ${bodyClassName}`}>{children}</div>}
    </section>
  );
}

export function Field({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 pb-2">
        <span className="text-base font-bold text-slate-200">{label}</span>
        {note && <span className="text-xs text-slate-500">{note}</span>}
      </div>
      {children}
    </div>
  );
}

export function Toggle({
  label,
  note,
  on,
  onChange,
}: {
  label: string;
  note: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-[44px] items-center justify-between gap-4 text-start"
    >
      <span className="min-w-0">
        <span className="block text-base font-bold text-slate-200">{label}</span>
        <span className="block pt-0.5 text-xs leading-relaxed text-slate-500">
          {note}
        </span>
      </span>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          on ? 'bg-glow' : 'bg-ink-700'
        }`}
      >
        {/* RTL: the knob travels toward the start edge when switched on. */}
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-ink-950 transition-all ${
            on ? 'end-1' : 'end-6'
          }`}
        />
      </span>
    </button>
  );
}

/**
 * Every settings panel takes the same three things, so the setup screen (which
 * keeps its settings in the reducer) and the lobby (which keeps them in local
 * state until the game starts) can render the identical controls.
 */
export type SettingsPanelProps = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** How many players the group currently has — caps the imposter count. */
  playerCount: number;
};
