import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { RoomsController } from './rooms/rooms.controller';
import { RoomsService } from './rooms/rooms.service';
import { GameGateway } from './rooms/game.gateway';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true })], controllers: [RoomsController], providers: [PrismaService, RoomsService, GameGateway] })
export class AppModule {}
