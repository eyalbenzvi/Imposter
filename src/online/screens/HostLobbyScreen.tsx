import { useState } from 'react';
import { MIN_PLAYERS } from '../../game/types';
import { Screen, ScreenFooter } from '../../ui/components/Screen';
import { CategoriesPanel } from '../../ui/components/settings/CategoriesPanel';
import { ModePanel } from '../../ui/components/settings/ModePanel';
import { Panel } from '../../ui/components/settings/Panel';
import { RulesPanel } from '../../ui/components/settings/RulesPanel';
import type { Host } from '../useHost';
import { shareUrl } from '../storage';

export function HostLobbyScreen({
  host,
  onExit,
}: {
  host: Host;
  onExit: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const code = host.code;
  const enough = host.seats.length >= MIN_PLAYERS;

  const panelProps = {
    settings: host.settings,
    onChange: host.setSettings,
    playerCount: host.seats.length,
  };

  const share = async (): Promise<void> => {
    if (!code) return;
    const url = shareUrl(code);
    const text = `בואו לשחק מתחזה! הקוד הוא ${code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'מתחזה', text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // A cancelled share sheet is not a failure.
    }
  };

  return (
    <Screen scrollable>
      <header className="shrink-0 pb-3 pt-3 text-center">
        <h1
          className="niqqud font-display font-black tracking-tight text-slate-50"
          style={{ fontSize: 'clamp(1.9rem, 10vw, 2.8rem)' }}
        >
          מִתְחַזֶּה
        </h1>
        <p className="pt-0.5 text-xs text-slate-500">כל אחד בטלפון שלו</p>
      </header>

      <div className="flex flex-col gap-4 pb-2">
        {/* ── the code ────────────────────────────────────────────────── */}
        <section className="card text-center">
          {host.status === 'OPENING' && (
            <p className="py-6 text-base text-slate-400">פותחים חדר…</p>
          )}

          {host.status === 'ERROR' && (
            <div className="py-4">
              <p className="pb-3 text-base leading-relaxed text-danger">
                {host.error ?? 'לא הצלחנו לפתוח חדר'}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="btn-ghost w-full"
              >
                לנסות שוב
              </button>
            </div>
          )}

          {host.status === 'OPEN' && code && (
            <>
              <p className="text-xs font-semibold tracking-[0.04em] text-glow/70">
                קוד החדר
              </p>
              <p
                dir="ltr"
                className="num pt-1 font-display font-black tabular-nums tracking-[0.12em] text-slate-50"
                style={{ fontSize: 'clamp(2.2rem, 14vw, 3.6rem)' }}
              >
                {code}
              </p>
              <p className="pb-4 pt-1 text-sm leading-relaxed text-slate-400">
                כל שחקן פותח את המשחק בטלפון שלו ומקליד את הקוד
              </p>
              <button type="button" onClick={() => void share()} className="btn-ghost w-full">
                {copied ? 'הקישור הועתק ✓' : 'שתפו קישור הצטרפות'}
              </button>
            </>
          )}
        </section>

        {/* The host device runs the game. Say so once, plainly. */}
        <p className="rounded-2xl border border-gold/30 bg-gold/[0.06] px-4 py-3 text-center text-xs leading-relaxed text-gold/90">
          המשחק רץ מהמכשיר הזה — השאירו אותו פתוח על המסך של המשחק לאורך כל
          הסבב
        </p>

        {/* ── who's here ──────────────────────────────────────────────── */}
        <Panel title="מי כבר כאן" summary={`${host.seats.length} / 12`} defaultOpen>
          <ul className="flex flex-col gap-2">
            {host.seats.map((seat, index) => (
              <li
                key={seat.seatId}
                className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-850/50 px-3 py-2"
              >
                <span className="w-5 shrink-0 text-center text-sm tabular-nums text-slate-500">
                  {index + 1}
                </span>
                <span className="niqqud min-w-0 flex-1 truncate text-lg text-slate-100">
                  {seat.name}
                </span>
                {seat.isHost && (
                  <span className="shrink-0 rounded-full bg-glow/20 px-2 py-0.5 text-xs font-semibold text-glow-soft">
                    מארח
                  </span>
                )}
                {!seat.isHost && seat.connId === null && (
                  <>
                    <span className="shrink-0 text-xs text-gold">מנותק</span>
                    {/* A host who refreshed gets every seat back, including
                        players who have gone home. Frozen into the roster they
                        become real players, and the reveal — which waits for
                        everyone — can then only be cleared by an override. */}
                    <button
                      type="button"
                      onClick={() => host.command({ t: 'DROP_SEAT', seatId: seat.seatId })}
                      aria-label={`הסירו את ${seat.name}`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg
                        border border-ink-700 text-slate-500 transition active:scale-95
                        hover:border-danger/60 hover:text-danger"
                    >
                      ×
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!enough && (
            <p className="pt-3 text-sm text-gold">
              צריך לפחות {MIN_PLAYERS} שחקנים כדי להתחיל
            </p>
          )}
        </Panel>

        <ModePanel {...panelProps} />
        <CategoriesPanel {...panelProps} />
        <RulesPanel {...panelProps} />
      </div>

      <ScreenFooter>
        {host.error && host.status === 'OPEN' && (
          <p className="text-center text-sm text-danger">{host.error}</p>
        )}
        <button
          type="button"
          disabled={!enough || host.status !== 'OPEN'}
          onClick={host.start}
          className="btn-primary w-full text-xl"
        >
          התחילו לשחק
        </button>
        <button type="button" onClick={onExit} className="btn-ghost w-full">
          חזרה למשחק במכשיר אחד
        </button>
      </ScreenFooter>
    </Screen>
  );
}
