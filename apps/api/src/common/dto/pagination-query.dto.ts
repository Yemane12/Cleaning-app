import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Bounded paging for admin list endpoints. `take` is capped so a single call cannot pull the whole queue. */
export class PaginationQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  take: number = 25;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  skip: number = 0;
}
