import { randomInt, randomUUID } from 'node:crypto';
import { assignRoles, defaultRoles, QUEST_SIZES, questFailThreshold, roleKnowledge, shuffle } from './rules';
import { GameState, Phase, Role } from './types';

const NEXT_PHASE: Partial<Record<Phase, Phase>> = {
  ROLE_REVEAL: 'OPENING_DISCUSSION', OPENING_DISCUSSION: 'TEAM_SELECTION', TEAM_SELECTION: 'TEAM_DISCUSSION',
  TEAM_DISCUSSION: 'TEAM_VOTING', VOTE_RESULT: 'QUEST_SUBMISSION', QUEST_RESULT: 'ROUND_DISCUSSION',
  ROUND_DISCUSSION: 'TEAM_SELECTION', ASSASSINATION_DISCUSSION: 'ASSASSINATION_DECISION',
};

export const STANDARD_DURATIONS: Partial<Record<Phase, number>> = {
  ROLE_REVEAL: 30, OPENING_DISCUSSION: 120, TEAM_SELECTION: 45, TEAM_DISCUSSION: 90,
  TEAM_VOTING: 30, VOTE_RESULT: 10, QUEST_SUBMISSION: 30, QUEST_RESULT: 10,
  ROUND_DISCUSSION: 90, ASSASSINATION_DISCUSSION: 120, ASSASSINATION_DECISION: 45,
};

export class GameEngine {
  constructor(private readonly random: () => number = () => randomInt(0, 0x100000000) / 0x100000000) {}

  start(players: GameState['players'], roles: Role[] = defaultRoles(players.length), now = Date.now(), testMode = false, initialLeaderSeat?: number): GameState {
    if (players.length < 5 || players.length > 10) throw new Error('PLAYER_COUNT_OUT_OF_RANGE');
    const assignments = assignRoles(players.sort((a, b) => a.seat - b.seat).map((player) => player.id), roles, this.random);
    const firstLeader = initialLeaderSeat ?? Math.floor(this.random() * players.length);
    const state: GameState = {
      id: randomUUID(), stateVersion: 1, testMode, phase: 'ROLE_REVEAL', phaseVersion: 1, players, assignments,
      leaderSeat: firstLeader, questIndex: 0, rejectionCount: 0, goodScore: 0, evilScore: 0,
      proposedTeam: [], proposalAutomatic: false, approvalVotes: [], questVotes: [], quests: [],
      acknowledgedPlayerIds: [], timer: this.timerFor('ROLE_REVEAL', now),
    };
    return state;
  }

  acknowledge(state: GameState, playerId: string, now = Date.now(), automatic = false): GameState {
    this.requirePhase(state, 'ROLE_REVEAL');
    if (!automatic) this.requireActionWindow(state, now);
    if (!state.players.some((player) => player.id === playerId)) throw new Error('PLAYER_NOT_FOUND');
    if (!state.acknowledgedPlayerIds.includes(playerId)) state.acknowledgedPlayerIds.push(playerId);
    if (state.acknowledgedPlayerIds.length === state.players.length) this.transition(state, 'OPENING_DISCUSSION', now);
    return state;
  }

  submitTeam(state: GameState, leaderId: string, playerIds: string[], automatic = false, now = Date.now()): GameState {
    this.requirePhase(state, 'TEAM_SELECTION');
    if (!automatic) this.requireActionWindow(state, now);
    const leader = state.players.find((player) => player.seat === state.leaderSeat);
    if (!leader || leader.id !== leaderId) throw new Error('ONLY_LEADER_ALLOWED');
    const required = QUEST_SIZES[state.players.length][state.questIndex];
    if (new Set(playerIds).size !== required || playerIds.some((id) => !state.players.some((player) => player.id === id))) throw new Error('INVALID_TEAM');
    state.proposedTeam = [...playerIds]; state.proposalAutomatic = automatic; state.approvalVotes = [];
    this.transition(state, 'TEAM_DISCUSSION', now);
    return state;
  }

  submitApproval(state: GameState, playerId: string, approve: boolean, automatic = false, now = Date.now()): GameState {
    this.requirePhase(state, 'TEAM_VOTING');
    if (!automatic) this.requireActionWindow(state, now);
    if (state.approvalVotes.some((vote) => vote.playerId === playerId)) throw new Error('ALREADY_SUBMITTED');
    if (!state.players.some((player) => player.id === playerId)) throw new Error('PLAYER_NOT_FOUND');
    state.approvalVotes.push({ playerId, approve, automatic });
    if (state.approvalVotes.length === state.players.length) this.resolveApproval(state, now);
    return state;
  }

  submitQuest(state: GameState, playerId: string, outcome: 'SUCCESS' | 'FAIL', automatic = false, now = Date.now()): GameState {
    this.requirePhase(state, 'QUEST_SUBMISSION');
    if (!automatic) this.requireActionWindow(state, now);
    if (!state.proposedTeam.includes(playerId)) throw new Error('NOT_ON_QUEST');
    if (state.questVotes.some((vote) => vote.playerId === playerId)) throw new Error('ALREADY_SUBMITTED');
    const assignment = state.assignments.find((item) => item.playerId === playerId);
    if (!assignment) throw new Error('ROLE_NOT_FOUND');
    if (assignment.faction === 'GOOD' && outcome === 'FAIL') throw new Error('GOOD_CANNOT_FAIL');
    state.questVotes.push({ playerId, outcome, automatic });
    if (state.questVotes.length === state.proposedTeam.length) this.resolveQuest(state, now);
    return state;
  }

  assassinate(state: GameState, assassinId: string, targetId: string, automatic = false, now = Date.now()): GameState {
    this.requirePhase(state, 'ASSASSINATION_DECISION');
    if (!automatic) this.requireActionWindow(state, now);
    const assassin = state.assignments.find((item) => item.playerId === assassinId);
    if (assassin?.role !== 'ASSASSIN') throw new Error('ONLY_ASSASSIN_ALLOWED');
    if (!state.players.some((player) => player.id === targetId) || targetId === assassinId) throw new Error('INVALID_TARGET');
    state.assassinationTargetId = targetId;
    state.winner = state.assignments.find((item) => item.playerId === targetId)?.role === 'MERLIN' ? 'EVIL' : 'GOOD';
    this.transition(state, 'GAME_OVER', now);
    return state;
  }

  expire(state: GameState, now = Date.now()): GameState {
    if (state.timer.status !== 'RUNNING' || !state.timer.phaseDeadlineAt || now < state.timer.phaseDeadlineAt) return state;
    if (state.phase === 'TEAM_SELECTION') {
      const leader = state.players.find((player) => player.seat === state.leaderSeat)!;
      return this.submitTeam(state, leader.id, shuffle(state.players, this.random).slice(0, QUEST_SIZES[state.players.length][state.questIndex]).map((player) => player.id), true, now);
    }
    if (state.phase === 'TEAM_VOTING') {
      for (const player of state.players) if (!state.approvalVotes.some((vote) => vote.playerId === player.id)) state.approvalVotes.push({ playerId: player.id, approve: false, automatic: true });
      return this.resolveApproval(state, now);
    }
    if (state.phase === 'QUEST_SUBMISSION') {
      for (const playerId of state.proposedTeam) if (!state.questVotes.some((vote) => vote.playerId === playerId)) state.questVotes.push({ playerId, outcome: 'SUCCESS', automatic: true });
      return this.resolveQuest(state, now);
    }
    if (state.phase === 'ASSASSINATION_DECISION') {
      const assassin = state.assignments.find((item) => item.role === 'ASSASSIN')!;
      const eligible = state.players.filter((player) => player.id !== assassin.playerId);
      return this.assassinate(state, assassin.playerId, eligible[Math.floor(this.random() * eligible.length)].id, true, now);
    }
    if (state.phase === 'VOTE_RESULT') return this.continueAfterVoteResult(state, now);
    if (state.phase === 'QUEST_RESULT') return this.continueAfterQuestResult(state, now);
    const next = NEXT_PHASE[state.phase];
    if (next) this.transition(state, next, now);
    return state;
  }

  pause(state: GameState, now = Date.now()): GameState {
    if (state.timer.status !== 'RUNNING') throw new Error('TIMER_NOT_RUNNING');
    this.requireActionWindow(state, now);
    state.timer.remainingDuration = Math.max(0, (state.timer.phaseDeadlineAt ?? now) - now);
    state.timer.phaseDeadlineAt = null; state.timer.pausedAt = now; state.timer.status = 'PAUSED'; return state;
  }

  resume(state: GameState, now = Date.now()): GameState {
    if (state.timer.status !== 'PAUSED') throw new Error('TIMER_NOT_PAUSED');
    state.timer.phaseDeadlineAt = now + (state.timer.remainingDuration ?? 0);
    state.timer.pausedAt = null; state.timer.status = 'RUNNING'; return state;
  }

  extend(state: GameState, seconds: 30 | 60, now = Date.now()): GameState {
    if (state.timer.extensionCount >= 4) throw new Error('TIMER_EXTENSION_LIMIT');
    if (state.timer.status === 'RUNNING') this.requireActionWindow(state, now);
    if (state.timer.status === 'RUNNING' && state.timer.phaseDeadlineAt) state.timer.phaseDeadlineAt += seconds * 1000;
    else if (state.timer.status === 'PAUSED') state.timer.remainingDuration = (state.timer.remainingDuration ?? 0) + seconds * 1000;
    else throw new Error('TIMER_NOT_EXTENDABLE');
    state.timer.extensionCount++; return state;
  }

  private resolveApproval(state: GameState, now: number): GameState {
    const approved = state.approvalVotes.filter((vote) => vote.approve).length > state.players.length / 2;
    this.transition(state, 'VOTE_RESULT', now);
    if (approved) { state.rejectionCount = 0; return state; }
    state.rejectionCount++;
    if (state.rejectionCount >= 5) { state.winner = 'EVIL'; this.transition(state, 'GAME_OVER', now); return state; }
    return state;
  }

  continueAfterVoteResult(state: GameState, now = Date.now()): GameState {
    this.requirePhase(state, 'VOTE_RESULT');
    const approved = state.approvalVotes.filter((vote) => vote.approve).length > state.players.length / 2;
    if (approved) { state.questVotes = []; this.transition(state, 'QUEST_SUBMISSION', now); }
    else { state.leaderSeat = (state.leaderSeat + 1) % state.players.length; state.proposedTeam = []; this.transition(state, 'TEAM_SELECTION', now); }
    return state;
  }

  private resolveQuest(state: GameState, now: number): GameState {
    const failCount = state.questVotes.filter((vote) => vote.outcome === 'FAIL').length;
    const threshold = questFailThreshold(state.players.length, state.questIndex);
    const result = failCount >= threshold ? 'FAIL' : 'SUCCESS';
    state.quests.push({ index: state.questIndex, teamSize: state.proposedTeam.length, failThreshold: threshold, teamPlayerIds: [...state.proposedTeam], result, successCount: state.questVotes.length - failCount, failCount });
    if (result === 'SUCCESS') state.goodScore++; else state.evilScore++;
    this.transition(state, 'QUEST_RESULT', now);
    return state;
  }

  continueAfterQuestResult(state: GameState, now = Date.now()): GameState {
    this.requirePhase(state, 'QUEST_RESULT');
    if (state.evilScore >= 3) { state.winner = 'EVIL'; this.transition(state, 'GAME_OVER', now); return state; }
    if (state.goodScore >= 3) { this.transition(state, 'ASSASSINATION_DISCUSSION', now); return state; }
    state.questIndex++; state.rejectionCount = 0; state.leaderSeat = (state.leaderSeat + 1) % state.players.length;
    state.proposedTeam = []; state.approvalVotes = []; state.questVotes = [];
    this.transition(state, 'ROUND_DISCUSSION', now); return state;
  }

  private transition(state: GameState, phase: Phase, now: number): void {
    state.phase = phase; state.phaseVersion++; state.timer = this.timerFor(phase, now);
  }

  private timerFor(phase: Phase, now: number) {
    const seconds = STANDARD_DURATIONS[phase];
    return { status: seconds ? 'RUNNING' as const : 'DISABLED' as const, phaseStartedAt: now, phaseDeadlineAt: seconds ? now + seconds * 1000 : null, remainingDuration: seconds ? seconds * 1000 : null, pausedAt: null, extensionCount: 0 };
  }

  private requirePhase(state: GameState, phase: Phase): void { if (state.phase !== phase) throw new Error('INVALID_GAME_PHASE'); }

  private requireActionWindow(state: GameState, now: number): void {
    if (state.timer.status === 'EXPIRED' || (state.timer.status === 'RUNNING' && state.timer.phaseDeadlineAt !== null && now >= state.timer.phaseDeadlineAt)) throw new Error('ACTION_DEADLINE_EXPIRED');
  }

  private assignmentFor(state: GameState, playerId: string) {
    const assignment = state.assignments.find((item) => item.playerId === playerId);
    if (!assignment) throw new Error('ROLE_NOT_FOUND'); return assignment;
  }

  privateInfo(state: GameState, playerId: string) {
    const assignment = this.assignmentFor(state, playerId);
    return { assignment, knowledge: roleKnowledge(assignment, state.assignments), hasAcknowledged: state.acknowledgedPlayerIds.includes(playerId), hasVoted: state.approvalVotes.some((vote) => vote.playerId === playerId), hasSubmittedQuest: state.questVotes.some((vote) => vote.playerId === playerId) };
  }
}
