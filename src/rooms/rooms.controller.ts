import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApprovalDto, AssassinationDto, CreateRoomDto, JoinRoomDto, QuestDto, ReadyDto, StartGameDto, TeamDto, TimerDto, TokenDto } from './dto';
import { RoomsService } from './rooms.service';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}
  @Post() create(@Body() body: CreateRoomDto) { return this.rooms.create(body.nickname); }
  @Post('join') join(@Body() body: JoinRoomDto) { return this.rooms.join(body.code, body.nickname); }
  @Get(':code') lobby(@Param('code') code: string, @Query('token') token: string) { return this.rooms.lobby(code, token); }
  @Post(':code/ready') ready(@Param('code') code: string, @Body() body: ReadyDto) { return this.rooms.ready(code, body.token, body.ready); }
  @Post(':code/start') start(@Param('code') code: string, @Body() body: StartGameDto) { return this.rooms.start(code, body.token, body.testMode ?? false); }
  @Post(':code/test/advance') advanceTest(@Param('code') code: string, @Body() body: TokenDto) { return this.rooms.advanceTest(code, body.token); }
  @Post(':code/acknowledge') acknowledge(@Param('code') code: string, @Body() body: TokenDto) { return this.rooms.mutate(code, body.token, (state, playerId) => this.rooms.gameEngine.acknowledge(state, playerId)); }
  @Post(':code/team') team(@Param('code') code: string, @Body() body: TeamDto) { return this.rooms.mutate(code, body.token, (state, playerId) => this.rooms.gameEngine.submitTeam(state, playerId, body.playerIds)); }
  @Post(':code/vote') vote(@Param('code') code: string, @Body() body: ApprovalDto) { return this.rooms.mutate(code, body.token, (state, playerId) => this.rooms.gameEngine.submitApproval(state, playerId, body.approve)); }
  @Post(':code/quest') quest(@Param('code') code: string, @Body() body: QuestDto) { return this.rooms.mutate(code, body.token, (state, playerId) => this.rooms.gameEngine.submitQuest(state, playerId, body.outcome)); }
  @Post(':code/assassinate') assassinate(@Param('code') code: string, @Body() body: AssassinationDto) { return this.rooms.mutate(code, body.token, (state, playerId) => this.rooms.gameEngine.assassinate(state, playerId, body.targetId)); }
  @Post(':code/timer/pause') pause(@Param('code') code: string, @Body() body: TimerDto) { return this.rooms.mutate(code, body.token, (state, _playerId, host) => { if (!host) throw new Error('HOST_ONLY'); return this.rooms.gameEngine.pause(state); }); }
  @Post(':code/timer/resume') resume(@Param('code') code: string, @Body() body: TimerDto) { return this.rooms.mutate(code, body.token, (state, _playerId, host) => { if (!host) throw new Error('HOST_ONLY'); return this.rooms.gameEngine.resume(state); }); }
  @Post(':code/timer/extend') extend(@Param('code') code: string, @Body() body: TimerDto) { return this.rooms.mutate(code, body.token, (state, _playerId, host) => { if (!host) throw new Error('HOST_ONLY'); return this.rooms.gameEngine.extend(state, body.seconds ?? 30); }); }
}
