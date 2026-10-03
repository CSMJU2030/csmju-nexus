import { describe, expect, it } from 'vitest';
import {
  FileTypeError,
  assertUploadableName,
  sniffFileType,
} from './file-type.js';

/// เทสต์การตัดสินชนิดไฟล์ที่ผู้ใช้อัปโหลด
///
/// จุดนี้เป็นด่านความปลอดภัยด่านสุดท้ายก่อนไฟล์ของคนอื่นจะถูกเสิร์ฟกลับออกไป
/// ทั้งนามสกุลและ Content-Type ผู้ใช้แก้ได้ตามใจ จึงต้องตัดสินจากไบต์จริง
///
/// **เอกสาร Office ยากกว่าที่คิด** เพราะ .docx/.xlsx/.pptx คือไฟล์ zip
/// ส่วน .doc/.xls/.ppt ใช้ภาชนะ OLE2 ร่วมกันทั้งสามชนิด — ดูแค่หัวไฟล์
/// จึงแยกไม่ออกว่าเป็นอะไร ต้องอ่านนามสกุลประกอบ

/// หัวไฟล์จริงของแต่ละรูปแบบ
const HEADERS = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]),
  gif: Buffer.from('GIF89a' + '\u0001\u0000\u0001\u0000\u0000\u0000\u0000\u0000\u0000\u0000'),
  pdf: Buffer.from('%PDF-1.7\n%โครง\n'),
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  ole2: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0]),
  mp4: Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(4)]),
  text: Buffer.from('บันทึกการประชุม\n- แบ่งงาน\n'),
};

describe('เอกสาร Office', () => {
  it('**รับ .docx ได้** — ผู้ใช้เรียกมันว่า "ไฟล์ Word"', () => {
    expect(sniffFileType(HEADERS.zip, 'รายงานกลุ่ม.docx')).toEqual({
      kind: 'DOCUMENT',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  it('รับ .xlsx และ .pptx ด้วย — ภาชนะเดียวกัน คนละชนิด', () => {
    expect(sniffFileType(HEADERS.zip, 'คะแนน.xlsx').mimeType).toContain(
      'spreadsheetml',
    );
    expect(sniffFileType(HEADERS.zip, 'นำเสนอ.pptx').mimeType).toContain(
      'presentationml',
    );
  });

  it('รับ Word รุ่นเก่า .doc ที่เป็นภาชนะ OLE2', () => {
    expect(sniffFileType(HEADERS.ole2, 'ใบงานเก่า.doc')).toEqual({
      kind: 'DOCUMENT',
      mimeType: 'application/msword',
    });
  });

  it('.zip ธรรมดายังเป็น ARCHIVE ไม่ใช่เอกสาร', () => {
    // ถ้าเผลอตัดสินจากภาชนะอย่างเดียว ไฟล์ zip ทุกไฟล์จะกลายเป็น Word
    expect(sniffFileType(HEADERS.zip, 'โปรเจกต์.zip')).toEqual({
      kind: 'ARCHIVE',
      mimeType: 'application/zip',
    });
  });

  it('OLE2 ที่นามสกุลไม่ใช่ของ Office ไม่รับ', () => {
    // ภาชนะ OLE2 ใช้กับไฟล์เก่าหลายอย่างรวมถึงตัวติดตั้ง — รับเฉพาะที่รู้จัก
    expect(() => sniffFileType(HEADERS.ole2, 'ของเก่า.pdf')).toThrow(
      FileTypeError,
    );
  });

  it('.docx ที่ข้างในไม่ใช่ zip ถูกจับได้', () => {
    expect(() => sniffFileType(HEADERS.mp4, 'หลอก.docx')).toThrow(FileTypeError);
  });

  it('**ไม่รับไฟล์ Office ที่ฝังมาโครได้**', () => {
    // .docm รันโค้ดบนเครื่องคนที่เปิด — เป็นช่องแพร่มัลแวร์ที่ยังใช้ได้ผลอยู่
    for (const name of ['มาโคร.docm', 'มาโคร.xlsm', 'มาโคร.pptm']) {
      expect(() => assertUploadableName(name)).toThrow(FileTypeError);
    }
  });
});

describe('ชนิดไฟล์ที่รองรับอยู่เดิม ต้องไม่พังตาม', () => {
  it('GIF เป็นรูปภาพ', () => {
    expect(sniffFileType(HEADERS.gif, 'สติกเกอร์.gif')).toEqual({
      kind: 'IMAGE',
      mimeType: 'image/gif',
    });
  });

  it('PNG · PDF · MP4 · ข้อความ ยังตัดสินได้ถูก', () => {
    expect(sniffFileType(HEADERS.png, 'รูป.png').kind).toBe('IMAGE');
    expect(sniffFileType(HEADERS.pdf, 'ใบงาน.pdf').kind).toBe('DOCUMENT');
    expect(sniffFileType(HEADERS.mp4, 'คลิป.mp4').kind).toBe('VIDEO');
    expect(sniffFileType(HEADERS.text, 'บันทึก.txt').kind).toBe('CODE');
  });

  it('ยังกันไฟล์ที่เบราว์เซอร์เปิดเป็นหน้าเว็บได้เหมือนเดิม', () => {
    for (const name of ['หน้า.html', 'ไอคอน.svg', 'ตัวติดตั้ง.exe']) {
      expect(() => assertUploadableName(name)).toThrow(FileTypeError);
    }
  });

  it('ยังจับไฟล์ปลอมนามสกุลได้เหมือนเดิม', () => {
    expect(() => sniffFileType(HEADERS.zip, 'หลอก.png')).toThrow(FileTypeError);
  });
});

/// หัวไฟล์เสียงจริง 16 ไบต์ของแต่ละรูปแบบ
const AUDIO = {
  // EBML — ภาชนะเดียวกับวิดีโอ webm
  webm: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81]),
  ogg: Buffer.concat([Buffer.from('OggS'), Buffer.from([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0x4f, 0x70])]),
  id3: Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0x23, 0x76, 0x54, 0x53, 0x53, 0x45, 0, 0])]),
  // MPEG-1 Layer III 128 kbps — ไม่มีแท็ก ID3
  mpegFrame: Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  m4a: Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.from([0, 0, 0, 0])]),
  wav: Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x08, 0, 0]), Buffer.from('WAVEfmt ')]),
};

describe('ข้อความเสียง', () => {
  it('**.weba เป็นเสียง** ทั้งที่ภาชนะเป็น webm เดียวกับวิดีโอ', () => {
    expect(sniffFileType(AUDIO.webm, 'เสียง.weba')).toEqual({
      kind: 'AUDIO',
      mimeType: 'audio/webm',
    });
  });

  it('**.webm ที่ client บอกว่าเป็น audio/* ได้ AUDIO** (MediaRecorder ตั้งชื่อ .webm)', () => {
    expect(sniffFileType(AUDIO.webm, 'voice.webm', 'audio/webm;codecs=opus')).toEqual({
      kind: 'AUDIO',
      mimeType: 'audio/webm',
    });
  });

  it('.webm ที่ไม่บอกอะไรยังเป็นวิดีโอเหมือนเดิม', () => {
    expect(sniffFileType(AUDIO.webm, 'คลิป.webm')).toEqual({
      kind: 'VIDEO',
      mimeType: 'video/webm',
    });
    expect(sniffFileType(AUDIO.webm, 'คลิป.webm', 'video/webm').kind).toBe('VIDEO');
  });

  it('.ogg และ .opus (OggS)', () => {
    expect(sniffFileType(AUDIO.ogg, 'เสียง.ogg')).toEqual({ kind: 'AUDIO', mimeType: 'audio/ogg' });
    expect(sniffFileType(AUDIO.ogg, 'เสียง.opus').kind).toBe('AUDIO');
  });

  it('.mp3 ทั้งแบบมี ID3 และแบบเริ่มด้วย frame sync', () => {
    expect(sniffFileType(AUDIO.id3, 'เพลง.mp3')).toEqual({ kind: 'AUDIO', mimeType: 'audio/mpeg' });
    expect(sniffFileType(AUDIO.mpegFrame, 'เพลง.mp3')).toEqual({ kind: 'AUDIO', mimeType: 'audio/mpeg' });
  });

  it('frame sync อย่างเดียวไม่พอให้ไฟล์นามสกุลอื่นผ่าน — ลายเซ็นสั้นเกินจะเชื่อได้', () => {
    expect(() => sniffFileType(AUDIO.mpegFrame, 'รูป.png')).toThrow(FileTypeError);
  });

  it('.m4a (ftyp แบรนด์ M4A) เป็นเสียง ส่วน mp4 ปกติยังเป็นวิดีโอ', () => {
    expect(sniffFileType(AUDIO.m4a, 'เสียง.m4a')).toEqual({ kind: 'AUDIO', mimeType: 'audio/mp4' });
    expect(sniffFileType(HEADERS.mp4, 'คลิป.mp4').kind).toBe('VIDEO');
  });

  it('.wav (RIFF....WAVE) ไม่สับสนกับ webp (RIFF....WEBP)', () => {
    expect(sniffFileType(AUDIO.wav, 'เสียง.wav')).toEqual({ kind: 'AUDIO', mimeType: 'audio/wav' });
    expect(() => sniffFileType(AUDIO.wav, 'รูป.webp')).toThrow(FileTypeError);
  });

  it('**ไฟล์เสียงปลอมนามสกุลยังถูกจับ** — .mp3 ที่ข้างในเป็น zip', () => {
    expect(() => sniffFileType(HEADERS.zip, 'หลอก.mp3')).toThrow(FileTypeError);
  });

  it('คำใบ้ audio/* ไม่ทำให้ไฟล์นามสกุลอื่นกลายเป็นเสียง', () => {
    // .png ที่ข้างในเป็น webm ต้องตกเหมือนเดิม ไม่ว่า client จะบอกว่าอะไร
    expect(() => sniffFileType(AUDIO.webm, 'รูป.png', 'audio/webm')).toThrow(FileTypeError);
  });
});
