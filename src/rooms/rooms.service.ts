import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../prisma.service';
import { GameEngine } from '../game/engine';
import { GameState } from '../game/types';
import { QUEST_SIZES } from '../game/rules';

const roomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

@Injectable()
export class RoomsService {
  private readonly engine = new GameEngine();
  constructor(private readonly prisma: PrismaService) {}

  private hash(token: string) {
    return createHash('sha256').update(`${token}:${process.env.REJOIN_TOKEN_PEPPER ?? 'development-only-pepper'}`).digest('hex');
  }

  async create(nickname: string) {
    const token = randomBytes(32).toString('base64url');
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const room = await tx.gameRoom.create({ data: { code: roomCode() } });
          const player = await tx.player.create({ data: { roomId: room.id, nickname: nickname.trim(), seat: 0, rejoinTokenHash: this.hash(token) } });
          await tx.gameRoom.update({ where: { id: room.id }, data: { hostPlayerId: player.id } });
          return { room, player };
        });
        return { code: result.room.code, playerId: result.player.id, rejoinToken: token };
      } catch (error) { if (attempt === 4) throw error; }
    }
    throw new Error('ROOM_CREATION_FAILED');
  }

  async join(code: string, nickname: string) {
    const normalized = code.toUpperCase();
    const token = randomBytes(32).toString('base64url');
    return this.prisma.$transaction(async (tx) => {
      const room = await tx.gameRoom.findUnique({ where: { code: normalized }, include: { players: true } });
      if (!room) throw new Error('ROOM_NOT_FOUND');
      if (room.status !== 'LOBBY') throw new Error('GAME_ALREADY_STARTED');
      if (room.players.length >= 10) throw new Error('ROOM_FULL');
      if (room.players.some((player) => player.nickname.toLocaleLowerCase() === nickname.trim().toLocaleLowerCase())) throw new Error('NICKNAME_TAKEN');
      const player = await tx.player.create({ data: { roomId: room.id, nickname: nickname.trim(), seat: room.players.length, rejoinTokenHash: this.hash(token) } });
      return { code: normalized, playerId: player.id, rejoinToken: token };
    });
  }

  async authenticate(code: string, token: string) {
    const room = await this.prisma.gameRoom.findUnique({ where: { code: code.toUpperCase() }, include: { players: { orderBy: { seat: 'asc' } } } });
    if (!room) throw new Error('ROOM_NOT_FOUND');
    const player = room.players.find((item) => item.rejoinTokenHash === this.hash(token));
    if (!player) throw new Error('UNAUTHORIZED_PLAYER');
    return { room, player };
  }

  async lobby(code: string, token: string) {
    const { room, player } = await this.authenticate(code, token);
    return { code: room.code, status: room.status, stateVersion: room.stateVersion, testMode: room.testMode, testModeAvailable: process.env.ALLOW_TEST_MODE === 'true' || process.env.NODE_ENV !== 'production', hostPlayerId: room.hostPlayerId, selfPlayerId: player.id, players: room.players.map(({ rejoinTokenHash: _, ...safe }) => safe) };
  }

  async ready(code: string, token: string, ready: boolean) {
    const { player } = await this.authenticate(code, token);
    await this.prisma.player.update({ where: { id: player.id }, data: { ready } });
    return this.lobby(code, token);
  }

  async start(code: string, token: string, testMode = false) {
    let authenticated = await this.authenticate(code, token);
    if (testMode) {
      if (process.env.ALLOW_TEST_MODE !== 'true' && process.env.NODE_ENV === 'production') throw new Error('TEST_MODE_DISABLED');
      if (authenticated.room.hostPlayerId !== authenticated.player.id) throw new Error('HOST_ONLY');
      const missingPlayers = Math.max(0, 5 - authenticated.room.players.length);
      if (missingPlayers > 0) {
        await this.prisma.player.createMany({ data: Array.from({ length: missingPlayers }, (_, index) => ({ roomId: authenticated.room.id, nickname: `Bot ทดสอบ ${authenticated.room.players.length + index + 1}`, seat: authenticated.room.players.length + index, ready: true, connected: false, isBot: true, rejoinTokenHash: this.hash(randomBytes(32).toString('base64url')) })) });
        authenticated = await this.authenticate(code, token);
      }
    }
    const { room, player } = authenticated;
    if (room.hostPlayerId !== player.id) throw new Error('HOST_ONLY');
    if (room.players.length < 5 || room.players.length > 10) throw new Error('PLAYER_COUNT_OUT_OF_RANGE');
    if (room.players.some((item) => item.id !== player.id && !item.ready && !item.isBot)) throw new Error('PLAYERS_NOT_READY');
    const state = this.engine.start(room.players.map((item) => ({ id: item.id, nickname: item.nickname, seat: item.seat, connected: item.connected, ready: item.ready, isBot: item.isBot })), undefined, Date.now(), testMode, testMode ? player.seat : undefined);
    await this.prisma.$transaction(async (tx) => {
      const count = await tx.gameSession.count({ where: { roomId: room.id } });
      const session = await tx.gameSession.create({ data: { id: state.id, roomId: room.id, sequence: count + 1, phase: state.phase, stateVersion: state.stateVersion, leaderSeat: state.leaderSeat, questIndex: 0, stateJson: JSON.stringify(state), roles: { create: state.assignments.map((item) => ({ playerId: item.playerId, role: item.role, faction: item.faction })) }, phases: { create: { phase: state.phase, version: state.phaseVersion } }, timers: { create: this.timerData(state) } } });
      await tx.gameRoom.update({ where: { id: room.id }, data: { status: state.phase, stateVersion: state.stateVersion, testMode } });
      await tx.gameEvent.create({ data: { roomId: room.id, sessionId: session.id, type: 'GAME_STARTED', stateVersion: state.stateVersion, publicJson: JSON.stringify({ phase: state.phase }) } });
    });
    return this.snapshot(code, token);
  }

  async advanceTest(code: string, token: string) {
    return this.mutate(code, token, (state, playerId, isHost) => {
      if (!isHost) throw new Error('HOST_ONLY');
      if (!state.testMode) throw new Error('TEST_MODE_ONLY');
      const now = Date.now();
      if (state.phase === 'ROLE_REVEAL') {
        for (const player of state.players) if (!state.acknowledgedPlayerIds.includes(player.id)) this.engine.acknowledge(state, player.id, now);
        return state;
      }
      if (state.phase === 'TEAM_SELECTION') {
        const leader = state.players.find((item) => item.seat === state.leaderSeat);
        if (!leader) throw new Error('LEADER_NOT_FOUND');
        const size = QUEST_SIZES[state.players.length][state.questIndex];
        return this.engine.submitTeam(state, leader.id, state.players.slice(0, size).map((item) => item.id), true, now);
      }
      if (state.phase === 'TEAM_VOTING') {
        for (const player of state.players) if (!state.approvalVotes.some((vote) => vote.playerId === player.id)) this.engine.submitApproval(state, player.id, true, true, now);
        return state;
      }
      if (state.phase === 'QUEST_SUBMISSION') {
        for (const memberId of state.proposedTeam) if (!state.questVotes.some((vote) => vote.playerId === memberId)) this.engine.submitQuest(state, memberId, 'SUCCESS', true, now);
        return state;
      }
      if (state.phase === 'ASSASSINATION_DECISION') {
        const assassin = state.assignments.find((item) => item.role === 'ASSASSIN');
        if (!assassin) throw new Error('ASSASSIN_NOT_FOUND');
        const target = state.players.find((item) => item.id !== assassin.playerId);
        if (!target) throw new Error('INVALID_TARGET');
        return this.engine.assassinate(state, assassin.playerId, target.id, true, now);
      }
      if (state.phase === 'GAME_OVER') return state;
      state.timer.status = 'RUNNING';
      state.timer.phaseDeadlineAt = now - 1;
      return this.engine.expire(state, now);
    });
  }

  async loadState(roomId: string): Promise<GameState> {
    const session = await this.prisma.gameSession.findFirst({ where: { roomId }, orderBy: { sequence: 'desc' } });
    if (!session) throw new Error('GAME_SESSION_NOT_FOUND');
    return JSON.parse(session.stateJson) as GameState;
  }

  async mutate(code: string, token: string, action: (state: GameState, playerId: string, isHost: boolean) => GameState) {
    const { room, player } = await this.authenticate(code, token);
    const state = await this.loadState(room.id);
    const beforeVersion = state.stateVersion;
    const beforePhaseVersion = state.phaseVersion;
    const next = action(state, player.id, room.hostPlayerId === player.id);
    next.stateVersion = beforeVersion + 1;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.gameSession.updateMany({ where: { id: next.id, stateVersion: beforeVersion }, data: { phase: next.phase, stateVersion: next.stateVersion, leaderSeat: next.leaderSeat, questIndex: next.questIndex, rejectionCount: next.rejectionCount, goodScore: next.goodScore, evilScore: next.evilScore, winner: next.winner, status: next.phase === 'GAME_OVER' ? 'COMPLETED' : 'ACTIVE', completedAt: next.phase === 'GAME_OVER' ? new Date() : null, stateJson: JSON.stringify(next) } });
      if (updated.count !== 1) throw new Error('STALE_STATE_VERSION');
      await tx.gameRoom.update({ where: { id: room.id }, data: { status: next.phase, stateVersion: next.stateVersion } });
      if (next.phaseVersion !== beforePhaseVersion) {
        await tx.gamePhase.updateMany({ where: { sessionId: next.id, endedAt: null }, data: { endedAt: new Date() } });
        await tx.gamePhase.create({ data: { sessionId: next.id, phase: next.phase, version: next.phaseVersion } });
        await tx.gameTimer.create({ data: { sessionId: next.id, ...this.timerData(next) } });
      }
      await tx.gameEvent.create({ data: { roomId: room.id, sessionId: next.id, type: 'STATE_CHANGED', stateVersion: next.stateVersion, publicJson: JSON.stringify({ phase: next.phase }) } });
    });
    return this.snapshot(code, token);
  }

  async expireDue(now = Date.now()): Promise<string[]> {
    const sessions = await this.prisma.gameSession.findMany({ where: { status: 'ACTIVE' }, include: { room: true } });
    const changedRooms: string[] = [];
    for (const session of sessions) {
      const state = JSON.parse(session.stateJson) as GameState;
      if (state.timer.status !== 'RUNNING' || !state.timer.phaseDeadlineAt || state.timer.phaseDeadlineAt > now) continue;
      const beforeStateVersion = state.stateVersion;
      const beforePhaseVersion = state.phaseVersion;
      const next = this.engine.expire(state, now);
      next.stateVersion = beforeStateVersion + 1;
      const updated = await this.prisma.gameSession.updateMany({ where: { id: session.id, stateVersion: beforeStateVersion }, data: { phase: next.phase, stateVersion: next.stateVersion, leaderSeat: next.leaderSeat, questIndex: next.questIndex, rejectionCount: next.rejectionCount, goodScore: next.goodScore, evilScore: next.evilScore, winner: next.winner, status: next.phase === 'GAME_OVER' ? 'COMPLETED' : 'ACTIVE', completedAt: next.phase === 'GAME_OVER' ? new Date(now) : null, stateJson: JSON.stringify(next) } });
      if (updated.count !== 1) continue;
      await this.prisma.gameRoom.update({ where: { id: session.roomId }, data: { status: next.phase, stateVersion: next.stateVersion } });
      if (next.phaseVersion !== beforePhaseVersion) {
        await this.prisma.gamePhase.updateMany({ where: { sessionId: next.id, endedAt: null }, data: { endedAt: new Date(now) } });
        await this.prisma.gamePhase.create({ data: { sessionId: next.id, phase: next.phase, version: next.phaseVersion, startedAt: new Date(now) } });
        await this.prisma.gameTimer.create({ data: { sessionId: next.id, ...this.timerData(next) } });
      }
      await this.prisma.gameEvent.create({ data: { roomId: session.roomId, sessionId: next.id, type: 'TIMER_EXPIRED', stateVersion: next.stateVersion, publicJson: JSON.stringify({ phase: next.phase }) } });
      changedRooms.push(session.room.code);
    }
    return changedRooms;
  }

  async snapshot(code: string, token: string) {
    const { room, player } = await this.authenticate(code, token);
    if (room.status === 'LOBBY') return { public: await this.lobby(code, token), private: null };
    const state = await this.loadState(room.id);
    const publicState = { ...state, assignments: undefined, questVotes: undefined, acknowledgedPlayerIds: undefined, approvalVotes: state.phase === 'TEAM_VOTING' ? state.approvalVotes.map(() => ({ submitted: true })) : state.approvalVotes };
    return { public: publicState, private: this.engine.privateInfo(state, player.id), serverNow: Date.now(), selfPlayerId: player.id, isHost: room.hostPlayerId === player.id };
  }

  private timerData(state: GameState) {
    return { phaseVersion: state.phaseVersion, phaseStartedAt: new Date(state.timer.phaseStartedAt), phaseDeadlineAt: state.timer.phaseDeadlineAt ? new Date(state.timer.phaseDeadlineAt) : null, remainingDuration: state.timer.remainingDuration, pausedAt: state.timer.pausedAt ? new Date(state.timer.pausedAt) : null, timerStatus: state.timer.status, extensionCount: state.timer.extensionCount };
  }

  get gameEngine() { return this.engine; }
}
