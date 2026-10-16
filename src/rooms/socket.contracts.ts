export interface RoomCommand { code: string; token: string }
export interface SocketSuccess<T = unknown> { success: true; data: T }
export interface SocketFailure { success: false; error: { code: string; message: string; details: unknown }; meta: { timestamp: string } }
export type SocketResult<T = unknown> = SocketSuccess<T> | SocketFailure;
export type SocketAck<T = unknown> = (result: SocketResult<T>) => void;

export interface ClientToServerEvents {
  'room:join': (body: { code: string; nickname: string }, ack: SocketAck) => void;
  'room:leave': (body: RoomCommand, ack: SocketAck) => void;
  'player:remove': (body: RoomCommand & { playerId: string }, ack: SocketAck) => void;
  'player:ready': (body: RoomCommand & { ready: boolean }, ack: SocketAck) => void;
  'game:start': (body: RoomCommand & { testMode?: boolean }, ack: SocketAck) => void;
  'game:play_again': (body: RoomCommand, ack: SocketAck) => void;
  'test:advance': (body: RoomCommand, ack: SocketAck) => void;
  'role:acknowledge': (body: RoomCommand, ack: SocketAck) => void;
  'team:submit': (body: RoomCommand & { playerIds: string[] }, ack: SocketAck) => void;
  'vote:submit': (body: RoomCommand & { approve: boolean }, ack: SocketAck) => void;
  'quest:submit': (body: RoomCommand & { outcome: 'SUCCESS' | 'FAIL' }, ack: SocketAck) => void;
  'assassination:submit': (body: RoomCommand & { targetId: string }, ack: SocketAck) => void;
  'timer:pause': (body: RoomCommand, ack: SocketAck) => void;
  'timer:resume': (body: RoomCommand, ack: SocketAck) => void;
  'timer:extend': (body: RoomCommand & { seconds: 30 | 60 }, ack: SocketAck) => void;
  'game:sync': (body: RoomCommand, ack: SocketAck) => void;
}

export interface ServerToClientEvents {
  'connection:ready': (event: { serverNow: number }) => void;
  'room:updated': (event: { serverNow: number }) => void;
  'room:presence_changed': (event: { playerId: string; connected: boolean; serverNow: number }) => void;
  'game:phase_changed': (event: { stateVersion?: number; serverNow: number; cause?: 'TIMER_EXPIRED' }) => void;
  'game:public_snapshot': (snapshot: unknown) => void;
  'game:private_snapshot': (snapshot: unknown) => void;
  'role:private_info': (snapshot: unknown) => void;
  'timer:state': (snapshot: unknown) => void;
  'team:proposed': (snapshot: unknown) => void;
  'vote:progress': (snapshot: unknown) => void;
  'vote:result': (snapshot: unknown) => void;
  'quest:progress': (snapshot: unknown) => void;
  'quest:result': (snapshot: unknown) => void;
  'assassination:result': (snapshot: unknown) => void;
  'game:finished': (snapshot: unknown) => void;
  'player:disconnected': (event: { playerId: string }) => void;
  'player:reconnected': (event: { playerId: string }) => void;
  'error': (error: SocketFailure['error']) => void;
}
