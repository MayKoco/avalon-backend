import { Inject, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomsService } from './rooms.service';
import { ClientToServerEvents, RoomCommand, ServerToClientEvents } from './socket.contracts';

type Command = RoomCommand & { [key: string]: unknown };
type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnApplicationBootstrap, OnModuleDestroy {
  @WebSocketServer() server!: GameServer;
  private expiryInterval?: NodeJS.Timeout;
  private readonly playerSockets = new Map<string, Set<string>>();
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}
  async onApplicationBootstrap() {
    await this.rooms.resetConnections();
    await this.expireAndBroadcast();
    this.expiryInterval = setInterval(() => void this.expireAndBroadcast(), 1000);
    this.expiryInterval.unref();
  }
  handleConnection(socket: GameSocket) { socket.emit('connection:ready', { serverNow: Date.now() }); }
  handleDisconnect(socket: GameSocket) { void this.unregisterSocket(socket).catch(() => undefined); }
  onModuleDestroy() { if (this.expiryInterval) clearInterval(this.expiryInterval); }

  @SubscribeMessage('game:sync') async sync(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command) {
    try {
      const identity = await this.rooms.setConnected(body.code, body.token, true);
      await this.registerSocket(socket, identity.code, identity.playerId);
      return { success: true, data: await this.rooms.snapshot(identity.code, body.token) };
    }
    catch (error) { return this.failure(error); }
  }
  @SubscribeMessage('room:join') async join(@ConnectedSocket() socket: GameSocket, @MessageBody() body: { code: string; nickname: string }) {
    try { const data = await this.rooms.join(body.code, body.nickname); await this.registerSocket(socket, data.code, data.playerId); this.server.to(data.code).emit('room:updated', { serverNow: Date.now() }); return { success: true, data }; }
    catch (error) { return this.failure(error); }
  }
  @SubscribeMessage('room:leave') async leave(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command) {
    try { const data = await this.rooms.leave(body.code, body.token); await this.unregisterSocket(socket); await socket.leave(body.code.toUpperCase()); this.server.to(body.code.toUpperCase()).emit('room:updated', { serverNow: Date.now() }); return { success: true, data }; }
    catch (error) { return this.failure(error); }
  }
  @SubscribeMessage('player:remove') removePlayer(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command & { playerId: string }) { return this.run(socket, body, () => this.rooms.removePlayer(body.code, body.token, body.playerId)); }
  @SubscribeMessage('player:ready') ready(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command & { ready: boolean }) { return this.run(socket, body, () => this.rooms.ready(body.code, body.token, body.ready)); }
  @SubscribeMessage('game:start') start(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command & { testMode?: boolean }) { return this.run(socket, body, () => this.rooms.start(body.code, body.token, body.testMode ?? false)); }
  @SubscribeMessage('game:play_again') playAgain(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command) { return this.run(socket, body, () => this.rooms.playAgain(body.code, body.token)); }
  @SubscribeMessage('test:advance') advanceTest(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command) { return this.run(socket, body, () => this.rooms.advanceTest(body.code, body.token)); }
  @SubscribeMessage('role:acknowledge') acknowledge(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command) { return this.mutate(socket, body, (state, id) => this.rooms.gameEngine.acknowledge(state, id)); }
  @SubscribeMessage('team:submit') team(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command & { playerIds: string[] }) { return this.mutate(socket, body, (state, id) => this.rooms.gameEngine.submitTeam(state, id, body.playerIds)); }
  @SubscribeMessage('vote:submit') vote(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command & { approve: boolean }) { return this.mutate(socket, body, (state, id) => this.rooms.gameEngine.submitApproval(state, id, body.approve)); }
  @SubscribeMessage('quest:submit') quest(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command & { outcome: 'SUCCESS' | 'FAIL' }) { return this.mutate(socket, body, (state, id) => this.rooms.gameEngine.submitQuest(state, id, body.outcome)); }
  @SubscribeMessage('assassination:submit') assassination(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command & { targetId: string }) { return this.mutate(socket, body, (state, id) => this.rooms.gameEngine.assassinate(state, id, body.targetId)); }
  @SubscribeMessage('timer:pause') pause(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command) { return this.mutate(socket, body, (state, _id, host) => { if (!host) throw new Error('HOST_ONLY'); return this.rooms.gameEngine.pause(state); }); }
  @SubscribeMessage('timer:resume') resume(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command) { return this.mutate(socket, body, (state, _id, host) => { if (!host) throw new Error('HOST_ONLY'); return this.rooms.gameEngine.resume(state); }); }
  @SubscribeMessage('timer:extend') extend(@ConnectedSocket() socket: GameSocket, @MessageBody() body: Command & { seconds: 30 | 60 }) { return this.mutate(socket, body, (state, _id, host) => { if (!host) throw new Error('HOST_ONLY'); return this.rooms.gameEngine.extend(state, body.seconds); }); }

  private mutate(socket: GameSocket, body: Command, action: Parameters<RoomsService['mutate']>[2]) { return this.run(socket, body, () => this.rooms.mutate(body.code, body.token, action)); }
  private async run(socket: GameSocket, body: Command, action: () => Promise<unknown>) {
    try { const data = await action(); await socket.join(body.code.toUpperCase()); this.broadcastStateChanged(body.code, data); return { success: true, data }; }
    catch (error) { return this.failure(error); }
  }

  broadcastStateChanged(code: string, data?: unknown) {
    this.server.to(code.toUpperCase()).emit('game:phase_changed', { stateVersion: (data as any)?.public?.stateVersion, serverNow: Date.now() });
  }

  broadcastRoomUpdated(code: string) {
    this.server.to(code.toUpperCase()).emit('room:updated', { serverNow: Date.now() });
  }

  private async registerSocket(socket: GameSocket, code: string, playerId: string) {
    if (socket.data.playerId && socket.data.playerId !== playerId) await this.unregisterSocket(socket);
    socket.data.playerId = playerId;
    socket.data.roomCode = code;
    const sockets = this.playerSockets.get(playerId) ?? new Set<string>();
    sockets.add(socket.id);
    this.playerSockets.set(playerId, sockets);
    await socket.join(code);
    socket.to(code).emit('room:presence_changed', { playerId, connected: true, serverNow: Date.now() });
  }

  private async unregisterSocket(socket: GameSocket) {
    const playerId = socket.data.playerId as string | undefined;
    const code = socket.data.roomCode as string | undefined;
    if (!playerId) return;
    const sockets = this.playerSockets.get(playerId);
    sockets?.delete(socket.id);
    if (sockets?.size) return;
    this.playerSockets.delete(playerId);
    await this.rooms.setPlayerConnected(playerId, false);
    if (code) this.server.to(code).emit('room:presence_changed', { playerId, connected: false, serverNow: Date.now() });
  }

  private async expireAndBroadcast() {
    try {
      const codes = await this.rooms.expireDue();
      codes.forEach((code) => this.server.to(code).emit('game:phase_changed', { serverNow: Date.now(), cause: 'TIMER_EXPIRED' }));
    } catch { /* the next tick retries overdue sessions */ }
  }
  private failure(error: unknown) { const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR'; return { success: false, error: { code, message: code, details: null }, meta: { timestamp: new Date().toISOString() } }; }
}
