import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';

describe('TournamentsService', () => {
  let prisma: any;
  let redis: any;
  let queue: any;
  let service: TournamentsService;

  beforeEach(() => {
    prisma = {
      tournament: { create: jest.fn(), findUnique: jest.fn() },
    };
    redis = { getLeaderboardPage: jest.fn() };
    queue = { add: jest.fn() };
    service = new TournamentsService(prisma, redis, queue);
  });

  it('creates a tournament and schedules a finalize job at endsAt', async () => {
    const tournament = { id: 't1', name: 'Cup', startsAt: new Date(), endsAt: new Date(Date.now() + 60000) };
    prisma.tournament.create.mockResolvedValue(tournament);

    await service.create({
      name: 'Cup',
      startsAt: tournament.startsAt.toISOString(),
      endsAt: tournament.endsAt.toISOString(),
    });

    expect(queue.add).toHaveBeenCalledWith(
      'finalize',
      { tournamentId: 't1' },
      expect.objectContaining({ jobId: 't1' }),
    );
  });

  it('returns the leaderboard sorted DESC by score with ranks offset correctly', async () => {
    prisma.tournament.findUnique.mockResolvedValue({ id: 't1' });
    redis.getLeaderboardPage.mockResolvedValue([
      { playerId: 'p_top', score: 900 },
      { playerId: 'p_second', score: 500 },
    ]);

    const result = await service.getLeaderboard('t1', 2, 10);

    expect(redis.getLeaderboardPage).toHaveBeenCalledWith('t1', 10, 2);
    expect(result.entries).toEqual([
      { rank: 11, playerId: 'p_top', score: 900 },
      { rank: 12, playerId: 'p_second', score: 500 },
    ]);
  });

  it('throws NotFoundException for an unknown tournament', async () => {
    prisma.tournament.findUnique.mockResolvedValue(null);

    await expect(service.getLeaderboard('missing', 20, 0)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a tournament whose endsAt is not after startsAt', async () => {
    const now = new Date();

    await expect(
      service.create({
        name: 'Bad Cup',
        startsAt: now.toISOString(),
        endsAt: now.toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.tournament.create).not.toHaveBeenCalled();
  });
});
