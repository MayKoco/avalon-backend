import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma.service';
import { RoomsService } from './rooms.service';

interface TestPlayer { playerId: string; rejoinToken: string }

describe('concurrent room actions with real SQLite persistence', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'avalon-concurrency-'));
  const databasePath = join(temporaryDirectory, 'test.db');
  let prisma: PrismaService;
  let rooms: RoomsService;

  beforeAll(async () => {
    for (const migration of ['20261016111706_init', '20261016112644_add_test_mode']) {
      const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations', migration, 'migration.sql'), 'utf8');
      execFileSync('sqlite3', [databasePath], { input: sql });
    }
    prisma = new PrismaService({ datasources: { db: { url: `file:${databasePath}` } } });
    await prisma.onModuleInit();
    rooms = new RoomsService(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  async function startedRoom(playerCount = 5) {
    const host = await rooms.create(`Host-${crypto.randomUUID()}`);
    const players: TestPlayer[] = [host];
    for (let index = 1; index < playerCount; index++) {
      const joined = await rooms.join(host.code, `Player-${index}-${crypto.randomUUID()}`);
      await rooms.ready(host.code, joined.rejoinToken, true);
      players.push(joined);
    }
    await rooms.start(host.code, host.rejoinToken);
    return { code: host.code, players };
  }

  async function forceVoting(code: string, hostToken: string) {
    await rooms.mutate(code, hostToken, (state) => {
      state.phase = 'TEAM_VOTING';
      state.phaseVersion++;
      state.proposedTeam = state.players.slice(0, 2).map((player) => player.id);
      state.approvalVotes = [];
      state.timer = { status: 'RUNNING', phaseStartedAt: Date.now(), phaseDeadlineAt: Date.now() + 60_000, remainingDuration: 60_000, pausedAt: null, extensionCount: 0 };
      return state;
    });
  }

  it.each([5, 6, 7, 8, 9, 10])('preserves %i simultaneous votes and resolves exactly once', async (count) => {
    const room = await startedRoom(count);
    await forceVoting(room.code, room.players[0].rejoinToken);

    const results = await Promise.all(room.players.map((player) => rooms.mutate(room.code, player.rejoinToken, (state, playerId) =>
      rooms.gameEngine.submitApproval(state, playerId, true),
    )));

    expect(results).toHaveLength(count);
    const authenticated = await rooms.authenticate(room.code, room.players[0].rejoinToken);
    const state = await rooms.loadState(authenticated.room.id);
    expect(state.phase).toBe('VOTE_RESULT');
    expect(state.approvalVotes).toHaveLength(count);
    expect(new Set(state.approvalVotes.map((vote) => vote.playerId)).size).toBe(count);
    expect(state.stateVersion).toBe(count + 2);
  }, 20_000);

  it('accepts only one of two concurrent submissions from the same player', async () => {
    const room = await startedRoom();
    await forceVoting(room.code, room.players[0].rejoinToken);
    const submit = () => rooms.mutate(room.code, room.players[1].rejoinToken, (state, playerId) =>
      rooms.gameEngine.submitApproval(state, playerId, true),
    );

    const results = await Promise.allSettled([submit(), submit()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: 'ALREADY_SUBMITTED' }) });

    const authenticated = await rooms.authenticate(room.code, room.players[0].rejoinToken);
    const state = await rooms.loadState(authenticated.room.id);
    expect(state.approvalVotes).toHaveLength(1);
  }, 20_000);

  it('does not accept a manual action at the same instant as timeout resolution', async () => {
    const room = await startedRoom();
    await forceVoting(room.code, room.players[0].rejoinToken);
    const authenticated = await rooms.authenticate(room.code, room.players[0].rejoinToken);
    const before = await rooms.loadState(authenticated.room.id);
    const deadline = before.timer.phaseDeadlineAt!;

    const [timeoutResult, actionResult] = await Promise.allSettled([
      rooms.expireDue(deadline),
      rooms.mutate(room.code, room.players[1].rejoinToken, (state, playerId) =>
        rooms.gameEngine.submitApproval(state, playerId, true, false, deadline),
      ),
    ]);
    expect(timeoutResult.status).toBe('fulfilled');
    expect(actionResult).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: 'ACTION_DEADLINE_EXPIRED' }) });

    await rooms.expireDue(deadline);
    const state = await rooms.loadState(authenticated.room.id);
    expect(state.phase).toBe('VOTE_RESULT');
    expect(state.approvalVotes).toHaveLength(5);
    expect(state.approvalVotes.every((vote) => vote.automatic && !vote.approve)).toBe(true);
  }, 20_000);
});
