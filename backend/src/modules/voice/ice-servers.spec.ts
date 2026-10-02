import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VoiceService } from './voice.service.js';
import type { PrismaService } from '../../common/prisma/prisma.service.js';
import type { ChannelsService } from '../channels/channels.service.js';

/// เทสต์รายการเซิร์ฟเวอร์ ICE ที่ส่งให้หน้าบ้านไปตั้งค่า WebRTC
///
/// **สิ่งที่ต้องกันคือชื่อฟิลด์ `username`**
///
/// มันเป็นฟิลด์ของมาตรฐาน WebRTC (`RTCIceServer.username`) ไม่ใช่ตัวตนผู้ใช้
/// ของเรา — เคยถูกกวาดเปลี่ยนเป็น `coreUserId` ตอนย้ายคีย์ตัวตนทั้งระบบ
///
/// บั๊กแบบนี้ร้ายเพราะ **ไม่มีอะไรดังเลย**: เบราว์เซอร์ไม่บ่นกับฟิลด์ที่ไม่รู้จัก
/// มันแค่มองข้าม แล้ว TURN ปฏิเสธการยืนยันตัวตน ผลคือคนที่อยู่หลัง NAT
/// เข้มงวด (เน็ตมือถือ เน็ตมหาวิทยาลัยบางวง) เชื่อมเสียงไม่ติดโดยไม่มี error
/// ให้ใครเห็น ส่วนคนที่ NAT เจาะได้ก็ยังใช้ได้ตามปกติ — จึงดูเหมือนระบบปกติดี

const prisma = {} as PrismaService;
/// `iceServers()` อ่านแค่ env ไม่แตะฐานข้อมูลหรือห้องแชทเลย
/// จึงส่งอ็อบเจกต์ว่างเข้าไปได้ ไม่ต้องตั้ง mock ทั้งก้อน
const channels = {} as ChannelsService;

let service: VoiceService;
const saved = { ...process.env };

beforeEach(() => {
  service = new VoiceService(prisma, channels, {} as never);
});

afterEach(() => {
  process.env = { ...saved };
});

describe('รายการเซิร์ฟเวอร์ ICE', () => {
  it('มี STUN สาธารณะให้เสมอแม้ไม่ได้ตั้งค่าอะไรเลย', () => {
    delete process.env.TURN_URL;

    const servers = service.iceServers();

    expect(servers.length).toBeGreaterThan(0);
    expect(servers.every((s) => s.urls.length > 0)).toBe(true);
  });

  it('ใส่ TURN เข้าไปเมื่อผู้ดูแลตั้งค่าไว้', () => {
    process.env.TURN_URL = 'turn:turn.example.ac.th:3478';
    process.env.TURN_USERNAME = 'csmju';
    process.env.TURN_CREDENTIAL = 'รหัสลับ';

    const turn = service
      .iceServers()
      .find((s) => s.urls.some((url) => url.startsWith('turn:')));

    expect(turn).toBeDefined();
    expect(turn?.credential).toBe('รหัสลับ');
  });

  it('**ชื่อฟิลด์ต้องเป็น `username` ตามมาตรฐาน WebRTC เป๊ะ ๆ**', () => {
    process.env.TURN_URL = 'turn:turn.example.ac.th:3478';
    process.env.TURN_USERNAME = 'csmju';
    process.env.TURN_CREDENTIAL = 'รหัสลับ';

    const turn = service
      .iceServers()
      .find((s) => s.urls.some((url) => url.startsWith('turn:')))!;

    // ถ้าบรรทัดนี้แดง แปลว่าการยืนยันกับ TURN จะล้มเหลวเงียบ ๆ
    expect(turn.username).toBe('csmju');

    // และต้องไม่มีชื่ออื่นที่ WebRTC ไม่รู้จักหลุดออกไป
    expect(Object.keys(turn).sort()).toEqual([
      'credential',
      'urls',
      'username',
    ]);
  });

  it('ไม่ตั้ง TURN_URL ก็ไม่มีรายการ TURN หลุดออกไปแบบไม่มีปลายทาง', () => {
    delete process.env.TURN_URL;

    const servers = service.iceServers();

    expect(
      servers.some((s) => s.urls.some((url) => url.startsWith('turn:'))),
    ).toBe(false);
  });
});
