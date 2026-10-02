import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type CoreHubUser } from '../../common/auth/core-user.js';
import { resolveMember } from '../../common/auth/member-role.js';
import { ApiEnvelope } from '../../common/http/api-envelope.decorator.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

export class MeResponseDto {
  @ApiProperty({ example: 'user-002' }) coreUserId!: string;
  @ApiProperty({ example: 'student' }) coreRole!: string;
  @ApiProperty({ enum: ['GUEST', 'EDITOR', 'ADMIN'] }) layer2Role!: string;
  @ApiProperty({ example: '48120040' }) storageUsedBytes!: string;
  @ApiProperty({ example: '209715200' }) storageQuotaBytes!: string;
  @ApiProperty({ example: 22.9 }) storageUsedPercent!: number;
}

/// "ฉันเป็นใครในระบบนี้" — รวมตัวตนกลางจาก token กับข้อมูลเฉพาะระบบย่อยจาก DB
///
/// `coreRole` มาจาก claim ที่ผ่านการตรวจลายเซ็นแล้ว ไม่ได้อ่านจากฐานข้อมูล
/// เพราะ Core Hub เป็นแหล่งความจริงและเปลี่ยนสิทธิ์ได้ตลอดเวลา
///
/// **ไม่มี `faculty` แล้ว** — token ของ Core Hub ไม่มี claim นี้
/// (data-dictionary.md ข้อ 1.2) เดิมค่านี้มาจาก header `X-Faculty` ที่ API
/// Gateway ซึ่งไม่มีอยู่จริงแนบมาให้ การคืนค่าที่เราเดาเองจะแย่กว่าไม่คืนเลย
@ApiTags('subsystem-members')
@Controller('subsystem-members')
export class MembersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @ApiOperation({ summary: 'สิทธิ์และพื้นที่เก็บไฟล์ของฉันในระบบย่อยนี้' })
  @ApiEnvelope(MeResponseDto)
  async me(@CurrentUser() user: CoreHubUser): Promise<MeResponseDto> {
    // ไม่ใช้ upsert ตรง ๆ เพราะ `update: {}` จะไม่แก้สิทธิ์ที่ผิดให้ —
    // แถวที่ผู้ดูแลสร้างไว้ตอนตั้งโควตาล่วงหน้าจะค้างเป็น GUEST ตลอดไป
    // แม้เจ้าตัวเป็นอาจารย์ (ดูเหตุผลเต็มใน common/auth/member-role.ts)
    const member = await resolveMember(this.prisma, user);

    const used = Number(member.storageUsedBytes);
    const quota = Number(member.storageQuotaBytes);

    return {
      coreUserId: member.coreUserId,
      coreRole: user.coreRole,
      layer2Role: member.layer2Role,
      storageUsedBytes: member.storageUsedBytes.toString(),
      storageQuotaBytes: member.storageQuotaBytes.toString(),
      storageUsedPercent:
        quota > 0 ? Math.round((used / quota) * 1000) / 10 : 0,
    };
  }
}
