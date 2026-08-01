import { useEffect, useRef, useState } from 'react';
import { Screen, ScreenFooter } from '../components/Screen';
import { MAX_PLAYERS, MIN_PLAYERS, type Settings } from '../../game/types';
import { duplicateNameIndexes } from '../../game/rules';
import { CategoriesPanel } from '../components/settings/CategoriesPanel';
import { ModePanel } from '../components/settings/ModePanel';
import { Panel } from '../components/settings/Panel';
import { RulesPanel } from '../components/settings/RulesPanel';
import type { Game } from '../useGame';

export function SetupScreen({
  game,
  onGoOnline,
}: {
  game: Game;
  /** Switch to the mode where everyone plays from their own phone. */
  onGoOnline?: () => void;
}) {
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
  // Same helper the reducer refuses to start on, so the button and the rule
  // can't disagree about which rosters are legal.
  const repeats = new Set(duplicateNameIndexes(names));
  const namesUnique = repeats.size === 0;
  const canStart = enoughPlayers && allNamed && namesUnique;

  const set = (patch: Partial<Settings>) => dispatch({ type: 'UPDATE_SETTINGS', patch });
  const panelProps = {
    settings: state.settings,
    onChange: set,
    playerCount: names.length,
  };

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
      </header>

      <div className="flex flex-col gap-4 pb-2">
        {/* ── how you're playing ──────────────────────────────────────── */}
        {onGoOnline && (
          <button
            type="button"
            onClick={onGoOnline}
            className="flex items-center justify-between gap-3 rounded-2xl border
              border-glow/40 bg-glow/[0.07] px-4 py-3 text-start transition
              active:scale-[0.99] hover:border-glow/70"
          >
            <span className="min-w-0">
              <span className="block text-base font-bold text-glow-soft">
                כל אחד בטלפון שלו
              </span>
              <span className="block pt-0.5 text-xs leading-relaxed text-slate-400">
                בלי להעביר מכשיר — כולם מתחברים לאותו חדר. דרוש חיבור לרשת
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-xl text-glow">
              ‹
            </span>
          </button>
        )}

        {/* ── players ─────────────────────────────────────────────────── */}
        <Panel
          title="שחקנים"
          summary={`${names.length} / ${MAX_PLAYERS}`}
          defaultOpen
        >
          <ul className="flex flex-col gap-2">
            {names.map((name, index) => {
              const repeated = repeats.has(index);
              return (
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
                  aria-invalid={repeated || undefined}
                  aria-errormessage={repeated ? 'duplicate-names' : undefined}
                  className={`niqqud min-h-[48px] w-full rounded-xl border bg-ink-850 px-3 text-lg text-slate-100 outline-none transition placeholder:text-slate-600 focus:bg-ink-800 ${
                    repeated
                      ? 'border-danger focus:border-danger'
                      : 'border-ink-600 focus:border-glow'
                  }`}
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
              );
            })}
          </ul>

          {!namesUnique && (
            <p id="duplicate-names" className="pt-2 text-sm text-danger">
              לכל שחקן צריך שם אחר — יש שם שחוזר פעמיים
            </p>
          )}

          <button
            type="button"
            onClick={addPlayer}
            disabled={names.length >= MAX_PLAYERS}
            className="btn-ghost mt-3 w-full"
          >
            + הוסף שחקן
          </button>
        </Panel>

        <ModePanel {...panelProps} />
        <CategoriesPanel {...panelProps} />
        <RulesPanel {...panelProps} />
      </div>

      <ScreenFooter>
        {!canStart && (
          <p className="text-center text-sm text-gold">
            {!enoughPlayers
              ? `צריך לפחות ${MIN_PLAYERS} שחקנים`
              : !allNamed
                ? 'מלאו שם לכל שחקן'
                : 'לכל שחקן צריך שם אחר'}
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
