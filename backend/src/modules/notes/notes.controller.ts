import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type CoreHubUser,
} from '../../common/auth/core-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
} from '../../common/http/api-envelope.decorator.js';
import { NoteDto, PutNoteDto } from './dto/note.dto.js';
import { NotesService } from './notes.service.js';

@ApiTags('notes')
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @ApiOperation({
    summary: 'แถวโน้ตเหนือกล่องข้อความ',
    description:
      'อาเรย์ (ไม่แบ่งหน้า สูงสุด 100) — โน้ตของฉันก่อนเสมอ แล้วโน้ตที่ฉันเห็นได้ ใหม่ไปเก่า: MUTUAL_FOLLOWERS = ติดตามกันทั้งสองทางกับเจ้าของ · CLOSE_FRIENDS = ฉันอยู่ในเพื่อนสนิทของเจ้าของ · คนที่บล็อกกันไม่เห็นกัน · หมดอายุถูกกรองตอนอ่าน',
  })
  @ApiEnvelope(NoteDto)
  list(@CurrentUser() user: CoreHubUser) {
    return this.notes.list(user);
  }

  @Put('me')
  @ApiOperation({
    summary: 'โพสต์หรือแทนที่โน้ตของฉัน (อายุ 24 ชั่วโมงนับใหม่ทุกครั้ง)',
    description: 'audience: MUTUAL_FOLLOWERS (ค่าเริ่มต้น) หรือ CLOSE_FRIENDS',
  })
  @ApiEnvelope(NoteDto)
  @ApiEnvelopeError(400, 'โน้ตว่างหรือยาวเกิน 60 ตัวอักษร')
  putMine(@CurrentUser() user: CoreHubUser, @Body() dto: PutNoteDto) {
    return this.notes.putMine(user, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบโน้ตของฉัน (ไม่มีโน้ตอยู่ก็ไม่ถือว่าผิด)' })
  async removeMine(@CurrentUser() user: CoreHubUser) {
    await this.notes.removeMine(user);
  }
}
