import { OnlineCluesScreen } from './screens/OnlineCluesScreen';
import { OnlineDiscussionScreen } from './screens/OnlineDiscussionScreen';
import { OnlineGameOverScreen } from './screens/OnlineGameOverScreen';
import { OnlineGuessScreen } from './screens/OnlineGuessScreen';
import { OnlineRevealScreen } from './screens/OnlineRevealScreen';
import { OnlineVoteResultScreen } from './screens/OnlineVoteResultScreen';
import { OnlineVotingScreen } from './screens/OnlineVotingScreen';
import type { GameScreenProps } from './screens/props';

/**
 * One screen per phase, driven entirely by the projection.
 *
 * SETUP never reaches here — the lobby handles it — but the union includes it,
 * so it renders nothing rather than falling off the end of the switch.
 */
export function OnlineGame({ view, send }: GameScreenProps) {
  switch (view.phase) {
    case 'REVEAL':
      return <OnlineRevealScreen view={view} send={send} />;
    case 'CLUES':
      return <OnlineCluesScreen view={view} send={send} />;
    case 'DISCUSSION':
      return <OnlineDiscussionScreen view={view} send={send} />;
    case 'VOTING':
      return <OnlineVotingScreen view={view} send={send} />;
    case 'VOTE_RESULT':
      return <OnlineVoteResultScreen view={view} send={send} />;
    case 'IMPOSTER_GUESS':
      return <OnlineGuessScreen view={view} send={send} />;
    case 'GAME_OVER':
      return <OnlineGameOverScreen view={view} send={send} />;
    case 'SETUP':
      return null;
  }
}
