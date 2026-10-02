import type { AssetKind } from '../../generated/prisma/enums.js';

/// ตรวจชนิดไฟล์สองจังหวะ เพราะสองจังหวะนั้นรู้ข้อมูลไม่เท่ากัน
///
///   จังหวะ intent — รู้แค่ชื่อไฟล์ ยังไม่มีไบต์ → assertUploadableName()
///   จังหวะ commit — มีไบต์จริงแล้ว           → sniffFileType()
///
/// เหตุที่ต้องตรวจตอน commit อีกรอบ: ทั้งนามสกุลและ Content-Type ผู้ใช้แก้ได้
/// ตามใจ ถ้าเชื่อสองอย่างนั้นจะมี .svg ที่ข้างในเป็นสคริปต์เข้ามาในระบบ แล้ว
/// กลายเป็น stored XSS ทันทีที่มีคนกดดูพรีวิวในช่องแชท

export interface SniffResult {
  kind: AssetKind;
  mimeType: string;
}

export class FileTypeError extends Error {}

/// จำนวนไบต์หัวไฟล์ที่ต้องอ่านมาตรวจ — พอสำหรับทุกลายเซ็นด้านล่าง
export const SNIFF_BYTES = 16;

interface Signature {
  kind: AssetKind;
  mimeType: string;
  /// ไบต์ที่ต้องตรงกัน — null คือ "ไบต์นี้เป็นอะไรก็ได้"
  bytes: (number | null)[];
  offset?: number;
  /// เป็นแค่ "ภาชนะ" ไม่ใช่ชนิดไฟล์ที่ตอบกลับได้เอง
  ///
  /// ถ้าไม่มีธงนี้ ภาชนะ OLE2 จะหลุดออกไปเป็น mimeType จริง แล้วไฟล์อะไรก็ไม่รู้
  /// ที่ตั้งชื่อ .pdf จะผ่านด่านไปได้ทั้งที่ข้างในไม่ใช่ PDF
  containerOnly?: boolean;
}

const SIGNATURES: Signature[] = [
  {
    kind: 'VIDEO',
    mimeType: 'video/mp4',
    offset: 4,
    bytes: [0x66, 0x74, 0x79, 0x70], // "ftyp"
  },
  { kind: 'VIDEO', mimeType: 'video/webm', bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { kind: 'IMAGE', mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  {
    kind: 'IMAGE',
    mimeType: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { kind: 'IMAGE', mimeType: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  {
    kind: 'IMAGE',
    mimeType: 'image/webp',
    bytes: [
      0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50,
    ],
  },
  {
    kind: 'DOCUMENT',
    mimeType: 'application/pdf',
    bytes: [0x25, 0x50, 0x44, 0x46],
  },
  // zip ปกติ / zip ว่าง / zip แบบ spanned
  {
    kind: 'ARCHIVE',
    mimeType: 'application/zip',
    bytes: [0x50, 0x4b, 0x03, 0x04],
  },
  {
    kind: 'ARCHIVE',
    mimeType: 'application/zip',
    bytes: [0x50, 0x4b, 0x05, 0x06],
  },
  {
    kind: 'ARCHIVE',
    mimeType: 'application/zip',
    bytes: [0x50, 0x4b, 0x07, 0x08],
  },
  // เสียง — ลายเซ็นที่แข็งแรงพอจะเชื่อได้โดยไม่ต้องดูนามสกุล
  // (MPEG frame sync ของ mp3 ที่ไม่มี ID3 อ่อนเกินไป จึงตรวจแยกใน resolveAudio)
  { kind: 'AUDIO', mimeType: 'audio/ogg', bytes: [0x4f, 0x67, 0x67, 0x53] }, // "OggS"
  { kind: 'AUDIO', mimeType: 'audio/mpeg', bytes: [0x49, 0x44, 0x33] }, // "ID3"
  {
    kind: 'AUDIO',
    mimeType: 'audio/wav',
    bytes: [
      0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x41, 0x56, 0x45,
    ], // "RIFF....WAVE"
  },
  // Office รุ่นเก่า (.doc .xls .ppt) ใช้ภาชนะ OLE2 เหมือนกันหมด แยกชนิดจริง
  // ด้วยลายเซ็นไม่ได้ ต้องดูนามสกุลประกอบ — ดู resolveOfficeDocument()
  {
    kind: 'DOCUMENT',
    mimeType: 'application/x-ole-storage',
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    containerOnly: true,
  },
];

/// เอกสาร Office ยุคใหม่ — ข้างในเป็น zip ทั้งหมด
///
/// ลายเซ็นจึงเป็น zip ตรง ๆ แยกจากไฟล์ .zip ธรรมดาไม่ได้ถ้าดูแค่หัวไฟล์
/// จึงตัดสินชนิดจากนามสกุล **หลังจาก** ยืนยันแล้วว่าภาชนะเป็น zip จริง
/// ซึ่งยังกันไฟล์ปลอมนามสกุลได้อยู่ (เช่น .docx ที่ข้างในเป็น exe ไม่ผ่าน)
const OOXML_DOCUMENTS = new Map<string, string>([
  [
    'docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  [
    'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  [
    'pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
]);

/// เอกสาร Office รุ่นเก่าที่ใช้ภาชนะ OLE2
const OLE2_DOCUMENTS = new Map<string, string>([
  ['doc', 'application/msword'],
  ['xls', 'application/vnd.ms-excel'],
  ['ppt', 'application/vnd.ms-powerpoint'],
]);

/// นามสกุลไบนารีที่รับ พร้อมชนิดที่ "ต้อง" ตรวจเจอตอน commit
/// ถ้าเนื้อไฟล์ไม่ตรงกับที่นามสกุลบอก แปลว่ามีคนเปลี่ยนนามสกุลมาหลอก
const BINARY_EXTENSIONS = new Map<string, AssetKind>([
  ['png', 'IMAGE'],
  ['jpg', 'IMAGE'],
  ['jpeg', 'IMAGE'],
  ['gif', 'IMAGE'],
  ['webp', 'IMAGE'],
  ['mp4', 'VIDEO'],
  ['m4v', 'VIDEO'],
  ['webm', 'VIDEO'],
  ['mov', 'VIDEO'],
  // ข้อความเสียง — .weba คือ webm ที่มีแต่เสียง (MediaRecorder ของ Chrome/Firefox)
  // ส่วน .m4a คือสิ่งที่ Safari อัดออกมา
  ['weba', 'AUDIO'],
  ['ogg', 'AUDIO'],
  ['oga', 'AUDIO'],
  ['opus', 'AUDIO'],
  ['mp3', 'AUDIO'],
  ['m4a', 'AUDIO'],
  ['wav', 'AUDIO'],
  ['pdf', 'DOCUMENT'],
  ['zip', 'ARCHIVE'],
  // Word / Excel / PowerPoint — ที่ผู้ใช้เรียกรวม ๆ ว่า "ไฟล์เอกสาร"
  ['docx', 'DOCUMENT'],
  ['xlsx', 'DOCUMENT'],
  ['pptx', 'DOCUMENT'],
  ['doc', 'DOCUMENT'],
  ['xls', 'DOCUMENT'],
  ['ppt', 'DOCUMENT'],
]);

/// ไฟล์โค้ด/ข้อความไม่มีลายเซ็น จึงใช้บัญชีนามสกุลที่อนุญาตแทน
const CODE_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'yml', 'yaml', 'csv',
  'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php',
  'sql', 'sh', 'bat', 'ps1', 'ipynb', 'toml', 'ini', 'env',
  'gitignore', 'dockerfile',
]);

/// นามสกุลที่ปฏิเสธเสมอแม้เนื้อไฟล์จะดูเหมือนข้อความธรรมดา
///
/// พวกนี้เบราว์เซอร์เรนเดอร์เป็น HTML ได้ ซึ่งเท่ากับรันสคริปต์ของคนอัปโหลด
/// ถ้าไฟล์ถูกเปิดบนโดเมนเดียวกับแอป
const DENIED_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'shtml', 'svg', 'xml', 'xsl', 'mhtml',
  'swf', 'exe', 'dll', 'msi', 'scr', 'com', 'jar',
  // Office ที่ฝังมาโครได้ — ไฟล์พวกนี้รันโค้ดบนเครื่องคนที่เปิด ซึ่งเป็น
  // ช่องทางแพร่มัลแวร์ที่เก่าแก่ที่สุดช่องหนึ่งและยังใช้ได้ผลอยู่
  // ถ้าต้องการส่งจริง ให้ใส่ใน .zip เพื่อให้ผู้รับรู้ตัวก่อนเปิด
  'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm', 'xlam', 'ppam',
]);

export function extensionOf(fileName: string): string {
  const parts = fileName.toLowerCase().split('.');

  return parts.length > 1 ? (parts.pop() ?? '') : '';
}

/// จังหวะ intent — ตรวจได้เท่าที่ชื่อไฟล์บอก
///
/// ปฏิเสธตรงนี้เพื่อไม่ให้ผู้ใช้เสียเวลาอัปไฟล์ 40 MB แล้วค่อยรู้ว่ารับไม่ได้
export function assertUploadableName(fileName: string): void {
  const extension = extensionOf(fileName);

  if (DENIED_EXTENSIONS.has(extension)) {
    throw new FileTypeError(
      `ไม่รับไฟล์นามสกุล .${extension} เพราะเบราว์เซอร์เปิดเป็นหน้าเว็บได้ — ` +
        'ถ้าต้องการแชร์ ให้เปลี่ยนเป็น .txt หรือใส่ใน .zip',
    );
  }

  if (!BINARY_EXTENSIONS.has(extension) && !CODE_EXTENSIONS.has(extension)) {
    throw new FileTypeError(
      `ไม่รองรับไฟล์นามสกุล .${extension || '(ไม่มีนามสกุล)'} — ` +
        'รองรับรูปภาพ (รวม GIF) วิดีโอ ไฟล์เสียง PDF ไฟล์ Word/Excel/PowerPoint ' +
        'ไฟล์ .zip และไฟล์โค้ด/ข้อความ',
    );
  }
}

/// จังหวะ commit — ตัดสินจากเนื้อไฟล์จริง
///
/// `declaredMime` คือ Content-Type ที่ client แจ้งตอน intent (ถ้ามี) — **ใช้ช่วยแยก
/// ชนิดเท่านั้น ไม่ใช่เหตุผลให้ผ่าน**: webm กับ mp4 เป็นภาชนะเดียวกันทั้งแบบมีภาพ
/// และแบบเสียงล้วน ดูจากหัวไฟล์ 16 ไบต์แยกไม่ออก ถ้าไม่มีคำบอกใบ้นี้ ข้อความเสียง
/// ที่ MediaRecorder อัดเป็น `voice.webm` จะกลายเป็นวิดีโอ แล้วหน้าบ้านเปิดตัวเล่น
/// วิดีโอจอดำให้แทนแถบคลื่นเสียง — ไฟล์ที่เนื้อไม่ใช่ webm/mp4 ยังไม่ผ่านเหมือนเดิม
export function sniffFileType(
  header: Buffer,
  fileName: string,
  declaredMime?: string | null,
): SniffResult {
  assertUploadableName(fileName);

  const extension = extensionOf(fileName);
  const expectedKind = BINARY_EXTENSIONS.get(extension);
  const declaredAudio = (declaredMime ?? '').trim().toLowerCase().startsWith('audio/');

  const mpegAudio = resolveMpegFrame(extension, header);

  if (mpegAudio) {
    return mpegAudio;
  }

  for (const signature of SIGNATURES) {
    if (!matches(header, signature)) {
      continue;
    }

    // ภาชนะที่เป็นได้ทั้งวิดีโอและเสียง ต้องตัดสินก่อนเทียบกับนามสกุล
    // ไม่งั้น .weba (webm เสียงล้วน) จะถูกตีว่า "เนื้อไฟล์เป็นวิดีโอ ไม่ตรงนามสกุล"
    const audio = resolveAudioContainer(extension, signature, header, declaredAudio);

    if (audio) {
      return audio;
    }

    // เอกสาร Office ต้องแปลงก่อนตรวจว่าชนิดตรงกับนามสกุลไหม เพราะภาชนะของมัน
    // (zip หรือ OLE2) ไม่ใช่ชนิดที่เราจะรายงานให้ผู้ใช้เห็น
    const office = resolveOfficeDocument(extension, signature);

    if (office) {
      return office;
    }

    // ภาชนะที่ไม่มีใครมารับช่วงต่อ = เราไม่รู้จริง ๆ ว่าไฟล์นี้คืออะไร
    if (signature.containerOnly) {
      throw new FileTypeError(
        `เนื้อไฟล์ไม่ตรงกับนามสกุล .${extension} — ` +
          'เป็นไฟล์ Office รุ่นเก่าที่เปลี่ยนนามสกุลมา',
      );
    }

    // เนื้อไฟล์เป็นไบนารีที่รู้จัก แต่ต้องตรงกับที่นามสกุลอ้างด้วย
    // เช่น .zip ที่ข้างในเป็น mp4 ก็ไม่ให้ผ่าน เพราะพรีวิวจะเพี้ยน
    if (expectedKind && signature.kind !== expectedKind) {
      throw new FileTypeError(
        `เนื้อไฟล์ไม่ตรงกับนามสกุล .${extension} — ตรวจพบว่าเป็น ${signature.mimeType}`,
      );
    }

    return { kind: signature.kind, mimeType: signature.mimeType };
  }

  // ไม่ตรงลายเซ็นไบนารีใดเลย
  if (expectedKind) {
    throw new FileTypeError(
      `เนื้อไฟล์ไม่ตรงกับนามสกุล .${extension} — ไฟล์อาจเสียหาย ` +
        'หรือถูกเปลี่ยนนามสกุลมา',
    );
  }

  if (looksBinary(header)) {
    throw new FileTypeError(
      'เนื้อไฟล์ไม่ตรงกับนามสกุล — ไฟล์โค้ดต้องเป็นข้อความล้วน',
    );
  }

  return { kind: 'CODE', mimeType: 'text/plain; charset=utf-8' };
}

/// เอกสาร Office ที่ซ่อนอยู่ในภาชนะ zip หรือ OLE2
///
/// คืน null ถ้าไม่ใช่คู่ที่เข้ากัน แล้วให้การตรวจตามปกติทำงานต่อ เช่น
/// `.docx` ที่ข้างในเป็น mp4 จะไม่เข้าเงื่อนไขนี้ แล้วไปตกที่ข้อความ
/// "เนื้อไฟล์ไม่ตรงกับนามสกุล" ตามเดิม
function resolveOfficeDocument(
  extension: string,
  signature: Signature,
): SniffResult | null {
  if (signature.mimeType === 'application/zip') {
    const mimeType = OOXML_DOCUMENTS.get(extension);

    return mimeType ? { kind: 'DOCUMENT', mimeType } : null;
  }

  if (signature.mimeType === 'application/x-ole-storage') {
    const mimeType = OLE2_DOCUMENTS.get(extension);

    // OLE2 ที่นามสกุลไม่ใช่ของ Office = ไฟล์เก่าอะไรก็ไม่รู้ ไม่รับดีกว่า
    return mimeType ? { kind: 'DOCUMENT', mimeType } : null;
  }

  return null;
}

/// webm / mp4 ที่เป็นเสียงล้วน
///
/// คืน null ถ้าไม่ใช่ แล้วปล่อยให้ตัดสินตามลายเซ็นเดิม (เป็นวิดีโอ) — ไฟล์วิดีโอ
/// ที่เคยอัปโหลดได้จึงยังได้ผลเหมือนเดิมทุกไฟล์
function resolveAudioContainer(
  extension: string,
  signature: Signature,
  header: Buffer,
  declaredAudio: boolean,
): SniffResult | null {
  // เฉพาะนามสกุลของสื่อเท่านั้น — `.png` ที่ข้างในเป็น webm ต้องตกที่ข้อความ
  // "เนื้อไฟล์ไม่ตรงกับนามสกุล" ตามเดิม ไม่ใช่กลายเป็นไฟล์เสียงเพราะ client บอกมา
  const media = BINARY_EXTENSIONS.get(extension);

  if (media !== 'VIDEO' && media !== 'AUDIO') {
    return null;
  }

  if (signature.mimeType === 'video/webm') {
    return extension === 'weba' || declaredAudio
      ? { kind: 'AUDIO', mimeType: 'audio/webm' }
      : null;
  }

  if (signature.mimeType === 'video/mp4') {
    // ไบต์ 8-11 คือ major brand — "M4A " / "M4B " ประกาศตัวเองว่าเป็นเสียงชัดเจน
    const brand = header.subarray(8, 12).toString('latin1');
    const audioBrand = brand === 'M4A ' || brand === 'M4B ';

    return audioBrand || extension === 'm4a' || declaredAudio
      ? { kind: 'AUDIO', mimeType: 'audio/mp4' }
      : null;
  }

  return null;
}

/// mp3 ที่ไม่มีแท็ก ID3 เริ่มด้วย MPEG frame sync (11 บิตแรกเป็น 1)
///
/// ลายเซ็นนี้สั้นเกินกว่าจะเชื่อได้เอง จึงรับเฉพาะเมื่อนามสกุลเป็น .mp3 ด้วย —
/// และตรวจว่าบิต layer ไม่ใช่ค่าสงวน (00) ซึ่งไฟล์เสียงจริงไม่มีทางเป็น
function resolveMpegFrame(extension: string, header: Buffer): SniffResult | null {
  if (extension !== 'mp3' || header.length < 2) {
    return null;
  }

  const sync = header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
  const layer = (header[1] >> 1) & 0x03;

  return sync && layer !== 0 ? { kind: 'AUDIO', mimeType: 'audio/mpeg' } : null;
}

/// ไฟล์ข้อความไม่มีไบต์ 0x00 — ถ้ามีแปลว่าเป็นไบนารีที่เปลี่ยนนามสกุลมาหลอก
function looksBinary(header: Buffer): boolean {
  return header.includes(0x00);
}

function matches(header: Buffer, signature: Signature): boolean {
  const offset = signature.offset ?? 0;

  if (header.length < offset + signature.bytes.length) {
    return false;
  }

  return signature.bytes.every(
    (byte, index) => byte === null || header[offset + index] === byte,
  );
}
