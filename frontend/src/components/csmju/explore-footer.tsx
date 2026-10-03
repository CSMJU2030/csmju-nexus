/// ท้ายหน้าสำรวจแบบ Instagram — ตัวหนังสือเทาเล็ก ลิงก์เรียงต่อกันแล้วตัดบรรทัดเอง
///
/// **ลิงก์เฉพาะสิ่งที่มีอยู่จริงในระบบ** ระบบนี้ยังไม่มีหน้าเกี่ยวกับ/ช่วยเหลือ/
/// นโยบาย — ถ้าใส่ href ลอย ๆ จะได้ 404 ซึ่งแย่กว่าตัวหนังสือเฉย ๆ จึงเป็นข้อความ
/// ธรรมดาไว้ก่อน เหลือลิงก์เดียวคือเอกสาร API (Swagger ที่หลังบ้านเสิร์ฟที่
/// `/api/docs` — backend/src/main.ts `SwaggerModule.setup('api/docs', …)`)

/// หน้าบ้านเป็นประตูเดียว (standards 1.7) — /api/* ถูก rewrite ไปหลังบ้าน จึงใช้ path เดียวกับหน้าเว็บ
const API_DOCS = '/api/docs';

const ITEMS: Array<{ label: string; href?: string | null }> = [
  { label: 'เกี่ยวกับ' },
  { label: 'ความช่วยเหลือ' },
  { label: 'API', href: API_DOCS },
  { label: 'ความเป็นส่วนตัว' },
  { label: 'ข้อกำหนด' },
  { label: 'ภาษา ไทย' },
];

export function ExploreFooter() {
  return (
    <footer className="mt-12 px-4 pb-4 text-center text-csmju-caption text-muted-foreground">
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {ITEMS.map((item) => (
          <li key={item.label}>
            {item.href ? (
              <a href={item.href} target="_blank" rel="noreferrer" className="hover:underline">
                {item.label}
              </a>
            ) : (
              <span>{item.label}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3">© 2026 CS Nexus · CSMJU2030 มหาวิทยาลัยแม่โจ้</p>
    </footer>
  );
}
