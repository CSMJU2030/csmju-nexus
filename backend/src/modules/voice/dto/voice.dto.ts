import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/// เพดานที่มาจากคณิตศาสตร์ของ mesh P2P ไม่ใช่ตัวเลขที่ตั้งลอย ๆ
///
///   เสียง Opus ~32 kbps ต่อสาย · ห้อง 8 คน แต่ละคนส่ง 7 สาย = ~224 kbps ขึ้น
///   ยังไหวบนเน็ตทั่วไป
///
///   แชร์หน้าจอ 720p ~700 kbps ต่อผู้ชม · ถ้ามี 7 ผู้ชม = ~4.9 Mbps ขึ้น
///   จากเครื่องคนแชร์คนเดียว ซึ่งเน็ตมือถือหรือ wifi มหาลัยรับไม่ไหว
///   จึงจำกัดผู้ชมไว้ที่ 4 (~2.8 Mbps)
///
/// ถ้าวันหนึ่งมีงบซื้อ SFU เพดานพวกนี้จะหายไปเอง
export const MAX_SCREEN_VIEWERS = 4;

export class JoinVoiceDto {
  @ApiProperty({ description: 'ห้องที่จะเข้า ต้องเป็นสมาชิกอยู่แล้ว' })
  @IsUUID('4')
  channelId!: string;
}

export class ListVoiceSessionsQuery {
  @ApiPropertyOptional({ description: 'กรองเฉพาะห้องนี้' })
  @IsOptional()
  @IsUUID('4')
  channelId?: string;
}

export class IceServerDto {
  @ApiProperty({ example: ['stun:stun.l.google.com:19302'] })
  urls!: string[];

  /// **`username` ที่นี่คือฟิลด์ของมาตรฐาน WebRTC (`RTCIceServer.username`)
  /// ไม่ใช่ชื่อผู้ใช้ของเรา** — มันคือรหัสที่ใช้ยืนยันกับเซิร์ฟเวอร์ TURN
  /// ซึ่งมาจาก env `TURN_USERNAME` ที่ผู้ดูแลระบบตั้งไว้
  ///
  /// เคยถูกเปลี่ยนชื่อเป็น `coreUserId` ตอนย้ายคีย์ตัวตนทั้งระบบ ซึ่งผิด
  /// และทำให้การยืนยันกับ TURN ล้มเหลวเงียบ ๆ (เบราว์เซอร์ไม่บ่น มันแค่
  /// มองข้ามฟิลด์ที่ไม่รู้จัก แล้วผู้ใช้หลัง NAT เข้มงวดก็เชื่อมเสียงไม่ติด)
  @ApiPropertyOptional() username?: string;
  @ApiPropertyOptional() credential?: string;
}

/// คนหนึ่งคนในห้องเสียง พร้อมไอคอนสถานะ — แถบข้างแบบ Discord
export class VoiceOccupantDto {
  @ApiProperty() coreUserId!: string;
  @ApiProperty({ description: 'ปิดไมค์' }) muted!: boolean;
  @ApiProperty({ description: 'ปิดหูฟัง (ไม่ได้ยินคนอื่น)' }) deafened!: boolean;
  @ApiProperty({ description: 'เปิดกล้อง' }) video!: boolean;
  @ApiProperty({ description: 'กำลังแชร์จอ' }) sharing!: boolean;
}

export class VoiceOccupantsDto {
  @ApiProperty() channelId!: string;
  @ApiProperty({ nullable: true, description: 'null = ไม่มีใครอยู่ในห้องเสียง' }) sessionId!: string | null;
  @ApiProperty({ type: [VoiceOccupantDto] }) occupants!: VoiceOccupantDto[];
}

/// แจ้งสถานะของตัวเองในห้องเสียง — ส่งเฉพาะช่องที่เปลี่ยน
export class UpdateVoiceStateDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean({ message: 'muted ต้องเป็น true หรือ false' }) muted?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean({ message: 'deafened ต้องเป็น true หรือ false' }) deafened?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean({ message: 'video ต้องเป็น true หรือ false' }) video?: boolean;
}

export class VoiceParticipantDto {
  @ApiProperty() coreUserId!: string;
  @ApiProperty() joinedAt!: string;
}

export class VoiceSessionDto {
  @ApiProperty() id!: string;
  @ApiProperty() channelId!: string;
  @ApiProperty() startedAt!: string;
  @ApiProperty({ type: [VoiceParticipantDto] })
  participants!: VoiceParticipantDto[];

  @ApiProperty({ example: 8 }) maxSeats!: number;
  @ApiProperty({ example: 3 }) seatsTaken!: number;
}

export class JoinVoiceResponseDto extends VoiceSessionDto {
  @ApiProperty({
    type: [IceServerDto],
    description:
      'ส่งจากเซิร์ฟเวอร์เพื่อไม่ให้หน้าบ้าน hardcode และเพื่อหมุน credential ของ TURN ได้',
  })
  iceServers!: IceServerDto[];

  @ApiProperty({
    description:
      'false เมื่อไม่มี TURN — ผู้ใช้บางส่วนหลัง NAT ของมหาลัยหรือเน็ตมือถือจะเชื่อมไม่ติด',
  })
  turnAvailable!: boolean;

  @ApiProperty({ example: MAX_SCREEN_VIEWERS })
  maxScreenViewers!: number;
}
