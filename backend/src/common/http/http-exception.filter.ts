import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/// รูปแบบ error ที่คู่กับ Standard Envelope
///
///   { "success": false, "error": { "code": "...", "message": "...", "details": [...] } }
///
/// ข้อความต้องบอกว่าเกิดอะไรและแก้อย่างไร ไม่ใช่แค่ "Bad Request"
/// เพราะ frontend ของระบบย่อยอื่นก็อ่าน error นี้เหมือนกัน
///
/// **log เฉพาะ `request.path`** ห้าม `url`/`originalUrl` — query ของ
/// /auth/callback มี token และ query ของการค้นหาอาจมีชื่อคน
/// (auth-contract.md ข้อ 5.1 · logging.md ข้อ 3)
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request | undefined>();

    const { status, body, retryAfterSec } = this.render(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // รายละเอียดเต็มอยู่ใน log ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่ส่งออกไปกับคำตอบ
      this.logger.error(
        JSON.stringify({
          event: 'request.unhandled_error',
          method: request?.method,
          path: request?.path,
          status,
        }),
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // handler ที่ตอบไปแล้วรับคำตอบ error ซ้ำอีกไม่ได้
    if (response.headersSent) return;

    // contracts/error-codes.json: 429 กับ 503 ต้องบอกผู้เรียกว่ารอกี่วินาที
    if (retryAfterSec !== null) {
      response.setHeader('Retry-After', String(retryAfterSec));
    }

    response.status(status).json(body);
  }

  private render(exception: unknown): {
    status: number;
    body: unknown;
    retryAfterSec: number | null;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const details = this.detailsFrom(raw);

      return {
        status,
        body: {
          success: false,
          error: {
            code: this.codeFor(status, details),
            message: this.messageFrom(raw, exception.message),
            details,
          },
        },
        retryAfterSec: needsRetryAfter(status) ? retryAfterFrom(raw) : null,
      };
    }

    // ฐานข้อมูลไม่พร้อมชั่วคราว (pool เต็ม) — 503 ให้ผู้เรียกลองใหม่ได้
    // **เฉพาะกรณีนี้เท่านั้น** error อื่นของ Prisma คือบั๊ก ต้องเป็น 500
    // เพราะ 503 สั่งให้ลองคำขอเดิมซ้ำ ซึ่งแค่ทำบั๊กซ้ำ (api-conventions.md ข้อ 4)
    if (isPoolTimeout(exception)) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        body: {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'ระบบมีผู้ใช้งานมากชั่วขณะ กรุณาลองใหม่อีกครั้งในไม่กี่วินาที',
            details: [],
          },
        },
        retryAfterSec: POOL_RETRY_AFTER_SEC,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
          details: [],
        },
      },
      retryAfterSec: null,
    };
  }

  /// รหัสข้อผิดพลาด — **enum ปิด 9 ค่า** ตาม contracts/error-codes.json
  ///
  /// "A subsystem MUST NOT invent error codes outside this list" — status
  /// ที่ไม่มีรหัสของตัวเอง (เช่น 413) ยุบเข้ารหัสที่ใกล้ที่สุด ไม่คิดชื่อใหม่
  private codeFor(status: number, details: string[]): string {
    // 400 แยกสองแบบ: ValidationPipe ส่ง message มาเป็น array เสมอ จึงใช้
    // การมี details เป็นตัวชี้ว่าเป็นการตรวจ body/query ตกจริง
    if (status === HttpStatus.BAD_REQUEST) {
      return details.length > 0 ? 'VALIDATION_ERROR' : 'BAD_REQUEST';
    }

    const map: Record<number, string> = {
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',

      // ไม่มีรหัสของตัวเองในรายการปิด — "คำขอนี้ใช้ไม่ได้" ไม่ใช่ "ระบบพัง"
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'BAD_REQUEST',
    };

    return map[status] ?? 'INTERNAL_ERROR';
  }

  private messageFrom(body: unknown, fallback: string): string {
    if (typeof body === 'string') return body;

    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message: unknown }).message;

      if (typeof message === 'string') return message;

      if (Array.isArray(message) && message.length > 0) {
        return String(message[0]);
      }
    }

    return fallback;
  }

  private detailsFrom(body: unknown): string[] {
    if (
      body &&
      typeof body === 'object' &&
      'message' in body &&
      Array.isArray((body as { message: unknown }).message)
    ) {
      return (body as { message: unknown[] }).message.map(String);
    }

    return [];
  }
}

/// ค่าเริ่มต้นเมื่อผู้โยน 429/503 ไม่ได้บอกเวลารอมาเอง
const DEFAULT_RETRY_AFTER_SEC = 30;

/// pool เต็มมักคลายภายในไม่กี่วินาที
const POOL_RETRY_AFTER_SEC = 5;

function needsRetryAfter(status: number): boolean {
  return (
    status === HttpStatus.TOO_MANY_REQUESTS ||
    status === HttpStatus.SERVICE_UNAVAILABLE
  );
}

/// ผู้โยนกำหนดเวลารอได้ด้วย `{ message, retryAfterSec }` ใน body ของ exception
/// เป็นวินาทีเต็ม อย่างน้อย 1 (api-conventions.md ข้อ 4)
function retryAfterFrom(body: unknown): number {
  const value =
    body && typeof body === 'object' && 'retryAfterSec' in body
      ? Number((body as { retryAfterSec: unknown }).retryAfterSec)
      : NaN;

  const seconds = Number.isFinite(value) ? value : DEFAULT_RETRY_AFTER_SEC;

  return Math.max(1, Math.ceil(seconds));
}

/// Prisma `P2024` = รอ connection จาก pool จนหมดเวลา
///
/// ตรวจแบบ duck typing (ชื่อคลาสขึ้นต้นด้วย Prisma + code) แทน `instanceof`
/// เพราะ client ที่ generate ไว้ใน src/generated มีคลาส error ของตัวเอง
/// ซึ่งไม่ใช่ตัวเดียวกับใน @prisma/client
function isPoolTimeout(exception: unknown): boolean {
  if (!exception || typeof exception !== 'object') return false;

  const candidate = exception as { code?: unknown; name?: unknown };

  return (
    candidate.code === 'P2024' &&
    typeof candidate.name === 'string' &&
    candidate.name.startsWith('Prisma')
  );
}
