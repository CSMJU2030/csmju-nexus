import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationMeta } from './envelope.js';

/// Query มาตรฐานของทุก list endpoint
///
///   GET /api/v1/reels?page=2&limit=50
///
/// ชื่อ `limit` มาจาก contracts/vocabulary.json (`paginationQuery`)
/// **เดิมใช้ชื่อแบบเก่า ตามสัญญาฉบับที่ถูกยกเลิกไปแล้ว** — CHANGELOG 1.0.0
/// ระบุการเปลี่ยนนี้ไว้ตรง ๆ และกฎ `API-07` ตีตกถ้ายังเจอคำเดิม
export class PaginationQuery {
  @ApiPropertyOptional({ minimum: 1, default: 1, example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'page ต้องเริ่มที่ 1' })
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20, example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit ต้องเป็นจำนวนเต็ม' })
  @Min(1)
  @Max(100, { message: 'limit สูงสุด 100 รายการ' })
  limit: number = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }

  get take(): number {
    return this.limit;
  }

  meta(total: number): PaginationMeta {
    return {
      total,
      page: this.page,
      limit: this.limit,

      // ไม่มีข้อมูลเลย = 0 หน้า ไม่ใช่ 1 หน้าที่ว่างเปล่า
      // (api-conventions.md ข้อ 5 ยกตัวอย่างไว้ชัดว่า totalPages เป็น 0)
      // เดิมโค้ดนี้ครอบด้วย Math.max(1, …) ซึ่งทำให้หน้าบ้านวาดตัวเลือกหน้า
      // ขึ้นมาหนึ่งหน้าทั้งที่ไม่มีอะไรให้ดู
      totalPages: Math.ceil(total / this.limit),
    };
  }
}
