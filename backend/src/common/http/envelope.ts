import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { map, Observable } from 'rxjs';

/// Standard Envelope (Blueprint หน้า 7) — ทุก response ต้องมีรูปนี้เท่านั้น
///
///   { "success": true, "data": [...], "meta": { total, page, limit, totalPages } }
///
/// ชื่อฟิลด์ของ meta ถูกล็อกไว้ที่ contracts/vocabulary.json (`collectionMeta`)
/// ห้ามเพิ่ม ห้ามเปลี่ยนชื่อ เพราะระบบย่อยอื่นอ่าน contract เดียวกันนี้

export class PaginationMeta {
  @ApiProperty({ example: 2480 })
  total!: number;

  @ApiProperty({ example: 2 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 50 })
  totalPages!: number;
}

export interface Envelope<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

/// ผลลัพธ์ที่ service คืนมาเมื่อเป็น list แบบแบ่งหน้า
export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly meta: PaginationMeta,
  ) {}
}

/// หุ้ม response ทุกตัวด้วย envelope มาตรฐานโดยที่ controller ไม่ต้องรู้เรื่อง
/// controller คืน object หรือ Paginated ธรรมดา แล้วชั้นนี้จัดรูปให้
@Injectable()
export class EnvelopeInterceptor<T>
  implements NestInterceptor<T, Envelope<unknown>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<Envelope<unknown>> {
    // envelope เป็นมาตรฐานของ REST (Blueprint หน้า 7) ไม่ใช่ของ WebSocket
    // ack ของ socket มีสัญญาของตัวเองอยู่ใน common/realtime/events.ts
    // ถ้าห่อ ack ด้วย ที่หน้าบ้านจะได้ {success,data:{ok}} แทน {ok} แล้วพัง
    if (context.getType() !== 'http') {
      return next.handle() as Observable<Envelope<unknown>>;
    }

    return next.handle().pipe(
      map((payload) => {
        if (payload instanceof Paginated) {
          return {
            success: true as const,
            data: payload.items,
            meta: payload.meta,
          };
        }

        return { success: true as const, data: payload ?? null };
      }),
    );
  }
}
