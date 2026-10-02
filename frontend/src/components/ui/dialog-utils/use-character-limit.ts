'use client';

import { useState, type ChangeEvent } from 'react';

/// นับตัวอักษรที่เหลือของช่องข้อความ
///
/// นับด้วย [...string].length ไม่ใช่ string.length เพราะ .length นับหน่วย
/// UTF-16 — อิโมจิหนึ่งตัวนับเป็น 2 และสระไทยบางตัวก็เพี้ยน ผู้ใช้จะเห็นเลข
/// ลดเร็วกว่าที่พิมพ์จริง
///
/// ต้องตรงกับเพดานของหลังบ้าน (bio ยาวได้ 300) ไม่งั้นกดบันทึกแล้วได้ 400
/// ทั้งที่ตัวนับยังบอกว่าเหลือที่
export function useCharacterLimit({
  maxLength,
  initialValue = '',
}: {
  maxLength: number;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);

  const handleChange = (
    event: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    const next = event.target.value;

    if ([...next].length <= maxLength) {
      setValue(next);
    }
  };

  return {
    value,
    setValue,
    characterCount: [...value].length,
    handleChange,
    maxLength,
  };
}
