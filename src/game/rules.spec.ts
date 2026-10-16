import { describe, expect, it } from 'vitest';
import { assignRoles, defaultRoles, factionForRole, questFailThreshold, roleKnowledge } from './rules';
import { GameEngine } from './engine';

const players = (count: number) => Array.from({ length: count }, (_, seat) => ({ id: `p${seat}`, nickname: `Player ${seat}`, seat, connected: true, ready: true }));

describe('Avalon rules', () => {
  it.each([5, 6, 7, 8, 9, 10])('creates a valid distribution for %i players', (count) => {
    const roles = defaultRoles(count);
    expect(roles).toHaveLength(count);
    expect(roles.filter((role) => factionForRole(role) === 'GOOD')).toHaveLength(count === 5 ? 3 : count <= 7 ? 4 : count <= 9 ? count - 3 : 6);
    expect(roles.filter((role) => role === 'MERLIN')).toHaveLength(1);
    expect(roles.filter((role) => role === 'ASSASSIN')).toHaveLength(1);
  });
  it('requires two fails only on quest four for 7–10 players', () => {
    expect(questFailThreshold(7, 3)).toBe(2); expect(questFailThreshold(10, 3)).toBe(2);
    expect(questFailThreshold(7, 2)).toBe(1); expect(questFailThreshold(6, 3)).toBe(1);
  });
  it('keeps Mordred hidden from Merlin and Oberon hidden from evil', () => {
    const assignments = assignRoles(['merlin', 'good1', 'good2', 'good3', 'assassin', 'mordred', 'oberon'], ['MERLIN', 'LOYAL_SERVANT', 'LOYAL_SERVANT', 'LOYAL_SERVANT', 'ASSASSIN', 'MORDRED', 'OBERON'], () => 0.999);
    const merlin = assignments.find((item) => item.role === 'MERLIN')!;
    expect(roleKnowledge(merlin, assignments).map((item) => item.playerId)).not.toContain(assignments.find((item) => item.role === 'MORDRED')!.playerId);
    const assassin = assignments.find((item) => item.role === 'ASSASSIN')!;
    expect(roleKnowledge(assassin, assignments).map((item) => item.playerId)).not.toContain(assignments.find((item) => item.role === 'OBERON')!.playerId);
  });
});

describe('Game engine', () => {
  it('blocks Good players from submitting Fail', () => {
    const engine = new GameEngine(); const state = engine.start(players(5));
    state.phase = 'QUEST_SUBMISSION'; state.proposedTeam = [state.assignments.find((item) => item.faction === 'GOOD')!.playerId];
    expect(() => engine.submitQuest(state, state.proposedTeam[0], 'FAIL')).toThrow('GOOD_CANNOT_FAIL');
  });
  it('rejects ties', () => {
    const engine = new GameEngine(); const state = engine.start(players(6)); state.phase = 'TEAM_VOTING';
    players(6).forEach((player, index) => engine.submitApproval(state, player.id, index < 3));
    expect(state.phase).toBe('VOTE_RESULT'); expect(state.rejectionCount).toBe(1);
  });
  it('uses explicit timeout votes', () => {
    const engine = new GameEngine(); const state = engine.start(players(5), undefined, 0); state.phase = 'TEAM_VOTING'; state.timer = { status: 'RUNNING', phaseStartedAt: 0, phaseDeadlineAt: 1, remainingDuration: 1, pausedAt: null, extensionCount: 0 };
    engine.expire(state, 2); expect(state.approvalVotes).toHaveLength(5); expect(state.approvalVotes.every((vote) => vote.automatic && !vote.approve)).toBe(true);
  });
  it('resolves rejected vote display timeout through leader rotation', () => {
    const engine = new GameEngine(); const state = engine.start(players(5), undefined, 0); const initialLeader = state.leaderSeat;
    state.phase = 'VOTE_RESULT'; state.approvalVotes = players(5).map((player) => ({ playerId: player.id, approve: false })); state.timer = { status: 'RUNNING', phaseStartedAt: 0, phaseDeadlineAt: 1, remainingDuration: 1, pausedAt: null, extensionCount: 0 };
    engine.expire(state, 2); expect(state.phase).toBe('TEAM_SELECTION'); expect(state.leaderSeat).toBe((initialLeader + 1) % 5);
  });
  it('enters assassination after the third successful quest result', () => {
    const engine = new GameEngine(); const state = engine.start(players(5), undefined, 0);
    state.phase = 'QUEST_RESULT'; state.goodScore = 3; state.timer = { status: 'RUNNING', phaseStartedAt: 0, phaseDeadlineAt: 1, remainingDuration: 1, pausedAt: null, extensionCount: 0 };
    engine.expire(state, 2); expect(state.phase).toBe('ASSASSINATION_DISCUSSION'); expect(state.winner).toBeUndefined();
  });
});
