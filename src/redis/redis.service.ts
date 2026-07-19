import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
    });
  }

  leaderboardKey(tournamentId: string): string {
    return `leaderboard:${tournamentId}`;
  }

  async incrementScore(tournamentId: string, playerId: string, amount: number): Promise<void> {
    await this.zincrby(this.leaderboardKey(tournamentId), amount, playerId);
  }

  async getLeaderboardPage(
    tournamentId: string,
    offset: number,
    limit: number,
  ): Promise<{ playerId: string; score: number }[]> {
    const raw = await this.zrevrange(
      this.leaderboardKey(tournamentId),
      offset,
      offset + limit - 1,
      'WITHSCORES',
    );

    const result: { playerId: string; score: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      result.push({ playerId: raw[i], score: Number(raw[i + 1]) });
    }
    return result;
  }

  async getFullLeaderboard(tournamentId: string): Promise<{ playerId: string; score: number }[]> {
    const raw = await this.zrevrange(this.leaderboardKey(tournamentId), 0, -1, 'WITHSCORES');
    const result: { playerId: string; score: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      result.push({ playerId: raw[i], score: Number(raw[i + 1]) });
    }
    return result;
  }

  async onModuleDestroy() {
    this.disconnect();
  }
}
