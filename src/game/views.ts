import { GameState } from './types';

export function publicGameState(state: GameState, connections = new Map<string, boolean>()) {
  const { assignments: _assignments, questVotes: _questVotes, acknowledgedPlayerIds: _acknowledged, ...publicState } = state;
  return {
    ...publicState,
    players: state.players.map((player) => ({ ...player, connected: connections.get(player.id) ?? player.connected })),
    approvalVotes: state.phase === 'TEAM_VOTING'
      ? state.approvalVotes.map(() => ({ submitted: true as const }))
      : state.approvalVotes,
  };
}
