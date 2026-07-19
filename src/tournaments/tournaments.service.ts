import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { FINALIZE_JOB, SNAPSHOT_QUEUE } from './tournaments.constants';

@Injectable()
export class TournamentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectQueue(SNAPSHOT_QUEUE) private readonly snapshotQueue: Queue,
  ) {}

  async create(dto: CreateTournamentDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    const tournament = await this.prisma.tournament.create({
      data: { name: dto.name, startsAt, endsAt },
    });

    const delay = Math.max(0, endsAt.getTime() - Date.now());
    await this.snapshotQueue.add(
      FINALIZE_JOB,
      { tournamentId: tournament.id },
      { delay, jobId: tournament.id },
    );

    return tournament;
  }

  async getLeaderboard(tournamentId: string, limit: number, offset: number) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) {
      throw new NotFoundException(`Tournament ${tournamentId} not found`);
    }

    const page = await this.redis.getLeaderboardPage(tournamentId, offset, limit);

    return {
      tournamentId,
      limit,
      offset,
      entries: page.map((entry, index) => ({
        rank: offset + index + 1,
        playerId: entry.playerId,
        score: entry.score,
      })),
    };
  }
}
