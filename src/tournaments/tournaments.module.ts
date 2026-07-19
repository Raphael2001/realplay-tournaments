import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { SnapshotProcessor } from './snapshot.processor';
import { SNAPSHOT_QUEUE } from './tournaments.constants';

@Module({
  imports: [BullModule.registerQueue({ name: SNAPSHOT_QUEUE })],
  controllers: [TournamentsController],
  providers: [TournamentsService, SnapshotProcessor],
  exports: [TournamentsService],
})
export class TournamentsModule {}
