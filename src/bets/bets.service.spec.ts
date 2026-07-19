import { Prisma } from '@prisma/client';
import { BetsService } from './bets.service';

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

describe('BetsService', () => {
  let prisma: any;
  let redis: any;
  let service: BetsService;

  const tournament = { id: 't1', startsAt: new Date('2026-01-01'), endsAt: new Date('2026-01-31') };
  const betCreatedAt = new Date('2026-01-15');

  beforeEach(() => {
    prisma = {
      bet: { upsert: jest.fn() },
      tournament: { findMany: jest.fn() },
      tournamentBet: { create: jest.fn() },
    };
    redis = { incrementScore: jest.fn() };
    service = new BetsService(prisma, redis);
  });

  it('accepts a new bet into a matching active tournament and increments the score once', async () => {
    prisma.bet.upsert.mockResolvedValue({
      id: 'bet1',
      externalBetId: 'ext_1',
      playerId: 'player_1',
      amount: 250,
      createdAt: betCreatedAt,
    });
    prisma.tournament.findMany.mockResolvedValue([tournament]);
    prisma.tournamentBet.create.mockResolvedValue({});

    const result = await service.processBet({
      externalBetId: 'ext_1',
      playerId: 'player_1',
      amount: 250,
      currency: 'USD',
      createdAt: betCreatedAt.toISOString(),
    });

    expect(prisma.tournament.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
    expect(prisma.tournamentBet.create).toHaveBeenCalledTimes(1);
    expect(redis.incrementScore).toHaveBeenCalledWith('t1', 'player_1', 250);
    expect(result).toEqual({ success: true, betId: 'bet1', acceptedTournaments: 1 });
  });

  it('treats a duplicate externalBetId as idempotent and does not double count the score', async () => {
    prisma.bet.upsert.mockResolvedValue({
      id: 'bet1',
      externalBetId: 'ext_1',
      playerId: 'player_1',
      amount: 250,
      createdAt: betCreatedAt,
    });
    prisma.tournament.findMany.mockResolvedValue([tournament]);
    prisma.tournamentBet.create.mockRejectedValue(uniqueConstraintError());

    const result = await service.processBet({
      externalBetId: 'ext_1',
      playerId: 'player_1',
      amount: 250,
      currency: 'USD',
      createdAt: betCreatedAt.toISOString(),
    });

    expect(redis.incrementScore).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, betId: 'bet1', acceptedTournaments: 0 });
  });

  it('skips tournaments whose window does not contain the bet createdAt', async () => {
    prisma.bet.upsert.mockResolvedValue({
      id: 'bet1',
      externalBetId: 'ext_1',
      playerId: 'player_1',
      amount: 250,
      createdAt: betCreatedAt,
    });
    prisma.tournament.findMany.mockResolvedValue([]);

    const result = await service.processBet({
      externalBetId: 'ext_1',
      playerId: 'player_1',
      amount: 250,
      currency: 'USD',
      createdAt: betCreatedAt.toISOString(),
    });

    expect(prisma.tournamentBet.create).not.toHaveBeenCalled();
    expect(redis.incrementScore).not.toHaveBeenCalled();
    expect(result.acceptedTournaments).toBe(0);
  });
});
