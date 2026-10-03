import { Loader2 } from 'lucide-react';

/// สิ่งที่ผู้ใช้เห็นระหว่างสลับหน้า
///
/// ไม่มีไฟล์นี้ = กดเมนูแล้วหน้าค้างอยู่ที่เดิมจนกว่าหน้าใหม่จะพร้อม
/// ผู้ใช้จะไม่รู้ว่ากดติดหรือยัง แล้วกดซ้ำ — เห็นชัดเป็นพิเศษบนชั้นใช้ฟรี
/// ที่หลังบ้านเพิ่งตื่นจากการหลับ ซึ่งคำขอแรกใช้เวลาหลายวินาที
///
/// เป็น Server Component และไม่มี state — Next แสดงไฟล์นี้ให้อัตโนมัติ
/// ระหว่างที่ page ของเส้นทางนั้นยังโหลดไม่เสร็จ
export default function Loading() {
  return (
    <div
      // role=status ให้โปรแกรมอ่านหน้าจอประกาศว่ากำลังโหลด
      // ไม่ใช่เงียบไปเฉย ๆ จนผู้ใช้คิดว่าไม่มีอะไรเกิดขึ้น
      role="status"
      className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 px-4 text-center"
    >
      <Loader2
        className="size-6 animate-spin text-muted-foreground"
        aria-hidden="true"
      />

      <p className="text-sm text-muted-foreground">กำลังโหลด…</p>
    </div>
  );
}
