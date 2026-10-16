import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApprovalDto, AssassinationDto, CreateRoomDto, JoinRoomDto, QuestDto, ReadyDto, StartGameDto, TeamDto, TimerDto, TokenDto } from './dto';
import { RoomsService } from './rooms.service';
import { GameGateway } from './game.gateway';

@Controller('rooms')
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService, @Inject(GameGateway) private readonly gateway: GameGateway) {}
  @Post() create(@Body() body: CreateRoomDto) { return this.rooms.create(body.nickname); }
  @Post('join') async join(@Body() body: JoinRoomDto) { const data = await this.rooms.join(body.code, body.nickname); this.gateway.broadcastRoomUpdated(data.code); return data; }
  @Get(':code') lobby(@Param('code') code: string, @Query('token') token: string) { return this.rooms.lobby(code, token); }
  @Get(':code/snapshot') snapshot(@Param('code') code: string, @Query('token') token: string) { return this.rooms.snapshot(code, token); }
  @Post(':code/ready') async ready(@Param('code') code: string, @Body() body: ReadyDto) { const data = await this.rooms.ready(code, body.token, body.ready); this.gateway.broadcastRoomUpdated(code); return data; }
  @Post(':code/leave') async leave(@Param('code') code: string, @Body() body: TokenDto) { const data = await this.rooms.leave(code, body.token); this.gateway.broadcastRoomUpdated(code); return data; }
  @Post(':code/players/:playerId/remove') removePlayer(@Param('code') code: string, @Param('playerId') playerId: string, @Body() body: TokenDto) { return this.roomChange(code, () => this.rooms.removePlayer(code, body.token, playerId)); }
  @Post(':code/start') start(@Param('code') code: string, @Body() body: StartGameDto) { return this.stateChange(code, () => this.rooms.start(code, body.token, body.testMode ?? false)); }
  @Post(':code/play-again') playAgain(@Param('code') code: string, @Body() body: TokenDto) { return this.roomChange(code, () => this.rooms.playAgain(code, body.token)); }
  @Post(':code/test/advance') advanceTest(@Param('code') code: string, @Body() body: TokenDto) { return this.stateChange(code, () => this.rooms.advanceTest(code, body.token)); }
  @Post(':code/acknowledge') acknowledge(@Param('code') code: string, @Body() body: TokenDto) { return this.stateChange(code, () => this.rooms.mutate(code, body.token, (state, playerId) => this.rooms.gameEngine.acknowledge(state, playerId))); }
  @Post(':code/team') team(@Param('code') code: string, @Body() body: TeamDto) { return this.stateChange(code, () => this.rooms.mutate(code, body.token, (state, playerId) => this.rooms.gameEngine.submitTeam(state, playerId, body.playerIds))); }
  @Post(':code/vote') vote(@Param('code') code: string, @Body() body: ApprovalDto) { return this.stateChange(code, () => this.rooms.mutate(code, body.token, (state, playerId) => this.rooms.gameEngine.submitApproval(state, playerId, body.approve))); }
  @Post(':code/quest') quest(@Param('code') code: string, @Body() body: QuestDto) { return this.stateChange(code, () => this.rooms.mutate(code, body.token, (state, playerId) => this.rooms.gameEngine.submitQuest(state, playerId, body.outcome))); }
  @Post(':code/assassinate') assassinate(@Param('code') code: string, @Body() body: AssassinationDto) { return this.stateChange(code, () => this.rooms.mutate(code, body.token, (state, playerId) => this.rooms.gameEngine.assassinate(state, playerId, body.targetId))); }
  @Post(':code/timer/pause') pause(@Param('code') code: string, @Body() body: TimerDto) { return this.stateChange(code, () => this.rooms.mutate(code, body.token, (state, _playerId, host) => { if (!host) throw new Error('HOST_ONLY'); return this.rooms.gameEngine.pause(state); })); }
  @Post(':code/timer/resume') resume(@Param('code') code: string, @Body() body: TimerDto) { return this.stateChange(code, () => this.rooms.mutate(code, body.token, (state, _playerId, host) => { if (!host) throw new Error('HOST_ONLY'); return this.rooms.gameEngine.resume(state); })); }
  @Post(':code/timer/extend') extend(@Param('code') code: string, @Body() body: TimerDto) { return this.stateChange(code, () => this.rooms.mutate(code, body.token, (state, _playerId, host) => { if (!host) throw new Error('HOST_ONLY'); return this.rooms.gameEngine.extend(state, body.seconds ?? 30); })); }

  private async stateChange(code: string, action: () => Promise<unknown>) { const data = await action(); this.gateway.broadcastStateChanged(code, data); return data; }
  private async roomChange(code: string, action: () => Promise<unknown>) { const data = await action(); this.gateway.broadcastRoomUpdated(code); return data; }
}
