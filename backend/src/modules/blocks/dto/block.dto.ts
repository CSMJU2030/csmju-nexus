import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export const CORE_USER_ID_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;

export class CreateBlockDto {
  @ApiProperty({ example: '6700001999-somchai' })
  @IsString()
  @Matches(CORE_USER_ID_PATTERN, {
    message: 'coreUserId ไม่ถูกต้องตามรูปแบบของระบบกลาง',
  })
  coreUserId!: string;
}

export class BlockDto {
  @ApiProperty({ description: 'คนที่ผู้เรียกบล็อกไว้' }) coreUserId!: string;
  @ApiProperty() createdAt!: string;
}
