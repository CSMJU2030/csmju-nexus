/// ป้ายแจ้งสั้น ๆ กลางล่างจอแบบ Instagram ("คัดลอกลิงก์แล้ว" · "ส่งแล้ว")
///
/// สร้าง DOM เองแทนการเป็นคอมโพเนนต์ เพราะป้ายต้องอยู่ต่อหลังกล่องที่เรียกมัน
/// ปิดไปแล้ว (กด "ส่ง" → แผ่นแชร์ปิด → "ส่งแล้ว" ยังต้องค้างสองวินาที) และ
/// layout ไม่ใช่ไฟล์ของหน้านี้ จึงไม่มีที่ให้วาง host กลาง
///
/// มีได้ครั้งละหนึ่งป้าย — ป้ายใหม่แทนที่ป้ายเก่า ไม่ซ้อนเป็นกอง

const TOAST_MS = 2200;

let current: { node: HTMLDivElement; timer: ReturnType<typeof setTimeout> } | null = null;

export function toast(message: string): void {
  if (typeof document === 'undefined') return;

  if (current) {
    clearTimeout(current.timer);
    current.node.remove();
  }

  const node = document.createElement('div');

  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.className =
    'pointer-events-none fixed inset-x-0 bottom-20 z-110 flex justify-center px-4 lg:bottom-8 animate-in fade-in-0 slide-in-from-bottom-2';

  const pill = document.createElement('span');

  pill.className =
    'rounded-lg bg-foreground px-4 py-2.5 text-csmju-label font-medium text-background shadow-csmju-md';
  pill.textContent = message;
  node.append(pill);
  document.body.append(node);

  current = {
    node,
    timer: setTimeout(() => {
      node.remove();
      if (current?.node === node) current = null;
    }, TOAST_MS),
  };
}
