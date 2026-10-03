import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/// ชุดทดสอบของหน้าบ้าน
///
/// ไม่ใช้ @vitejs/plugin-react เพราะมันดึง babel รุ่นที่ชนกับของ Next
/// — oxc ที่ vitest ใช้อยู่แล้วแปลง JSX ได้ครบ
///
/// นามสกุล .mts เพราะไฟล์นี้เขียนแบบ ESM แต่ package.json ไม่ได้ตั้ง
/// type: module (ตั้งแล้วจะไปพัง next.config.ts)
///
/// เทสต์ชุดนี้รันในเบราว์เซอร์จำลอง (jsdom) จึงจับสิ่งที่ curl จับไม่ได้:
/// การเรียก setState ข้าม component ระหว่าง render, effect ที่ทำงานซ้ำ,
/// และการวาดที่ผิดพลาด

/// ผู้ใช้ทั้งหมดอยู่ในไทย — เวลาที่แสดง ("09:05" · "เมื่อวาน" · "เข้าร่วมเมื่อ กันยายน")
/// คิดตามเขตเวลาของเครื่องผู้ใช้ เทสต์จึงต้องตรึง Asia/Bangkok ไม่งั้นผ่านในเครื่อง
/// แต่ตกบน CI ของ org ที่รันบน Linux แบบ UTC (เจอจริงตอนเปิด PR แรกใน csmju-nexus)
/// ตั้งก่อน defineConfig เพื่อให้ worker ทุกตัวได้ค่าเดียวกันตั้งแต่เริ่ม
process.env.TZ = 'Asia/Bangkok';

export default defineConfig({
  // vitest 4 แปลง JSX ด้วย oxc อยู่แล้ว ไม่ต้องตั้ง esbuild
  // (ตั้งไปก็ถูกเมิน แล้วขึ้นคำเตือนว่าตั้งซ้อนกัน)
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // เทสต์ที่แชร์ DOM กันต้องไม่ทับกัน
    restoreMocks: true,
  },
});
