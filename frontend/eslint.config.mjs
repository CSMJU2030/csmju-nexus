import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma client ที่ generate ออกมา — ไม่ใช่โค้ดที่เราเขียน
    "src/generated/**",
    // submodule ของมาตรฐานกลาง — อ่านอย่างเดียว ห้ามแก้ (ai/AGENTS.md ข้อ 3)
    // ข้างในมี __fixtures__ ที่ **ตั้งใจเขียนผิด** เพื่อให้ self-test ตีตกได้
    // ถ้าปล่อยให้ lint/typecheck ของเรากวาดเข้าไป มันจะแดงตลอดกาลอย่างถูกต้อง
    // ตามเจตนาของไฟล์เหล่านั้น แต่ผิดเจตนาของเรา
    "standards/**",
    // หลังบ้านมี eslint ของตัวเอง (backend/eslint.config.mjs) ที่ตั้งค่าให้
    // NestJS โดยเฉพาะ — ปล่อยให้ตัวนั้นดูแล ไม่ใช่ config ของ Next
    //
    // ที่สำคัญกว่านั้น: `backend/dist/` คือผลลัพธ์การ build และ Prisma Client
    // ที่ถูก generate ขึ้นมา ไม่ใช่โค้ดที่ใครเขียน — มันสร้างคำเตือน 518 ข้อ
    // จากทั้งหมด 546 ข้อ แล้วกลบของจริง 28 ข้อจนมองไม่เห็น
    "backend/**",
  ]),
]);

export default eslintConfig;
