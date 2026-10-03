'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/// เลือกรูปแล้วพรีวิวก่อนอัปโหลด
///
/// คืน File ออกมาด้วย เพราะผู้เรียกต้องเอาไปเข้าท่ออัปโหลดสามจังหวะของ
/// หลังบ้าน (intent → PUT → commit) — hook นี้ไม่อัปโหลดเอง เพื่อให้ใช้ได้
/// ทั้งกับรูปปก สตอรี่ และไฟล์แนบ ที่มีขั้นตอนต่อจากนี้ไม่เหมือนกัน
///
/// ─────────────────────────────────────────────────────────────────────
/// การจัดการ blob URL — จุดที่เคยพลาดสองข้อ
///
/// เบราว์เซอร์ถือ blob ไว้ในหน่วยความจำจนกว่าจะ revoke หรือปิดแท็บ
/// ถ้าผู้ใช้ลองเลือกรูปหลายสิบใบ (เกิดขึ้นจริงตอนเลือกรูปปก) หน่วยความจำ
/// จะบวมโดยไม่มีอะไรบอก
///
/// **ข้อที่หนึ่ง: ห้ามเรียก createObjectURL ใน state updater**
/// เดิมเขียน `setPreviewUrl(current => { revoke(current); return create(file) })`
/// React เรียก updater ซ้ำได้ และ StrictMode เรียกสองครั้งเสมอ — ผลคือสร้าง
/// URL สองอันแต่เก็บอันเดียว อีกอันรั่วถาวร (เทสต์วัดได้ 2 อันต่อไฟล์เดียว)
///
/// **ข้อที่สอง: ให้มีเจ้าของการคืนเพียงที่เดียว**
/// เดิมทั้ง updater และ effect cleanup ต่างก็ revoke ทำให้ URL เดิมถูกคืน
/// สองครั้ง และเมื่อสองที่แย่งกันรับผิดชอบ ก็ไม่มีที่ไหนรับผิดชอบจริง
///
/// ตอนนี้ ref เป็นเจ้าของ URL ปัจจุบัน · การคืนเกิดที่ setPreview เท่านั้น
/// (ซึ่งถูกเรียกจาก event handler ไม่ใช่จาก render) และที่ unmount จริง
///
/// เหตุที่ effect ใช้ deps ว่าง `[]`: StrictMode รัน cleanup หนึ่งครั้งตอน
/// mount ปลอม — ตอนนั้นยังไม่มี URL ให้คืน จึงไม่กระทบ ต่างจากการใส่
/// `[previewUrl]` ที่ cleanup จะคืน URL ที่ยังใช้อยู่แล้วรูปหาย
export function useImageUpload() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  /// URL ที่ยังถืออยู่ตอนนี้ — เจ้าของเดียวของการคืน
  const currentUrl = useRef<string | null>(null);

  const setPreview = useCallback((next: string | null) => {
    if (currentUrl.current && currentUrl.current !== next) {
      URL.revokeObjectURL(currentUrl.current);
    }

    currentUrl.current = next;
    setPreviewUrl(next);
  }, []);

  useEffect(
    () => () => {
      if (currentUrl.current) {
        URL.revokeObjectURL(currentUrl.current);
        currentUrl.current = null;
      }
    },
    [],
  );

  const handleThumbnailClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = event.target.files?.[0];

      if (!picked) return;

      // สร้าง URL นอก updater — ครั้งเดียวต่อไฟล์เสมอ
      setPreview(URL.createObjectURL(picked));
      setFile(picked);
      setFileName(picked.name);
    },
    [setPreview],
  );

  const handleRemove = useCallback(() => {
    setPreview(null);
    setFile(null);
    setFileName(null);

    // ล้างค่าใน input ด้วย ไม่งั้นเลือกไฟล์เดิมซ้ำจะไม่ยิง onChange
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [setPreview]);

  return {
    file,
    fileName,
    previewUrl,
    fileInputRef,
    handleThumbnailClick,
    handleFileChange,
    handleRemove,
  };
}
