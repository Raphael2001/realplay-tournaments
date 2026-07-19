import { IsDateString, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class CreateBetDto {
  @IsString()
  @IsNotEmpty()
  externalBetId!: string;

  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsDateString()
  createdAt!: string;
}
