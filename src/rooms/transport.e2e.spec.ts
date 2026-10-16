import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Socket, io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { ApiExceptionFilter, ApiResponseInterceptor } from '../http';
import { PrismaService } from '../prisma.service';
import { RoomsService } from './rooms.service';

interface Identity { code: string; playerId: string; rejoinToken: string }

describe('REST and Socket.IO transport E2E', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'avalon-transport-'));
  const databasePath = join(temporaryDirectory, 'test.db');
  let app: INestApplication;
  let prisma: PrismaService;
  let rooms: RoomsService;
  let baseUrl: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    process.env.ALLOW_TEST_MODE = 'true';
    for (const migration of ['20261016111706_init', '20261016112644_add_test_mode']) {
      const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations', migration, 'migration.sql'), 'utf8');
      execFileSync('sqlite3', [databasePath], { input: sql });
    }
    prisma = new PrismaService({ datasources: { db: { url: `file:${databasePath}` } } });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalFilters(new ApiExceptionFilter());
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    rooms = app.get(RoomsService);
  }, 20_000);

  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await app.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, json: await response.json() as any };
  }

  async function createPlayers(count: number) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const created = await request('/rooms', 'POST', { nickname: `Host-${suffix}` });
    expect(created.status).toBe(201);
    const host = created.json.data as Identity;
    const players = [host];
    for (let index = 1; index < count; index++) {
      const joined = await request('/rooms/join', 'POST', { code: host.code, nickname: `P${index}-${suffix}` });
      expect(joined.status).toBe(201);
      players.push(joined.json.data as Identity);
      const ready = await request(`/rooms/${host.code}/ready`, 'POST', { token: joined.json.data.rejoinToken, ready: true });
      expect(ready.json.success).toBe(true);
    }
    return players;
  }

  async function snapshot(identity: Identity) {
    const result = await request(`/rooms/${identity.code}/snapshot?token=${encodeURIComponent(identity.rejoinToken)}`);
    expect(result.json.success).toBe(true);
    return result.json.data;
  }

  async function connectSocket() {
    const socket = io(baseUrl, { transports: ['websocket'], forceNew: true, autoConnect: false });
    sockets.push(socket);
    const connected = new Promise<void>((resolveConnection, reject) => {
      socket.once('connect', () => resolveConnection());
      socket.once('connect_error', reject);
    });
    socket.connect();
    await connected;
    return socket;
  }

  function emitAck<T>(socket: Socket, event: string, payload: unknown) {
    return new Promise<T>((resolveAck, reject) => {
      const timeout = setTimeout(() => reject(new Error(`ACK_TIMEOUT:${event}`)), 3_000);
      socket.emit(event, payload, (result: T) => { clearTimeout(timeout); resolveAck(result); });
    });
  }

  it('runs real REST commands while keeping roles, live votes, and quest submissions private', async () => {
    const players = await createPlayers(5);
    const started = await request(`/rooms/${players[0].code}/start`, 'POST', { token: players[0].rejoinToken });
    expect(started.json.success).toBe(true);

    for (const player of players) {
      const view = await snapshot(player);
      const serializedPublic = JSON.stringify(view.public);
      expect(serializedPublic).not.toContain('assignments');
      expect(serializedPublic).not.toContain('questVotes');
      expect(view.private.assignment.playerId).toBe(player.playerId);
      expect(view.private.assignment.role).toBeTypeOf('string');
      await request(`/rooms/${player.code}/acknowledge`, 'POST', { token: player.rejoinToken });
    }

    let hostView = await snapshot(players[0]);
    expect(hostView.public.phase).toBe('OPENING_DISCUSSION');
    await rooms.expireDue(hostView.public.timer.phaseDeadlineAt);
    hostView = await snapshot(players[0]);
    expect(hostView.public.phase).toBe('TEAM_SELECTION');

    const leaderId = hostView.public.players.find((player: any) => player.seat === hostView.public.leaderSeat).id;
    const leader = players.find((player) => player.playerId === leaderId)!;
    const teamIds = hostView.public.players.slice(0, 2).map((player: any) => player.id);
    await request(`/rooms/${leader.code}/team`, 'POST', { token: leader.rejoinToken, playerIds: teamIds });
    hostView = await snapshot(players[0]);
    await rooms.expireDue(hostView.public.timer.phaseDeadlineAt);
    hostView = await snapshot(players[0]);
    expect(hostView.public.phase).toBe('TEAM_VOTING');

    await request(`/rooms/${players[0].code}/vote`, 'POST', { token: players[0].rejoinToken, approve: true });
    const liveVoteView = await snapshot(players[1]);
    expect(liveVoteView.public.approvalVotes).toEqual([{ submitted: true }]);
    expect(JSON.stringify(liveVoteView.public.approvalVotes)).not.toContain(players[0].playerId);
    for (const player of players.slice(1)) await request(`/rooms/${player.code}/vote`, 'POST', { token: player.rejoinToken, approve: true });

    hostView = await snapshot(players[0]);
    expect(hostView.public.phase).toBe('VOTE_RESULT');
    expect(hostView.public.approvalVotes).toHaveLength(5);
    await rooms.expireDue(hostView.public.timer.phaseDeadlineAt);
    hostView = await snapshot(players[0]);
    expect(hostView.public.phase).toBe('QUEST_SUBMISSION');

    for (const playerId of teamIds) {
      const member = players.find((player) => player.playerId === playerId)!;
      await request(`/rooms/${member.code}/quest`, 'POST', { token: member.rejoinToken, outcome: 'SUCCESS' });
    }
    const resultView = await snapshot(players[0]);
    expect(resultView.public.phase).toBe('QUEST_RESULT');
    expect(JSON.stringify(resultView.public)).not.toContain('questVotes');
    expect(resultView.public.quests[0]).toMatchObject({ result: 'SUCCESS', failCount: 0, successCount: 2 });
  }, 20_000);

  it('restores the same identity on reconnect and tracks multiple sockets safely', async () => {
    const [host, joined] = await createPlayers(2);
    const hostSocket = await connectSocket();
    const firstSync = await emitAck<any>(hostSocket, 'game:sync', { code: host.code, token: host.rejoinToken });
    expect(firstSync).toMatchObject({ success: true, data: { public: { selfPlayerId: host.playerId } } });

    const joinedSocketA = await connectSocket();
    const joinedSocketB = await connectSocket();
    await emitAck(joinedSocketA, 'game:sync', { code: joined.code, token: joined.rejoinToken });
    await emitAck(joinedSocketB, 'game:sync', { code: joined.code, token: joined.rejoinToken });
    expect((await snapshot(host)).public.players.find((player: any) => player.id === joined.playerId).connected).toBe(true);

    joinedSocketA.disconnect();
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    expect((await snapshot(host)).public.players.find((player: any) => player.id === joined.playerId).connected).toBe(true);

    const disconnected = new Promise<void>((resolvePresence) => hostSocket.once('room:presence_changed', (event) => {
      if (event.playerId === joined.playerId && event.connected === false) resolvePresence();
    }));
    joinedSocketB.disconnect();
    await disconnected;
    expect((await snapshot(host)).public.players.find((player: any) => player.id === joined.playerId).connected).toBe(false);

    const rejoinedSocket = await connectSocket();
    const rejoined = await emitAck<any>(rejoinedSocket, 'game:sync', { code: joined.code, token: joined.rejoinToken });
    expect(rejoined).toMatchObject({ success: true, data: { public: { selfPlayerId: joined.playerId } } });
    expect((await snapshot(host)).public.players.find((player: any) => player.id === joined.playerId).connected).toBe(true);
  }, 20_000);

  it('keeps an active game valid while the host disconnects and reconnects', async () => {
    const [host] = await createPlayers(1);
    const started = await request(`/rooms/${host.code}/start`, 'POST', { token: host.rejoinToken, testMode: true });
    expect(started.json.data.public.phase).toBe('ROLE_REVEAL');

    const hostSocket = await connectSocket();
    await emitAck(hostSocket, 'game:sync', { code: host.code, token: host.rejoinToken });
    hostSocket.disconnect();
    for (let attempt = 0; attempt < 20; attempt++) {
      const view = await snapshot(host);
      if (!view.public.players.find((player: any) => player.id === host.playerId).connected) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    const disconnectedView = await snapshot(host);
    expect(disconnectedView.public.phase).toBe('ROLE_REVEAL');
    expect(disconnectedView.public.players.find((player: any) => player.id === host.playerId).connected).toBe(false);

    const reconnectedSocket = await connectSocket();
    const restored = await emitAck<any>(reconnectedSocket, 'game:sync', { code: host.code, token: host.rejoinToken });
    expect(restored).toMatchObject({ success: true, data: { selfPlayerId: host.playerId, isHost: true, public: { phase: 'ROLE_REVEAL' } } });
  }, 20_000);

  it('supports lobby removal, leaving, seat compaction, and host transfer', async () => {
    const [host, second, third] = await createPlayers(3);
    const forbidden = await request(`/rooms/${host.code}/players/${third.playerId}/remove`, 'POST', { token: second.rejoinToken });
    expect(forbidden).toMatchObject({ status: 400, json: { success: false, error: { code: 'HOST_ONLY' } } });

    const removed = await request(`/rooms/${host.code}/players/${third.playerId}/remove`, 'POST', { token: host.rejoinToken });
    expect(removed.json.data.players.map((player: any) => player.id)).toEqual([host.playerId, second.playerId]);
    expect(removed.json.data.players.map((player: any) => player.seat)).toEqual([0, 1]);

    const hostLeft = await request(`/rooms/${host.code}/leave`, 'POST', { token: host.rejoinToken });
    expect(hostLeft.json.data).toMatchObject({ roomDeleted: false, playerRemoved: true });
    const transferred = await request(`/rooms/${host.code}?token=${encodeURIComponent(second.rejoinToken)}`);
    expect(transferred.json.data).toMatchObject({ hostPlayerId: second.playerId, selfPlayerId: second.playerId });
    expect(transferred.json.data.players).toHaveLength(1);
    expect(transferred.json.data.players[0].seat).toBe(0);

    const finalLeave = await request(`/rooms/${host.code}/leave`, 'POST', { token: second.rejoinToken });
    expect(finalLeave.json.data).toMatchObject({ roomDeleted: true, playerRemoved: true });
    const deleted = await request(`/rooms/${host.code}?token=${encodeURIComponent(second.rejoinToken)}`);
    expect(deleted).toMatchObject({ status: 400, json: { success: false, error: { code: 'ROOM_NOT_FOUND' } } });
  });

  it('retains human players and completed history through play again', async () => {
    const [host] = await createPlayers(1);
    await request(`/rooms/${host.code}/start`, 'POST', { token: host.rejoinToken, testMode: true });
    const authenticated = await rooms.authenticate(host.code, host.rejoinToken);
    await rooms.mutate(host.code, host.rejoinToken, (state) => {
      state.phase = 'GAME_OVER';
      state.phaseVersion++;
      state.winner = 'GOOD';
      state.timer = { status: 'DISABLED', phaseStartedAt: Date.now(), phaseDeadlineAt: null, remainingDuration: null, pausedAt: null, extensionCount: 0 };
      return state;
    });

    const replay = await request(`/rooms/${host.code}/play-again`, 'POST', { token: host.rejoinToken });
    expect(replay.json.data).toMatchObject({ public: { status: 'LOBBY', testMode: false, hostPlayerId: host.playerId } });
    expect(replay.json.data.public.players).toHaveLength(1);
    expect(replay.json.data.public.players[0]).toMatchObject({ id: host.playerId, seat: 0, ready: false, isBot: false });
    expect(await prisma.gameSession.count({ where: { roomId: authenticated.room.id, status: 'COMPLETED' } })).toBe(1);

    await request(`/rooms/${host.code}/start`, 'POST', { token: host.rejoinToken, testMode: true });
    expect(await prisma.gameSession.count({ where: { roomId: authenticated.room.id } })).toBe(2);
  }, 20_000);

  it('supports typed Socket.IO room lifecycle and timer commands', async () => {
    const [host] = await createPlayers(1);
    const hostSocket = await connectSocket();
    await emitAck(hostSocket, 'game:sync', { code: host.code, token: host.rejoinToken });
    const guestSocket = await connectSocket();
    const joined = await emitAck<any>(guestSocket, 'room:join', { code: host.code, nickname: 'Socket Guest' });
    expect(joined).toMatchObject({ success: true, data: { code: host.code } });
    const guest = joined.data as Identity;
    const ready = await emitAck<any>(guestSocket, 'player:ready', { code: host.code, token: guest.rejoinToken, ready: true });
    expect(ready.success).toBe(true);
    const left = await emitAck<any>(guestSocket, 'room:leave', { code: host.code, token: guest.rejoinToken });
    expect(left).toMatchObject({ success: true, data: { playerRemoved: true } });
    expect((await snapshot(host)).public.players).toHaveLength(1);

    const started = await emitAck<any>(hostSocket, 'game:start', { code: host.code, token: host.rejoinToken, testMode: true });
    expect(started.data.public.phase).toBe('ROLE_REVEAL');
    const paused = await emitAck<any>(hostSocket, 'timer:pause', { code: host.code, token: host.rejoinToken });
    expect(paused.data.public.timer.status).toBe('PAUSED');
    const beforeExtension = paused.data.public.timer.remainingDuration;
    const extended = await emitAck<any>(hostSocket, 'timer:extend', { code: host.code, token: host.rejoinToken, seconds: 30 });
    expect(extended.data.public.timer.remainingDuration).toBe(beforeExtension + 30_000);
    const resumed = await emitAck<any>(hostSocket, 'timer:resume', { code: host.code, token: host.rejoinToken });
    expect(resumed.data.public.timer.status).toBe('RUNNING');
  }, 20_000);

  it('broadcasts REST state changes to connected Socket.IO clients', async () => {
    const [host] = await createPlayers(1);
    const socket = await connectSocket();
    await emitAck(socket, 'game:sync', { code: host.code, token: host.rejoinToken });
    const changed = new Promise<any>((resolveChange, reject) => {
      const timeout = setTimeout(() => reject(new Error('REST_BROADCAST_TIMEOUT')), 3_000);
      socket.once('game:phase_changed', (event) => { clearTimeout(timeout); resolveChange(event); });
    });
    const started = await request(`/rooms/${host.code}/start`, 'POST', { token: host.rejoinToken, testMode: true });
    expect(started.json.success).toBe(true);
    const event = await changed;
    expect(event.stateVersion).toBe(started.json.data.public.stateVersion);
  });

  it('returns structured transport errors for invalid authentication and validation', async () => {
    const [host] = await createPlayers(1);
    const invalid = await request(`/rooms/${host.code}?token=invalid`);
    expect(invalid.status).toBe(400);
    expect(invalid.json).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED_PLAYER' } });

    const malformed = await request('/rooms/join', 'POST', { code: 'bad', nickname: '' });
    expect(malformed.status).toBe(400);
    expect(malformed.json.success).toBe(false);

    const socket = await connectSocket();
    const socketError = await emitAck<any>(socket, 'game:sync', { code: host.code, token: 'invalid' });
    expect(socketError).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED_PLAYER' } });
  });
});
