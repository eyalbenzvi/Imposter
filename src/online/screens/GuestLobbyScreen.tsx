import { Screen, ScreenBody, ScreenFooter, ScreenHeader } from '../../ui/components/Screen';
import type { PlayerView } from '../view';

export function GuestLobbyScreen({
  view,
  onLeave,
}: {
  view: PlayerView;
  onLeave: () => void;
}) {
  const lobby = view.lobby;
  if (!lobby) return null;

  return (
    <Screen scrollable>
      <ScreenHeader eyebrow={`חדר ${lobby.code}`} title="מחכים למארח" />

      <ScreenBody className="justify-start gap-5 pt-2">
        <p className="text-center text-base leading-relaxed text-slate-400">
          אתם בפנים. {lobby.hostName} יתחיל את המשחק כשכולם יגיעו
        </p>

        <ul className="flex w-full flex-col gap-2">
          {lobby.names.map((name, index) => (
            <li
              key={`${name}-${index}`}
              className={`flex animate-rise-in items-center gap-3 rounded-xl border px-3 py-2 ${
                name === view.you.name
                  ? 'border-glow/50 bg-glow/[0.08]'
                  : 'border-ink-700 bg-ink-850/50'
              }`}
            >
              <span className="w-5 shrink-0 text-center text-sm tabular-nums text-slate-500">
                {index + 1}
              </span>
              <span className="niqqud min-w-0 flex-1 truncate text-lg text-slate-100">
                {name}
              </span>
              {index === 0 && (
                <span className="shrink-0 rounded-full bg-glow/20 px-2 py-0.5 text-xs font-semibold text-glow-soft">
                  מארח
                </span>
              )}
            </li>
          ))}
        </ul>
      </ScreenBody>

      <ScreenFooter>
        <button type="button" onClick={onLeave} className="btn-ghost w-full">
          יציאה מהחדר
        </button>
      </ScreenFooter>
    </Screen>
  );
}
