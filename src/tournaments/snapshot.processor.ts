import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SNAPSHOT_QUEUE } from './tournaments.constants';

interface FinalizeJobData {
  tournamentId: string;
}

@Processor(SNAPSHOT_QUEUE)
export class SnapshotProcessor extends WorkerHost {
  private readonly logger = new Logger(SnapshotProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    super();
  }

  async process(job: Job<FinalizeJobData>): Promise<void> {
    const { tournamentId } = job.data;

    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament || tournament.status === 'FINALIZED') {
      return;
    }

    const standings = await this.redis.getFullLeaderboard(tournamentId);

    await this.prisma.$transaction([
      ...standings.map((entry, index) =>
        this.prisma.tournamentPlacement.upsert({
          where: { tournamentId_playerId: { tournamentId, playerId: entry.playerId } },
          create: { tournamentId, playerId: entry.playerId, score: entry.score, rank: index + 1 },
          update: { score: entry.score, rank: index + 1 },
        }),
      ),
      this.prisma.tournament.update({
        where: { id: tournamentId },
        data: { status: 'FINALIZED' },
      }),
    ]);

    this.logger.log(`Finalized tournament ${tournamentId} with ${standings.length} placements`);
  }
}
