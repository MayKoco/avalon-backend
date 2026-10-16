export const phases = [
  'LOBBY', 'ROLE_REVEAL', 'OPENING_DISCUSSION', 'TEAM_SELECTION',
  'TEAM_DISCUSSION', 'TEAM_VOTING', 'VOTE_RESULT', 'QUEST_SUBMISSION',
  'QUEST_RESULT', 'ROUND_DISCUSSION', 'ASSASSINATION_DISCUSSION',
  'ASSASSINATION_DECISION', 'GAME_OVER',
] as const;

export type Phase = (typeof phases)[number];
export type Faction = 'GOOD' | 'EVIL';
export type Role = 'MERLIN' | 'PERCIVAL' | 'ASSASSIN' | 'MORGANA' | 'MORDRED' | 'OBERON' | 'LOYAL_SERVANT' | 'MINION_OF_MORDRED';
export type TimerStatus = 'RUNNING' | 'PAUSED' | 'DISABLED' | 'EXPIRED';

export interface EnginePlayer {
  id: string;
  nickname: string;
  seat: number;
  connected: boolean;
  ready: boolean;
  isBot?: boolean;
}

export interface Assignment { playerId: string; role: Role; faction: Faction }
export interface SubmittedVote { playerId: string; approve: boolean; automatic?: boolean }
export interface QuestVote { playerId: string; outcome: 'SUCCESS' | 'FAIL'; automatic?: boolean }

export interface QuestRecord {
  index: number;
  teamSize: number;
  failThreshold: number;
  teamPlayerIds: string[];
  result?: 'SUCCESS' | 'FAIL';
  successCount?: number;
  failCount?: number;
}

export interface TimerState {
  status: TimerStatus;
  phaseStartedAt: number;
  phaseDeadlineAt: number | null;
  remainingDuration: number | null;
  pausedAt: number | null;
  extensionCount: number;
}

export interface GameState {
  id: string;
  stateVersion: number;
  testMode: boolean;
  phase: Phase;
  phaseVersion: number;
  players: EnginePlayer[];
  assignments: Assignment[];
  leaderSeat: number;
  questIndex: number;
  rejectionCount: number;
  goodScore: number;
  evilScore: number;
  proposedTeam: string[];
  proposalAutomatic: boolean;
  approvalVotes: SubmittedVote[];
  questVotes: QuestVote[];
  quests: QuestRecord[];
  acknowledgedPlayerIds: string[];
  winner?: Faction;
  assassinationTargetId?: string;
  timer: TimerState;
}
