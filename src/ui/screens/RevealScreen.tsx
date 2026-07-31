import { getRevealView } from '../../game/rules';
import { PassDevice } from '../components/PassDevice';
import { RevealCard } from '../components/RevealCard';
import { Screen } from '../components/Screen';
import type { Game } from '../useGame';

/**
 * Role handout. Strictly one-way: there is no back button and no second look,
 * by design — a player only ever sees their own screen, once.
 */
export function RevealScreen({ game }: { game: Game }) {
  const { state, dispatch } = game;
  const player = state.players[state.revealIndex];
  if (!player) return null;

  return (
    <Screen>
      {state.revealShown ? (
        <RevealCard
          // Remounting per player resets the dwell timer identically for all.
          key={player.id}
          view={getRevealView(state, player.id)}
          position={state.revealIndex + 1}
          total={state.players.length}
          onHide={() => dispatch({ type: 'HIDE_ROLE' })}
        />
      ) : (
        <PassDevice
          key={player.id}
          name={player.name}
          hint="ודאו שאף אחד אחר לא רואה את המסך"
          cta="גלה את המילה שלי"
          progress={`${state.revealIndex + 1} / ${state.players.length}`}
          onContinue={() => dispatch({ type: 'SHOW_ROLE' })}
        />
      )}
    </Screen>
  );
}
