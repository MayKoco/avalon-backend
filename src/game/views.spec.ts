import { describe, expect, it } from 'vitest';
import { GameEngine } from './engine';
import { factionForRole } from './rules';
import { phases, Role } from './types';
import { publicGameState } from './views';

const roles: Role[] = ['MERLIN', 'PERCIVAL', 'LOYAL_SERVANT', 'ASSASSIN', 'MORGANA', 'MORDRED', 'OBERON', 'MINION_OF_MORDRED'];
const players = roles.map((_role, seat) => ({ id: `p${seat}`, nickname: `Player ${seat}`, seat, connected: true, ready: true }));
const playerIdFor = (role: Role) => players[roles.indexOf(role)].id;

describe('secret data views', () => {
  it.each(roles)('returns only the correct private knowledge for %s', (role) => {
    const engine = new GameEngine(() => 0.999);
    const state = engine.start(players);
    state.assignments = roles.map((assignedRole) => ({ playerId: playerIdFor(assignedRole), role: assignedRole, faction: factionForRole(assignedRole) }));
    const view = engine.privateInfo(state, playerIdFor(role));
    const visibleRoles = view.knowledge.map((item) => state.assignments.find((assignment) => assignment.playerId === item.playerId)!.role).sort();

    expect(view.assignment).toEqual(state.assignments.find((assignment) => assignment.role === role));
    expect(view.knowledge.every((item) => Object.keys(item).sort().join(',') === 'appearsAs,playerId')).toBe(true);
    if (role === 'MERLIN') expect(visibleRoles).toEqual(['ASSASSIN', 'MINION_OF_MORDRED', 'MORGANA', 'OBERON'].sort());
    else if (role === 'PERCIVAL') expect(visibleRoles).toEqual(['MERLIN', 'MORGANA'].sort());
    else if (['ASSASSIN', 'MORGANA', 'MORDRED', 'MINION_OF_MORDRED'].includes(role)) {
      const expected = ['ASSASSIN', 'MORGANA', 'MORDRED', 'MINION_OF_MORDRED'].filter((item) => item !== role).sort();
      expect(visibleRoles).toEqual(expected);
    } else expect(view.knowledge).toEqual([]);
  });

  it.each(phases.filter((phase) => phase !== 'LOBBY'))('never exposes roles or quest submissions in %s', (phase) => {
    const engine = new GameEngine(() => 0.999);
    const state = engine.start(players);
    state.phase = phase;
    state.acknowledgedPlayerIds = [players[0].id];
    state.questVotes = [{ playerId: players[0].id, outcome: 'FAIL' }];
    state.approvalVotes = [{ playerId: players[0].id, approve: false }];
    const view = publicGameState(state);
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain('assignments');
    expect(serialized).not.toContain('questVotes');
    expect(serialized).not.toContain('acknowledgedPlayerIds');
    expect(view.players.every((player) => !('role' in player) && !('faction' in player))).toBe(true);
    if (phase === 'TEAM_VOTING') expect(view.approvalVotes).toEqual([{ submitted: true }]);
  });
});
