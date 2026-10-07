/// สัญญาของที่เก็บไฟล์ — สลับผู้ให้บริการได้โดยไม่แตะโค้ดโดเมน
///
/// ตัวที่ใช้จริงคือ DatabaseStorage (ตาราง stored_objects · deployment.md ข้อ 4.3) — ออก signed URL อายุสั้น
/// ที่เป็น path บนโดเมนเดียวกับหน้าเว็บ ให้เบราว์เซอร์ PUT/GET ผ่าน rewrite มาที่ api

export interface UploadTicket {
  uploadUrl: string;
  /// method ที่ client ต้องใช้กับ uploadUrl
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StoredObjectInfo {
  sizeBytes: bigint;
}

export interface StorageProvider {
  /// ออกสิทธิ์อัปโหลดชั่วคราวสำหรับ objectPath หนึ่งตัว
  createUploadTicket(
    bucket: string,
    objectPath: string,
    options: { contentLength: number; ttlSeconds: number },
  ): Promise<UploadTicket>;

  /// ขนาดจริงของไฟล์หลังอัปโหลดเสร็จ — ใช้ยืนยันแทนการเชื่อเลขที่ client แจ้ง
  head(bucket: string, objectPath: string): Promise<StoredObjectInfo | null>;

  /// อ่านไบต์หัวไฟล์มาตรวจลายเซ็น
  readHead(
    bucket: string,
    objectPath: string,
    length: number,
  ): Promise<Buffer>;

  /// URL อ่านไฟล์แบบมีอายุ — ห้ามเปิด bucket เป็นสาธารณะ
  createDownloadUrl(
    bucket: string,
    objectPath: string,
    options: { ttlSeconds: number; fileName: string; asAttachment: boolean },
  ): Promise<{ url: string; expiresAt: Date }>;

  remove(bucket: string, objectPath: string): Promise<void>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
