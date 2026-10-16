import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomsService } from './rooms.service';

type Command = { code: string; token: string; [key: string]: unknown };

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer() server!: Server;
  constructor(private readonly rooms: RoomsService) {}
  afterInit() {
    setInterval(() => void this.rooms.expireDue().then((codes) => codes.forEach((code) => this.server.to(code).emit('game:phase_changed', { serverNow: Date.now(), cause: 'TIMER_EXPIRED' }))).catch(() => undefined), 1000).unref();
  }
  handleConnection(socket: Socket) { socket.emit('connection:ready', { serverNow: Date.now() }); }
  handleDisconnect(_socket: Socket) {}

  @SubscribeMessage('game:sync') async sync(@ConnectedSocket() socket: Socket, @MessageBody() body: Command) {
    try { await socket.join(body.code.toUpperCase()); return { success: true, data: await this.rooms.snapshot(body.code, body.token) }; }
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
    try { const data = await action(); await socket.join(body.code.toUpperCase()); this.server.to(body.code.toUpperCase()).emit('game:phase_changed', { stateVersion: (data as any)?.public?.phaseVersion, serverNow: Date.now() }); return { success: true, data }; }
    catch (error) { return this.failure(error); }
  }
  private failure(error: unknown) { const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR'; return { success: false, error: { code, message: code, details: null }, meta: { timestamp: new Date().toISOString() } }; }
}
