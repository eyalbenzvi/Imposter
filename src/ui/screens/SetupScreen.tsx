import { useEffect, useRef, useState } from 'react';
import { Screen, ScreenFooter } from '../components/Screen';
import { MAX_PLAYERS, MIN_PLAYERS, type Settings } from '../../game/types';
import { maxImposterCount, suggestImposterCount } from '../../game/rules';
import type { Game } from '../useGame';

const MODE_CARDS = [
  {
    value: 'HIDDEN' as const,
    title: 'סמוי',
    tag: 'מומלץ',
    body: 'כולם רואים מסך זהה. המתחזה מקבל מילה אחרת — ולא יודע שהוא המתחזה.',
  },
  {
    value: 'KNOWN' as const,
    title: 'גלוי',
    tag: null,
    body: 'המתחזה יודע שהוא המתחזה, ומקבל מילה קרובה כדי להשתלב.',
  },
];

const TIMER_OPTIONS = [
  { value: 0, label: 'ללא' },
  { value: 60, label: '60' },
  { value: 90, label: '90' },
  { value: 120, label: '120' },
] as const;

export function SetupScreen({ game }: { game: Game }) {
  const { state, dispatch, dispatchSeeded } = game;
  const [names, setNames] = useState<string[]>(() =>
    state.players.length >= MIN_PLAYERS
      ? state.players.map((p) => p.name)
      : [...state.players.map((p) => p.name), '', '', ''].slice(0, MIN_PLAYERS),
  );
  const focusLast = useRef(false);
  const lastInput = useRef<HTMLInputElement | null>(null);

  // The reducer owns the roster; local state is only the in-progress typing.
  useEffect(() => {
    dispatch({ type: 'SET_PLAYERS', names });
  }, [names, dispatch]);

  useEffect(() => {
    if (focusLast.current) {
      focusLast.current = false;
      lastInput.current?.focus();
    }
  }, [names.length]);

  const filled = names.map((n) => n.trim()).filter((n) => n.length > 0);
  const enoughPlayers = names.length >= MIN_PLAYERS;
  const allNamed = filled.length === names.length;
  const canStart = enoughPlayers && allNamed;
  const cap = maxImposterCount(names.length);
  const suggestion = suggestImposterCount(names.length);

  const set = (patch: Partial<Settings>) => dispatch({ type: 'UPDATE_SETTINGS', patch });

  const addPlayer = () => {
    if (names.length >= MAX_PLAYERS) return;
    focusLast.current = true;
    setNames((prev) => {
      const next = [...prev, ''];
      // Offer 2 imposters once the group gets big, without forcing it.
      if (next.length === 7 && state.settings.imposterCount === 1) {
        set({ imposterCount: 2 });
      }
      return next;
    });
  };

  const removePlayer = (index: number) =>
    setNames((prev) =>
      prev.length <= MIN_PLAYERS ? prev : prev.filter((_, i) => i !== index),
    );

  const rename = (index: number, value: string) =>
    setNames((prev) => prev.map((n, i) => (i === index ? value : n)));

  return (
    <Screen scrollable>
      <header className="shrink-0 pb-4 pt-3 text-center">
        <h1
          className="niqqud font-display font-black tracking-tight text-slate-50"
          style={{ fontSize: 'clamp(2.4rem, 13vw, 3.6rem)' }}
        >
          מִתְחַזֶּה
        </h1>
        <p className="pt-1 text-sm text-slate-400">
          מכשיר אחד, {MIN_PLAYERS}–{MAX_PLAYERS} שחקנים, מילה אחת שלא כולם קיבלו
        </p>
      </header>

      <div className="flex flex-col gap-4 pb-2">
        {/* ── players ─────────────────────────────────────────────────── */}
        <section className="card">
          <div className="flex items-baseline justify-between pb-3">
            <h2 className="text-base font-bold text-slate-200">שחקנים</h2>
            <span className="num text-sm text-slate-400">
              {names.length} / {MAX_PLAYERS}
            </span>
          </div>

          <ul className="flex flex-col gap-2">
            {names.map((name, index) => (
              <li key={index} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center text-sm tabular-nums text-slate-500">
                  {index + 1}
                </span>
                <input
                  ref={index === names.length - 1 ? lastInput : null}
                  value={name}
                  onChange={(e) => rename(index, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addPlayer();
                    }
                  }}
                  placeholder={`שחקן ${index + 1}`}
                  maxLength={14}
                  enterKeyHint={index === names.length - 1 ? 'done' : 'next'}
                  autoComplete="off"
                  className="niqqud min-h-[48px] w-full rounded-xl border border-ink-600 bg-ink-850 px-3 text-lg text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-glow focus:bg-ink-800"
                />
                <button
                  type="button"
                  onClick={() => removePlayer(index)}
                  disabled={names.length <= MIN_PLAYERS}
                  aria-label={`הסר את שחקן ${index + 1}`}
                  className="grid h-[48px] w-[48px] shrink-0 place-items-center rounded-xl border border-ink-700 text-xl text-slate-500 transition active:scale-95 disabled:opacity-30 enabled:hover:border-danger/60 enabled:hover:text-danger"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={addPlayer}
            disabled={names.length >= MAX_PLAYERS}
            className="btn-ghost mt-3 w-full"
          >
            + הוסף שחקן
          </button>
        </section>

        {/* ── game mode ───────────────────────────────────────────────── */}
        <section className="card">
          <h2 className="pb-1 text-base font-bold text-slate-200">מצב משחק</h2>
          <p className="pb-3 text-sm text-slate-400">
            מה המתחזה יודע על עצמו בתחילת המשחק
          </p>
          <div className="grid gap-2">
            {MODE_CARDS.map((card) => {
              const active = state.settings.mode === card.value;
              return (
                <button
                  key={card.value}
                  type="button"
                  onClick={() => set({ mode: card.value })}
                  aria-pressed={active}
                  className={`rounded-2xl border p-4 text-start transition active:scale-[0.99] ${
                    active
                      ? 'border-glow bg-glow/10'
                      : 'border-ink-600 bg-ink-850/50 hover:border-glow/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                        active ? 'border-glow bg-glow' : 'border-ink-600'
                      }`}
                    >
                      {active && <span className="h-2 w-2 rounded-full bg-ink-950" />}
                    </span>
                    <span className="text-lg font-bold text-slate-100">{card.title}</span>
                    {card.tag && (
                      <span className="rounded-full bg-glow/20 px-2 py-0.5 text-xs font-semibold text-glow-soft">
                        {card.tag}
                      </span>
                    )}
                  </div>
                  <p className="pt-2 text-sm leading-relaxed text-slate-400">
                    {card.body}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── settings ────────────────────────────────────────────────── */}
        <section className="card flex flex-col gap-5">
          <Field
            label="מספר מתחזים"
            note={
              cap === 1
                ? 'בקבוצה הזאת אפשר מתחזה אחד בלבד'
                : suggestion === 2
                  ? 'בקבוצה הזאת מומלצים 2'
                  : undefined
            }
          >
            <div className="flex gap-2">
              {[1, 2].map((count) => (
                <button
                  key={count}
                  type="button"
                  disabled={count > cap}
                  onClick={() => set({ imposterCount: count })}
                  className={`flex-1 ${
                    state.settings.imposterCount === count ? 'chip-on' : 'chip-off'
                  } disabled:pointer-events-none disabled:opacity-30`}
                >
                  {count}
                </button>
              ))}
            </div>
          </Field>

          <Field
            label="סבב הרמזים"
            note={
              state.settings.clueMode === 'SPEAK'
                ? 'האפליקציה מנהלת את סדר התורות, אתם מדברים'
                : 'כל שחקן מקליד רמז, ובסוף הסבב הכול על לוח אחד'
            }
          >
            <div className="flex gap-2">
              {(
                [
                  ['SPEAK', 'דיבור'],
                  ['TYPE', 'הקלדה'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set({ clueMode: value })}
                  className={`flex-1 ${
                    state.settings.clueMode === value ? 'chip-on' : 'chip-off'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="טיימר דיון" note="שניות">
            <div className="flex gap-2">
              {TIMER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => set({ discussionSeconds: option.value })}
                  className={`flex-1 ${
                    state.settings.discussionSeconds === option.value
                      ? 'chip-on'
                      : 'chip-off'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="טיימר לכל תור רמז" note="שניות">
            <div className="flex gap-2">
              {[0, 15, 30].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set({ clueTimerSeconds: value })}
                  className={`flex-1 ${
                    state.settings.clueTimerSeconds === value ? 'chip-on' : 'chip-off'
                  }`}
                >
                  {value === 0 ? 'ללא' : value}
                </button>
              ))}
            </div>
          </Field>

          <Toggle
            label="ניחוש אחרון למתחזה"
            note="מתחזה שנתפס מקבל הזדמנות אחת לנחש את המילה מתוך 4"
            on={state.settings.imposterGuessEnabled}
            onChange={(on) => set({ imposterGuessEnabled: on })}
          />
        </section>
      </div>

      <ScreenFooter>
        {!canStart && (
          <p className="text-center text-sm text-gold">
            {!enoughPlayers
              ? `צריך לפחות ${MIN_PLAYERS} שחקנים`
              : 'מלאו שם לכל שחקן'}
          </p>
        )}
        <button
          type="button"
          disabled={!canStart}
          onClick={() => dispatchSeeded('START_GAME')}
          className="btn-primary w-full text-xl"
        >
          התחילו לשחק
        </button>
      </ScreenFooter>
    </Screen>
  );
}

function Field({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
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

function Toggle({
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
