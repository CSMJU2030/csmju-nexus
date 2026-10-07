import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/auth/public.decorator.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { parseByteRange } from '../../common/storage/byte-range.js';
import { DatabaseStorage, MAX_OBJECT_BYTES, decodeObjectPath } from '../../common/storage/database.storage.js';

/// รับ-ส่งไบต์ของไฟล์ผู้ใช้ผ่านลิงก์ที่ลงนามแล้ว (ไฟล์อยู่ในตาราง stored_objects — deployment.md ข้อ 4.3)
///
/// เบราว์เซอร์เรียกเส้นนี้ผ่าน rewrite ของหน้าเว็บ (โดเมนเดียวกัน) · ตัด @Public() ไม่ได้ เพราะ <img>/<video>
/// และการ PUT ไฟล์ไม่ได้แนบ token — ความปลอดภัยมาจากลายเซ็น HMAC อายุสั้นที่ออกให้หลังตรวจสิทธิ์แล้วเท่านั้น
@ApiExcludeController()
@Controller('asset-blobs')
export class AssetBlobsController {
  constructor(
    private readonly storage: DatabaseStorage,
    private readonly prisma: PrismaService,
  ) {}

  @Put(':bucket/:objectPath')
  @Public()
  async upload(
    @Param('bucket') bucket: string,
    @Param('objectPath') objectPath: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Req() request: Request,
  ): Promise<void> {
    const path = decodeObjectPath(objectPath);

    if (path === null || !this.storage.verify('put', bucket, path, Number(expires), signature)) {
      throw new UnauthorizedException('ลิงก์อัปโหลดหมดอายุหรือไม่ถูกต้อง');
    }

    const body = await readBody(request, MAX_OBJECT_BYTES);

    if (body === 'too-large') {
      throw new BadRequestException([`ไฟล์ใหญ่เกิน ${MAX_OBJECT_BYTES / 1024 / 1024} MB`]);
    }

    if (body.length === 0) {
      throw new BadRequestException('ไม่มีข้อมูลไฟล์ในคำขอ');
    }

    await this.storage.write(bucket, path, body);
  }

  @Get(':bucket/:objectPath')
  @Public()
  async download(
    @Param('bucket') bucket: string,
    @Param('objectPath') objectPath: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const path = decodeObjectPath(objectPath);

    if (path === null || !this.storage.verify('get', bucket, path, Number(expires), signature)) {
      throw new UnauthorizedException('ลิงก์ดาวน์โหลดหมดอายุหรือไม่ถูกต้อง');
    }

    // content-type จาก mimeType ที่ "ยืนยันด้วย magic bytes" ตอน commit ไม่ใช่จากนามสกุลหรือที่ client แจ้ง
    // (objectPath ซ้ำได้ — สำเนาจากการส่งต่อชี้ไฟล์เดียวกันและมีชนิดเดียวกันเสมอ หยิบแถวไหนก็ได้)
    const asset = await this.prisma.asset.findFirst({
      where: { objectPath: path },
      select: { mimeType: true, fileName: true },
    });
    const stored = asset ? await this.storage.read(bucket, path) : null;

    if (!asset || !stored) {
      throw new NotFoundException('ไม่พบไฟล์นี้');
    }

    const { bytes, sha256 } = stored;
    const size = bytes.length;
    const part = parseByteRange(request.headers.range, size);

    // deployment.md ข้อ 4.3: attachment · nosniff · private, no-store — <img>/<video>/<audio> ยังแสดงได้ตามปกติ
    // แต่เปิดลิงก์ตรง ๆ จะดาวน์โหลดแทนการเรนเดอร์ในหน้า (กัน stored XSS จากไฟล์ผู้ใช้)
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('ETag', `"${sha256}"`);
    response.setHeader('Accept-Ranges', 'bytes');

    if (part === 'unsatisfiable') {
      response.status(416).setHeader('Content-Range', `bytes */${size}`);
      response.end();
      return;
    }

    const { start, end } = part ?? { start: 0, end: size - 1 };

    if (part) {
      response.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }

    response.setHeader('Content-Length', String(Math.max(0, end - start + 1)));
    response.end(size === 0 ? undefined : bytes.subarray(start, end + 1));
  }
}

/// ส่วนที่ยอมอ่านทิ้งเกินเพดานเพื่อตอบ 400 ให้เบราว์เซอร์เห็น (ถ้าตัดการเชื่อมต่อกลางทาง เบราว์เซอร์ได้แค่ network error)
const DRAIN_LIMIT = 20 * 1024 * 1024;

/// อ่าน raw body เอง (application/octet-stream ที่ body parser ของ Nest ไม่แตะ)
///
/// เกินเพดาน = หยุดเก็บไบต์ทันที (ไม่กินหน่วยความจำ) แล้วอ่านทิ้งจนจบเพื่อตอบ 400 · ส่งมาเกินมาก ๆ = ตัดการเชื่อมต่อ
function readBody(request: Request, limit: number): Promise<Buffer | 'too-large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = Number(request.headers['content-length']) > limit;

    request.on('data', (chunk: Buffer) => {
      total += chunk.length;

      if (total > limit) tooLarge = true;
      if (tooLarge && total > limit + DRAIN_LIMIT) {
        request.destroy();
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => resolve(tooLarge ? 'too-large' : Buffer.concat(chunks)));
    request.on('error', reject);
  });
}
