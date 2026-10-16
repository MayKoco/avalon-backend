import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateRoomDto {
  @IsString() @Length(1, 24) nickname!: string;
}

export class JoinRoomDto {
  @IsString() @Matches(/^[A-Z0-9]{6}$/) code!: string;
  @IsString() @Length(1, 24) nickname!: string;
}

export class TokenDto { @IsString() @Length(20, 200) token!: string }
export class ReadyDto extends TokenDto { @IsBoolean() ready!: boolean }
export class TeamDto extends TokenDto { @IsString({ each: true }) playerIds!: string[] }
export class ApprovalDto extends TokenDto { @IsBoolean() approve!: boolean }
export class QuestDto extends TokenDto { @IsIn(['SUCCESS', 'FAIL']) outcome!: 'SUCCESS' | 'FAIL' }
export class AssassinationDto extends TokenDto { @IsString() targetId!: string }
export class TimerDto extends TokenDto { @IsOptional() @IsIn([30, 60]) seconds?: 30 | 60 }
