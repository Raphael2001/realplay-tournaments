import { Body, Controller, Post } from '@nestjs/common';
import { BetsService } from './bets.service';
import { CreateBetDto } from './dto/create-bet.dto';

@Controller('bet')
export class BetsController {
  constructor(private readonly betsService: BetsService) {}

  @Post()
  create(@Body() dto: CreateBetDto) {
    return this.betsService.processBet(dto);
  }
}
