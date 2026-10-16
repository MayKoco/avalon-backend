import { Inject, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomsService } from './rooms.service';

type Command = { code: string; token: string; [key: string]: unknown };

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnApplicationBootstrap, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private expiryInterval?: NodeJS.Timeout;
  private readonly playerSockets = new Map<string, Set<string>>();
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}
  async onApplicationBootstrap() {
    await this.rooms.resetConnections();
    await this.expireAndBroadcast();
    this.expiryInterval = setInterval(() => void this.expireAndBroadcast(), 1000);
    this.expiryInterval.unref();
  }
  handleConnection(socket: Socket) { socket.emit('connection:ready', { serverNow: Date.now() }); }
  handleDisconnect(socket: Socket) { void this.unregisterSocket(socket).catch(() => undefined); }
  onModuleDestroy() { if (this.expiryInterval) clearInterval(this.expiryInterval); }

  @SubscribeMessage('game:sync') async sync(@ConnectedSocket() socket: Socket, @MessageBody() body: Command) {
    try {
      const identity = await this.rooms.setConnected(body.code, body.token, true);
      await this.registerSocket(socket, identity.code, identity.playerId);
      return { success: true, data: await this.rooms.snapshot(identity.code, body.token) };
    }
    catch (error) { return this.failure(error); }
  }
  @SubscribeMessage('player:ready') ready(@ConnectedSocket() socket: Socket, @MessageBody() body: Command & { ready: boolean }) { return this.run(socket, body, () => this.rooms.ready(body.code, body.token, body.ready)); }
  @SubscribeMessage('game:start') start(@ConnectedSocket() socket: Socket, @MessageBody() body: Command & { testMode?: boolean }) { return this.run(socket, body, () => this.rooms.start(body.code, body.token, body.testMode ?? false)); }
  @SubscribeMessage('test:advance') advanceTest(@ConnectedSocket() socket: Socket, @MessageBody() body: Command) { return this.run(socket, body, () => this.rooms.advanceTest(body.code, body.token)); }
  @SubscribeMessage('role:acknowledge') acknowledge(@ConnectedSocket() socket: Socket, @MessageBody() body: Command) { return this.mutate(socket, body, (state, id) => this.rooms.gameEngine.acknowledge(state, id)); }
  @SubscribeMessage('team:submit') team(@ConnectedSocket() socket: Socket, @MessageBody() body: Command & { playerIds: string[] }) { return this.mutate(socket, body, (state, id) => this.rooms.gameEngine.submitTeam(state, id, body.playerIds)); }
  @SubscribeMessage('vote:submit') vote(@ConnectedSocket() socket: Socket, @MessageBody() body: Command & { approve: boolean }) { return this.mutate(socket, body, (state, id) => this.rooms.gameEngine.submitApproval(state, id, body.approve)); }
  @SubscribeMessage('quest:submit') quest(@ConnectedSocket() socket: Socket, @MessageBody() body: Command & { outcome: 'SUCCESS' | 'FAIL' }) { return this.mutate(socket, body, (state, id) => this.rooms.gameEngine.submitQuest(state, id, body.outcome)); }
  @SubscribeMessage('assassination:submit') assassination(@ConnectedSocket() socket: Socket, @MessageBody() body: Command & { targetId: string }) { return this.mutate(socket, body, (state, id) => this.rooms.gameEngine.assassinate(state, id, body.targetId)); }

  private mutate(socket: Socket, body: Command, action: Parameters<RoomsService['mutate']>[2]) { return this.run(socket, body, () => this.rooms.mutate(body.code, body.token, action)); }
  private async run(socket: Socket, body: Command, action: () => Promise<unknown>) {
    try { const data = await action(); await socket.join(body.code.toUpperCase()); this.server.to(body.code.toUpperCase()).emit('game:phase_changed', { stateVersion: (data as any)?.public?.stateVersion, serverNow: Date.now() }); return { success: true, data }; }
    catch (error) { return this.failure(error); }
  }

  private async registerSocket(socket: Socket, code: string, playerId: string) {
    if (socket.data.playerId && socket.data.playerId !== playerId) await this.unregisterSocket(socket);
    socket.data.playerId = playerId;
    socket.data.roomCode = code;
    const sockets = this.playerSockets.get(playerId) ?? new Set<string>();
    sockets.add(socket.id);
    this.playerSockets.set(playerId, sockets);
    await socket.join(code);
    socket.to(code).emit('room:presence_changed', { playerId, connected: true, serverNow: Date.now() });
  }

  private async unregisterSocket(socket: Socket) {
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
