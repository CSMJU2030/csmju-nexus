/// สัญญาของที่เก็บไฟล์ — สลับผู้ให้บริการได้โดยไม่แตะโค้ดโดเมน
///
/// การอัปโหลดต้องไม่ให้ไบต์ไหลผ่าน backend บน production เพราะ
///   1. กิน bandwidth ฟรีที่มีจำกัด
///   2. ทำให้ backend ต้องรับ body ขนาดใหญ่ซึ่งเปลืองหน่วยความจำ
/// ฉะนั้น production ออก signed URL ให้เบราว์เซอร์ PUT ตรงเข้าที่เก็บ
/// (ตัว LocalDiskStorage สำหรับ dev รับไบต์ผ่าน backend ซึ่งยอมรับได้ในเครื่อง)

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
