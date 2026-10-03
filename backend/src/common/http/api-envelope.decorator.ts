import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiResponse,
  getSchemaPath,
  refs,
} from '@nestjs/swagger';
import { PaginationMeta } from './envelope.js';

/// "API Contract ต้องซิงก์กับ openapi.json เสมอ" (Blueprint หน้า 13)
///
/// Swagger อ่าน return type ของ method ไม่ได้ (TypeScript ลบ type ตอน compile)
/// ถ้าไม่ประกาศ response ไว้ openapi.json จะมีแต่ path กับ request body
/// ซึ่งเท่ากับ contract ไม่ครบ — decorator สองตัวนี้ปิดช่องนั้น
///
/// ใช้แบบ: @ApiEnvelope(ReelResponseDto) หรือ @ApiEnvelopeList(ReelResponseDto)

export function ApiEnvelope<T extends Type<unknown>>(
  model: T,
  options: { status?: number; description?: string } = {},
) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status: options.status ?? 200,
      description: options.description ?? 'สำเร็จ',
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: { $ref: getSchemaPath(model) },
        },
      },
    }),
  );
}

export function ApiEnvelopeList<T extends Type<unknown>>(
  model: T,
  options: { description?: string } = {},
) {
  return applyDecorators(
    ApiExtraModels(model, PaginationMeta),
    ApiResponse({
      status: 200,
      description: options.description ?? 'สำเร็จ พร้อมข้อมูลแบ่งหน้า',
      schema: {
        type: 'object',
        required: ['success', 'data', 'meta'],
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'array',
            items: { $ref: getSchemaPath(model) },
          },
          meta: refs(PaginationMeta)[0],
        },
      },
    }),
  );
}

/// รูปแบบ error มาตรฐาน — ประกาศครั้งเดียวแล้วแปะซ้ำได้ทุก route
export function ApiEnvelopeError(status: number, description: string) {
  return ApiResponse({
    status,
    description,
    schema: {
      type: 'object',
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', example: 'NOT_FOUND' },
            message: { type: 'string', example: 'ไม่พบคลิปนี้ อาจถูกลบไปแล้ว' },
            details: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  });
}
