import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Post()
  create(@Body() dto: CreateTournamentDto) {
    return this.tournamentsService.create(dto);
  }

  @Get(':id/leaderboard')
  getLeaderboard(@Param('id') id: string, @Query() query: LeaderboardQueryDto) {
    return this.tournamentsService.getLeaderboard(id, query.limit, query.offset);
  }
}
