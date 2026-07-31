import { CluesScreen } from './ui/screens/CluesScreen';
import { DiscussionScreen } from './ui/screens/DiscussionScreen';
import { GameOverScreen } from './ui/screens/GameOverScreen';
import { ImposterGuessScreen } from './ui/screens/ImposterGuessScreen';
import { RevealScreen } from './ui/screens/RevealScreen';
import { SetupScreen } from './ui/screens/SetupScreen';
import { VoteResultScreen } from './ui/screens/VoteResultScreen';
import { VotingScreen } from './ui/screens/VotingScreen';
import { HomeButton } from './ui/components/HomeButton';
import { useGame } from './ui/useGame';

/**
 * One screen per phase, and nothing else. All game logic lives behind
 * `dispatch` — this file only decides what to render.
 */
export default function App() {
  const game = useGame();

  const screen = (() => {
    switch (game.state.phase) {
      case 'SETUP':
        return <SetupScreen game={game} />;
      case 'REVEAL':
        return <RevealScreen game={game} />;
      case 'CLUES':
        return <CluesScreen game={game} />;
      case 'DISCUSSION':
        return <DiscussionScreen game={game} />;
      case 'VOTING':
        return <VotingScreen game={game} />;
      case 'VOTE_RESULT':
        return <VoteResultScreen game={game} />;
      case 'IMPOSTER_GUESS':
        return <ImposterGuessScreen game={game} />;
      case 'GAME_OVER':
        return <GameOverScreen game={game} />;
    }
  })();

  return (
    <>
      {screen}
      {/* One fixed control, same spot on every screen of a running game. */}
      {game.state.phase !== 'SETUP' && <HomeButton game={game} />}
      {game.error && (
        <div
          role="alert"
          className="fixed inset-x-3 z-50 animate-rise-in rounded-2xl border border-danger/50 bg-ink-900/95 px-4 py-3 shadow-2xl backdrop-blur"
          style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <p className="text-sm text-slate-200">משהו לא עבד — הפעולה בוטלה</p>
          <button
            type="button"
            onClick={game.clearError}
            className="pt-1 text-xs text-glow-soft underline"
          >
            הבנתי
          </button>
        </div>
      )}
    </>
  );
}
