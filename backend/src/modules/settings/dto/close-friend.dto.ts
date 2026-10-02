import { ApiProperty } from '@nestjs/swagger';

export class CloseFriendDto {
  @ApiProperty() coreUserId!: string;
  @ApiProperty() createdAt!: string;
}
