import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateBetDto } from './dto/create-bet.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class BetsService {
  private readonly logger = new Logger(BetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async processBet(dto: CreateBetDto) {
    // externalBetId is globally unique: resending the same event returns
    // the original row instead of creating a second one.
    const bet = await this.prisma.bet.upsert({
      where: { externalBetId: dto.externalBetId },
      update: {},
      create: {
        externalBetId: dto.externalBetId,
        playerId: dto.playerId,
        amount: dto.amount,
        currency: dto.currency,
        createdAt: new Date(dto.createdAt),
      },
    });

    // status: ACTIVE excludes tournaments already finalized by the snapshot
    // job — a late-arriving event whose createdAt falls in the window but
    // shows up after endsAt must not reopen a tournament whose placements
    // are already written to Postgres.
    const activeTournaments = await this.prisma.tournament.findMany({
      where: {
        status: 'ACTIVE',
        startsAt: { lte: bet.createdAt },
        endsAt: { gte: bet.createdAt },
      },
    });

    let acceptedCount = 0;

    for (const tournament of activeTournaments) {
      try {
        await this.prisma.tournamentBet.create({
          data: {
            tournamentId: tournament.id,
            betId: bet.id,
            playerId: bet.playerId,
            amount: bet.amount,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === UNIQUE_CONSTRAINT_VIOLATION
        ) {
          // Already counted for this tournament — idempotent no-op.
          continue;
        }
        throw error;
      }

      await this.redis.incrementScore(tournament.id, bet.playerId, bet.amount);
      acceptedCount += 1;
    }

    this.logger.debug(
      `Bet ${bet.externalBetId} accepted into ${acceptedCount}/${activeTournaments.length} active tournaments`,
    );

    return { success: true, betId: bet.id, acceptedTournaments: acceptedCount };
  }
}
