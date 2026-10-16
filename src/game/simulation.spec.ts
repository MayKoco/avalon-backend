import { describe, expect, it } from 'vitest';
import { GameEngine } from './engine';
import { QUEST_SIZES } from './rules';
import { GameState } from './types';

const players = (count: number) => Array.from({ length: count }, (_, seat) => ({
  id: `p${seat}`, nickname: `Player ${seat}`, seat, connected: true, ready: true,
}));

const engine = () => new GameEngine(() => 0.999999);

function expireCurrent(game: GameEngine, state: GameState) {
  expect(state.timer.phaseDeadlineAt).not.toBeNull();
  return game.expire(state, state.timer.phaseDeadlineAt!);
}

function enterTeamSelection(game: GameEngine, count: number) {
  const state = game.start(players(count), undefined, 0, false, 0);
  for (let index = 0; index < count; index++) game.acknowledge(state, `p${index}`, index + 1);
  expect(state.phase).toBe('OPENING_DISCUSSION');
  expireCurrent(game, state);
  expect(state.phase).toBe('TEAM_SELECTION');
  return state;
}

function assertStateIntegrity(state: GameState) {
  expect(new Set(state.players.map((player) => player.id)).size).toBe(state.players.length);
  expect(new Set(state.assignments.map((assignment) => assignment.playerId)).size).toBe(state.players.length);
  expect(state.goodScore + state.evilScore).toBe(state.quests.length);
  expect(state.questIndex).toBeGreaterThanOrEqual(0);
  expect(state.questIndex).toBeLessThan(5);
  expect(new Set(state.approvalVotes.map((vote) => vote.playerId)).size).toBe(state.approvalVotes.length);
  expect(new Set(state.questVotes.map((vote) => vote.playerId)).size).toBe(state.questVotes.length);
}

function runQuest(game: GameEngine, state: GameState, fail: boolean) {
  expect(state.phase).toBe('TEAM_SELECTION');
  const teamSize = QUEST_SIZES[state.players.length][state.questIndex];
  const evil = state.assignments.filter((assignment) => assignment.faction === 'EVIL').map((assignment) => assignment.playerId);
  const ordered = fail
    ? [...evil, ...state.players.map((player) => player.id).filter((id) => !evil.includes(id))]
    : state.players.map((player) => player.id);
  const team = ordered.slice(0, teamSize);
  const leader = state.players.find((player) => player.seat === state.leaderSeat)!;
  game.submitTeam(state, leader.id, team, false, state.timer.phaseStartedAt + 1);
  expireCurrent(game, state);
  expect(state.phase).toBe('TEAM_VOTING');
  for (let index = 0; index < state.players.length; index++) {
    game.submitApproval(state, state.players[index].id, true, false, state.timer.phaseStartedAt + index + 1);
  }
  expect(state.phase).toBe('VOTE_RESULT');
  expireCurrent(game, state);
  expect(state.phase).toBe('QUEST_SUBMISSION');
  const threshold = state.players.length >= 7 && state.questIndex === 3 ? 2 : 1;
  const failingIds = fail ? evil.filter((id) => team.includes(id)).slice(0, threshold) : [];
  expect(failingIds).toHaveLength(fail ? threshold : 0);
  for (let index = 0; index < team.length; index++) {
    game.submitQuest(state, team[index], failingIds.includes(team[index]) ? 'FAIL' : 'SUCCESS', false, state.timer.phaseStartedAt + index + 1);
  }
  expect(state.phase).toBe('QUEST_RESULT');
  assertStateIntegrity(state);
  expireCurrent(game, state);
  if (state.phase === 'ROUND_DISCUSSION') expireCurrent(game, state);
  assertStateIntegrity(state);
}

describe('complete deterministic games for every supported player count', () => {
  it.each([5, 6, 7, 8, 9, 10])('finishes with Evil after three failed quests (%i players)', (count) => {
    const game = engine();
    const state = enterTeamSelection(game, count);
    runQuest(game, state, true);
    runQuest(game, state, true);
    runQuest(game, state, true);
    expect(state.phase).toBe('GAME_OVER');
    expect(state.winner).toBe('EVIL');
    expect(state.evilScore).toBe(3);
  });

  it.each([5, 6, 7, 8, 9, 10])('finishes with Good when the assassin misses Merlin (%i players)', (count) => {
    const game = engine();
    const state = enterTeamSelection(game, count);
    runQuest(game, state, false);
    runQuest(game, state, false);
    runQuest(game, state, false);
    expect(state.phase).toBe('ASSASSINATION_DISCUSSION');
    expireCurrent(game, state);
    const assassin = state.assignments.find((assignment) => assignment.role === 'ASSASSIN')!;
    const merlin = state.assignments.find((assignment) => assignment.role === 'MERLIN')!;
    const wrongTarget = state.players.find((player) => player.id !== assassin.playerId && player.id !== merlin.playerId)!;
    game.assassinate(state, assassin.playerId, wrongTarget.id, false, state.timer.phaseStartedAt + 1);
    expect(state.phase).toBe('GAME_OVER');
    expect(state.winner).toBe('GOOD');
  });

  it.each([5, 6, 7, 8, 9, 10])('finishes with Evil when the assassin identifies Merlin (%i players)', (count) => {
    const game = engine();
    const state = enterTeamSelection(game, count);
    runQuest(game, state, false);
    runQuest(game, state, false);
    runQuest(game, state, false);
    expireCurrent(game, state);
    const assassin = state.assignments.find((assignment) => assignment.role === 'ASSASSIN')!;
    const merlin = state.assignments.find((assignment) => assignment.role === 'MERLIN')!;
    game.assassinate(state, assassin.playerId, merlin.playerId, false, state.timer.phaseStartedAt + 1);
    expect(state.phase).toBe('GAME_OVER');
    expect(state.winner).toBe('EVIL');
  });
});

describe('critical Avalon edge cases', () => {
  it('awards Evil the game after five rejected teams', () => {
    const game = engine();
    const state = enterTeamSelection(game, 10);
    for (let rejection = 1; rejection <= 5; rejection++) {
      const leader = state.players.find((player) => player.seat === state.leaderSeat)!;
      game.submitTeam(state, leader.id, state.players.slice(0, QUEST_SIZES[10][0]).map((player) => player.id), false, state.timer.phaseStartedAt + 1);
      expireCurrent(game, state);
      for (let index = 0; index < state.players.length; index++) {
        game.submitApproval(state, state.players[index].id, false, false, state.timer.phaseStartedAt + index + 1);
      }
      if (rejection < 5) {
        expect(state.phase).toBe('VOTE_RESULT');
        expect(state.rejectionCount).toBe(rejection);
        expireCurrent(game, state);
      }
    }
    expect(state.phase).toBe('GAME_OVER');
    expect(state.winner).toBe('EVIL');
    expect(state.rejectionCount).toBe(5);
  });

  it.each([7, 8, 9, 10])('requires two FAIL submissions on quest four (%i players)', (count) => {
    const makeQuestFour = () => {
      const game = engine();
      const state = enterTeamSelection(game, count);
      state.questIndex = 3;
      const evil = state.assignments.filter((assignment) => assignment.faction === 'EVIL').map((assignment) => assignment.playerId);
      const team = [...evil, ...state.players.map((player) => player.id).filter((id) => !evil.includes(id))].slice(0, QUEST_SIZES[count][3]);
      state.phase = 'QUEST_SUBMISSION';
      state.proposedTeam = team;
      state.questVotes = [];
      state.timer = { status: 'RUNNING', phaseStartedAt: 0, phaseDeadlineAt: 30_000, remainingDuration: 30_000, pausedAt: null, extensionCount: 0 };
      return { game, state, evil, team };
    };

    const oneFail = makeQuestFour();
    oneFail.team.forEach((id, index) => oneFail.game.submitQuest(oneFail.state, id, index === 0 ? 'FAIL' : 'SUCCESS', false, index + 1));
    expect(oneFail.state.quests.at(-1)).toMatchObject({ failThreshold: 2, failCount: 1, result: 'SUCCESS' });

    const twoFails = makeQuestFour();
    twoFails.team.forEach((id, index) => twoFails.game.submitQuest(twoFails.state, id, index < 2 ? 'FAIL' : 'SUCCESS', false, index + 1));
    expect(twoFails.state.quests.at(-1)).toMatchObject({ failThreshold: 2, failCount: 2, result: 'FAIL' });
  });

  it('applies deterministic timeout behavior in every timed phase', () => {
    const game = engine();
    const state = game.start(players(5), undefined, 0, false, 0);
    expireCurrent(game, state); expect(state.phase).toBe('OPENING_DISCUSSION');
    expireCurrent(game, state); expect(state.phase).toBe('TEAM_SELECTION');
    expireCurrent(game, state); expect(state.phase).toBe('TEAM_DISCUSSION'); expect(state.proposalAutomatic).toBe(true);
    expireCurrent(game, state); expect(state.phase).toBe('TEAM_VOTING');
    expireCurrent(game, state); expect(state.phase).toBe('VOTE_RESULT'); expect(state.approvalVotes.every((vote) => vote.automatic && !vote.approve)).toBe(true);
    expireCurrent(game, state); expect(state.phase).toBe('TEAM_SELECTION');

    state.phase = 'QUEST_SUBMISSION';
    state.proposedTeam = state.players.slice(0, 2).map((player) => player.id);
    state.questVotes = [];
    state.timer = { status: 'RUNNING', phaseStartedAt: 0, phaseDeadlineAt: 1, remainingDuration: 1, pausedAt: null, extensionCount: 0 };
    expireCurrent(game, state); expect(state.phase).toBe('QUEST_RESULT'); expect(state.questVotes.every((vote) => vote.automatic && vote.outcome === 'SUCCESS')).toBe(true);
    expireCurrent(game, state); expect(state.phase).toBe('ROUND_DISCUSSION');
    expireCurrent(game, state); expect(state.phase).toBe('TEAM_SELECTION');

    state.phase = 'QUEST_RESULT'; state.goodScore = 3;
    state.timer = { status: 'RUNNING', phaseStartedAt: 0, phaseDeadlineAt: 1, remainingDuration: 1, pausedAt: null, extensionCount: 0 };
    expireCurrent(game, state); expect(state.phase).toBe('ASSASSINATION_DISCUSSION');
    expireCurrent(game, state); expect(state.phase).toBe('ASSASSINATION_DECISION');
    expireCurrent(game, state); expect(state.phase).toBe('GAME_OVER'); expect(state.winner).toBeDefined();
  });

  it('freezes paused timers, extends running timers, and rejects actions at the deadline', () => {
    const game = engine();
    const state = enterTeamSelection(game, 5);
    const originalDeadline = state.timer.phaseDeadlineAt!;
    game.pause(state, state.timer.phaseStartedAt + 1_000);
    expect(game.expire(state, originalDeadline + 1)).toBe(state);
    expect(state.phase).toBe('TEAM_SELECTION');
    game.extend(state, 30, originalDeadline + 1);
    game.resume(state, originalDeadline + 2);
    expect(state.timer.phaseDeadlineAt).toBe(originalDeadline + 2 + 74_000);
    expect(() => game.submitTeam(state, 'p0', ['p0', 'p1'], false, state.timer.phaseDeadlineAt!)).toThrow('ACTION_DEADLINE_EXPIRED');
  });

  it('rejects duplicate vote and quest submissions without changing counts', () => {
    const game = engine();
    const state = enterTeamSelection(game, 5);
    const leader = state.players.find((player) => player.seat === state.leaderSeat)!;
    game.submitTeam(state, leader.id, ['p0', 'p1'], false, state.timer.phaseStartedAt + 1);
    expireCurrent(game, state);
    game.submitApproval(state, 'p0', true, false, state.timer.phaseStartedAt + 1);
    expect(() => game.submitApproval(state, 'p0', true, false, state.timer.phaseStartedAt + 2)).toThrow('ALREADY_SUBMITTED');
    expect(state.approvalVotes).toHaveLength(1);

    state.phase = 'QUEST_SUBMISSION'; state.proposedTeam = ['p0', 'p1']; state.questVotes = [];
    state.timer = { status: 'RUNNING', phaseStartedAt: 0, phaseDeadlineAt: 30_000, remainingDuration: 30_000, pausedAt: null, extensionCount: 0 };
    game.submitQuest(state, 'p0', 'SUCCESS', false, 1);
    expect(() => game.submitQuest(state, 'p0', 'SUCCESS', false, 2)).toThrow('ALREADY_SUBMITTED');
    expect(state.questVotes).toHaveLength(1);
  });
});
