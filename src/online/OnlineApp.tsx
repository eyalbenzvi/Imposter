import { useCallback, useEffect, useState } from 'react';
import { Screen, ScreenBody, ScreenFooter } from '../ui/components/Screen';
import { useFreshBuild } from '../ui/useFreshBuild';
import { ConnectionBanner } from './components/ConnectionBanner';
import { HostStrip } from './components/HostStrip';
import { LeaveButton } from './components/LeaveButton';
import { OnlineGame } from './OnlineGame';
import { GuestLobbyScreen } from './screens/GuestLobbyScreen';
import { HostLobbyScreen } from './screens/HostLobbyScreen';
import { JoinScreen } from './screens/JoinScreen';
import {
  clearGuestSession,
  clearHostSession,
  clearJoinCode,
  loadGuestSession,
  loadHostSession,
  readJoinCode,
} from './storage';
import { useGuest } from './useGuest';
import { useHost } from './useHost';

type Role =
  | { kind: 'PICK' }
  | { kind: 'JOIN'; code: string | null; error?: string | null }
  | { kind: 'GUEST'; code: string; name: string }
  | { kind: 'HOST'; name: string };

function initialRole(): Role {
  const joinCode = readJoinCode();
  if (joinCode) {
    const saved = loadGuestSession(joinCode);
    return saved
      ? { kind: 'GUEST', code: joinCode, name: saved.name }
      : { kind: 'JOIN', code: joinCode };
  }
  // A host who refreshed mid-game must land back on the room, not the picker.
  const hosting = loadHostSession();
  if (hosting) {
    const hostSeat = hosting.seats[0];
    if (hostSeat) return { kind: 'HOST', name: hostSeat.name };
  }
  const guesting = loadGuestSession();
  if (guesting) return { kind: 'GUEST', code: guesting.code, name: guesting.name };
  return { kind: 'PICK' };
}

export default function OnlineApp({ onExit }: { onExit: () => void }) {
  const [role, setRole] = useState<Role>(initialRole);

  // The link has done its job; leaving it in the bar would re-enter the join
  // flow on every reload, and it would get bookmarked and shared onward.
  useEffect(() => {
    if (role.kind !== 'JOIN' && role.kind !== 'PICK') clearJoinCode();
  }, [role.kind]);

  const leave = useCallback(() => {
    clearGuestSession();
    clearHostSession();
    clearJoinCode();
    onExit();
  }, [onExit]);

  switch (role.kind) {
    case 'PICK':
      return <RolePicker onPick={setRole} onExit={onExit} />;
    case 'JOIN':
      return (
        <JoinScreen
          initialCode={role.code}
          error={role.error}
          onJoin={(code, name) => setRole({ kind: 'GUEST', code, name })}
          onBack={() => setRole({ kind: 'PICK' })}
        />
      );
    case 'HOST':
      return <HostSide name={role.name} onExit={leave} />;
    case 'GUEST':
      return (
        <GuestSide
          code={role.code}
          name={role.name}
          onExit={leave}
          onRejoin={(why) => setRole({ kind: 'JOIN', code: role.code, error: why })}
        />
      );
  }
}

// ── picking a side ───────────────────────────────────────────────────────────

function RolePicker({
  onPick,
  onExit,
}: {
  onPick: (role: Role) => void;
  onExit: () => void;
}) {
  const [name, setName] = useState('');
  const build = useFreshBuild(true);

  return (
    <>
      <Screen scrollable>
        <header className="shrink-0 pb-4 pt-6 text-center">
          <h1
            className="niqqud font-display font-black tracking-tight text-slate-50"
            style={{ fontSize: 'clamp(2.2rem, 12vw, 3.2rem)' }}
          >
            מִתְחַזֶּה
          </h1>
          <p className="pt-1 text-sm text-slate-400">כל אחד בטלפון שלו</p>
        </header>

        {/* Flow layout, not `ScreenBody` — see the note in `JoinScreen`. */}
        <div className="flex flex-col gap-5 pb-4">
          <div className="w-full">
            <label
              htmlFor="host-name"
              className="block pb-2 text-base font-bold text-slate-200"
            >
              השם שלכם
            </label>
            <input
              id="host-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={14}
              autoComplete="off"
              placeholder="איך קוראים לכם?"
              className="niqqud w-full rounded-2xl border-2 border-ink-600 bg-ink-850 px-4 py-4
                text-center font-display text-2xl text-slate-50 outline-none transition
                placeholder:text-slate-600 focus:border-glow focus:bg-ink-800"
            />
          </div>

          <button
            type="button"
            disabled={name.trim().length === 0}
            onClick={() => onPick({ kind: 'HOST', name: name.trim() })}
            className="btn-primary w-full text-xl"
          >
            פתחו חדר חדש
          </button>

          <div className="flex w-full items-center gap-3 text-xs text-slate-600">
            <span className="h-px flex-1 bg-ink-700" />
            או
            <span className="h-px flex-1 bg-ink-700" />
          </div>

          <button
            type="button"
            onClick={() => onPick({ kind: 'JOIN', code: null })}
            className="btn-ghost w-full text-lg"
          >
            הצטרפו לחדר קיים
          </button>
        </div>

        <ScreenFooter>
          <button type="button" onClick={onExit} className="btn-ghost w-full">
            חזרה למשחק במכשיר אחד
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

// ── host ─────────────────────────────────────────────────────────────────────

function HostSide({ name, onExit }: { name: string; onExit: () => void }) {
  const host = useHost(name);
  const build = useFreshBuild(host.phase === 'SETUP');

  const close = useCallback(() => {
    host.closeRoom();
    onExit();
  }, [host, onExit]);

  if (host.phase === 'SETUP') {
    return (
      <>
        <HostLobbyScreen host={host} onExit={close} />
        {build.stale && (
          <ConnectionBanner action={{ label: 'רענון', onClick: build.reload }}>
            יש גרסה חדשה של המשחק
          </ConnectionBanner>
        )}
      </>
    );
  }

  // `ERROR` belongs here too, not only a missing view: the room failed to open
  // at all, so whatever is on screen is a game nobody else is in.
  if (!host.view || host.status === 'ERROR') {
    return (
      <Screen>
        <ScreenBody>
          <p className="text-center text-base text-danger">
            {host.error ?? 'משהו השתבש בחדר'}
          </p>
          <button type="button" onClick={close} className="btn-ghost w-full">
            סגירת החדר
          </button>
        </ScreenBody>
      </Screen>
    );
  }

  return (
    <>
      <OnlineGame view={host.view} send={host.act} />
      <HostStrip
        view={host.view}
        stuck={host.stuck}
        onCommand={host.command}
        onClose={close}
      />
      {/*
        Only DEGRADED, and worded for what it actually is. The players already
        in the room are connected directly to this phone and are entirely
        unaffected — it is the *room code* that has stopped being routable. The
        old banner fired on OPENING too, so every host saw "the connection to
        the room was lost" for the first second of a perfectly healthy game.
      */}
      {host.status === 'DEGRADED' && (
        <ConnectionBanner tone="warn">
          אין חיבור לשירות החדרים — המשחק ממשיך כרגיל, אבל אי אפשר לצרף שחקנים חדשים
        </ConnectionBanner>
      )}
    </>
  );
}

// ── guest ────────────────────────────────────────────────────────────────────

function GuestSide({
  code,
  name,
  onExit,
  onRejoin,
}: {
  code: string;
  name: string;
  onExit: () => void;
  onRejoin: (why: string | null) => void;
}) {
  const guest = useGuest(code, name);
  // Every way out of this screen goes through here, so the host is always told
  // and the peer is always torn down.
  const quit = useCallback(() => {
    guest.leave();
    onExit();
  }, [guest, onExit]);
  const build = useFreshBuild(guest.view === null || guest.view.phase === 'SETUP');

  if (guest.status === 'REJECTED') {
    return (
      <Screen>
        <ScreenBody>
          <p
            className="niqqud text-center font-display font-black text-slate-50"
            style={{ fontSize: 'clamp(1.6rem, 8vw, 2.2rem)' }}
          >
            לא הצלחנו להיכנס
          </p>
          <p className="max-w-[28ch] text-center text-base leading-relaxed text-slate-400">
            {guest.message}
          </p>
        </ScreenBody>
        <ScreenFooter>
          {guest.reason === 'BAD_VERSION' ? (
            <button
              type="button"
              onClick={build.reload}
              className="btn-primary w-full text-xl"
            >
              רעננו לגרסה החדשה
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onRejoin(guest.message)}
              className="btn-primary w-full text-xl"
            >
              נסו קוד או שם אחר
            </button>
          )}
          <button type="button" onClick={quit} className="btn-ghost w-full">
            חזרה למשחק במכשיר אחד
          </button>
        </ScreenFooter>
      </Screen>
    );
  }

  if (guest.status === 'CLOSED') {
    return (
      <Screen>
        <ScreenBody>
          <p
            className="niqqud text-center font-display font-black text-slate-50"
            style={{ fontSize: 'clamp(1.6rem, 8vw, 2.2rem)' }}
          >
            החדר נסגר
          </p>
          <p className="max-w-[28ch] text-center text-base leading-relaxed text-slate-400">
            המארח סיים את המשחק
          </p>
        </ScreenBody>
        <ScreenFooter>
          <button type="button" onClick={quit} className="btn-primary w-full text-xl">
            חזרה
          </button>
        </ScreenFooter>
      </Screen>
    );
  }

  /**
   * Could not get through.
   *
   * This screen is the whole reason the guest side counts its attempts. A
   * saved session is what sends the app straight into the online mode on
   * launch, so a phone that once joined a room keeps re-dialling it — and with
   * nothing but a "connecting…" line and a status banner sitting on top of the
   * cancel button, there was no way out at all short of clearing site data.
   */
  if (guest.status === 'UNREACHABLE') {
    const noRoom = guest.failure === 'NO_ROOM';
    return (
      <Screen scrollable>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
          <p
            className="niqqud font-display font-black text-slate-50"
            style={{ fontSize: 'clamp(1.6rem, 8vw, 2.2rem)' }}
          >
            {noRoom ? 'אין חדר עם הקוד הזה' : 'לא הצלחנו להתחבר'}
          </p>
          <p className="max-w-[30ch] text-base leading-relaxed text-slate-400">
            {noRoom
              ? `אף אחד לא מחזיק חדר עם הקוד ${code}. ייתכן שהמארח סגר אותו, או שיש טעות בקוד.`
              : 'החיבור לא נוצר. בדקו שיש רשת, ושהמארח עדיין עם המשחק פתוח על המסך.'}
          </p>
        </div>

        <ScreenFooter>
          <button
            type="button"
            onClick={guest.retry}
            className="btn-primary w-full text-xl"
          >
            לנסות שוב
          </button>
          <button
            type="button"
            onClick={() => onRejoin(null)}
            className="btn-ghost w-full"
          >
            להזין קוד אחר
          </button>
          <button type="button" onClick={quit} className="btn-ghost w-full">
            חזרה למשחק במכשיר אחד
          </button>
        </ScreenFooter>
      </Screen>
    );
  }

  /**
   * Still trying. The status lives in the body rather than in a fixed banner:
   * a banner pinned to the bottom of the screen covered the only button on it.
   */
  if (!guest.view) {
    const reconnecting = guest.status === 'RECONNECTING';
    return (
      <Screen scrollable>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
          <p className="text-base text-slate-300">
            {reconnecting ? 'החיבור אבד — מתחברים מחדש' : 'מתחברים לחדר'}
          </p>
          <p dir="ltr" className="num font-display text-3xl tabular-nums text-slate-100">
            {code}
          </p>
          <p className="max-w-[28ch] pt-1 text-sm leading-relaxed text-slate-500">
            המשחק רץ מהמכשיר של המארח — הוא צריך להיות פתוח על המסך
          </p>
        </div>
        <ScreenFooter>
          <button type="button" onClick={quit} className="btn-ghost w-full">
            ביטול
          </button>
        </ScreenFooter>
      </Screen>
    );
  }

  return (
    <>
      {guest.view.phase === 'SETUP' ? (
        <GuestLobbyScreen
          view={guest.view}
          onLeave={quit}
          onRename={guest.rename}
          renameError={guest.message}
        />
      ) : (
        <>
          <OnlineGame view={guest.view} send={guest.send} />
          <LeaveButton onLeave={quit} />
        </>
      )}
      {guest.status === 'RECONNECTING' && (
        <ConnectionBanner tone="bad">החיבור אבד — מתחברים מחדש</ConnectionBanner>
      )}
      {guest.message && guest.status === 'PLAYING' && (
        <ConnectionBanner tone="bad">{guest.message}</ConnectionBanner>
      )}
    </>
  );
}
