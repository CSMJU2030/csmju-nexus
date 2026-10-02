import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter.js';

/// error envelope · รหัสปิด 9 ค่า · Retry-After (api-conventions.md ข้อ 4)

function run(exception: unknown) {
  const headers: Record<string, string> = {};
  const response = {
    headersSent: false,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const request = { method: 'GET', path: '/api/v1/reels', url: '/api/v1/reels?q=ชื่อคน' };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;

  const filter = new HttpExceptionFilter();
  const errorLog = vi
    .spyOn((filter as unknown as { logger: { error: (...args: unknown[]) => void } }).logger, 'error')
    .mockImplementation(() => undefined);

  filter.catch(exception, host);

  return {
    status: response.status.mock.calls[0]?.[0] as number,
    body: response.json.mock.calls[0]?.[0] as { error: { code: string } },
    headers,
    logged: errorLog.mock.calls.map((call) => String(call[0])).join('\n'),
  };
}

describe('HttpExceptionFilter', () => {
  it('429 → TOO_MANY_REQUESTS พร้อม Retry-After', () => {
    const result = run(
      new HttpException({ message: 'ส่งถี่เกินไป', retryAfterSec: 7.2 }, 429),
    );

    expect(result.status).toBe(429);
    expect(result.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(result.headers['Retry-After']).toBe('8');
  });

  it('503 → SERVICE_UNAVAILABLE พร้อม Retry-After ค่าเริ่มต้น', () => {
    const result = run(new ServiceUnavailableException('ที่เก็บไฟล์ไม่พร้อมใช้งาน'));

    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(Number(result.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
  });

  it('Prisma P2024 (pool เต็ม) → 503 + Retry-After', () => {
    const poolTimeout = Object.assign(new Error('Timed out fetching a new connection'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2024',
    });
    const result = run(poolTimeout);

    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(result.headers['Retry-After']).toBe('5');
  });

  it('error อื่นของ Prisma คือบั๊ก → 500 ไม่ใช่ 503', () => {
    const bug = Object.assign(new Error('Unique constraint'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });
    const result = run(bug);

    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
    expect(result.headers['Retry-After']).toBeUndefined();
  });

  it('log เฉพาะ path ไม่มี query', () => {
    const result = run(new Error('boom'));

    expect(result.logged).toContain('"path":"/api/v1/reels"');
    expect(result.logged).not.toContain('?q=');
  });

  it('validation → VALIDATION_ERROR พร้อม details', () => {
    const result = run(new BadRequestException(['name ต้องไม่ว่าง']));

    expect(result.status).toBe(HttpStatus.BAD_REQUEST);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
  });
});
