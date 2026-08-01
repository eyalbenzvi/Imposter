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

        <ScreenBody className="justify-start gap-5">
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
        </ScreenBody>

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

  if (!host.view) {
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
      {host.status !== 'OPEN' && (
        <ConnectionBanner tone="bad">
          החיבור לחדר אבד — השאירו את המשחק פתוח על המסך
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

  const banner =
    guest.status === 'CONNECTING' ? (
      <ConnectionBanner>מתחברים לחדר {code}…</ConnectionBanner>
    ) : guest.status === 'RECONNECTING' ? (
      <ConnectionBanner tone="bad">
        החיבור אבד — מנסים להתחבר מחדש
      </ConnectionBanner>
    ) : null;

  if (!guest.view) {
    return (
      <>
        <Screen>
          <ScreenBody>
            <p className="text-center text-base text-slate-400">
              מתחברים לחדר <span className="num tabular-nums">{code}</span>…
            </p>
          </ScreenBody>
          <ScreenFooter>
            <button type="button" onClick={quit} className="btn-ghost w-full">
              ביטול
            </button>
          </ScreenFooter>
        </Screen>
        {banner}
      </>
    );
  }

  return (
    <>
      {guest.view.phase === 'SETUP' ? (
        <GuestLobbyScreen
          view={guest.view}
          onLeave={() => {
            guest.leave();
            onExit();
          }}
        />
      ) : (
        <>
          <OnlineGame view={guest.view} send={guest.send} />
          <LeaveButton onLeave={quit} />
        </>
      )}
      {banner}
      {guest.message && guest.status === 'PLAYING' && (
        <ConnectionBanner tone="bad">{guest.message}</ConnectionBanner>
      )}
    </>
  );
}
