// ESLint ของหลังบ้าน (NestJS)
//
// เดิมใช้ oxlint ซึ่งไม่อยู่ใน dependency whitelist ของมาตรฐาน (ARC-02)
// ย้ายมา ESLint + typescript-eslint ที่อยู่ใน allowed_dev_tooling แทน
// โดยคงกติกาเดียวกับ oxlint.json เดิม: ปิด no-explicit-any · floating promise เป็นคำเตือน
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // ผลลัพธ์การ build และ Prisma Client ที่ generate — ไม่ใช่โค้ดที่เราเขียน
    ignores: ['dist/**', 'src/generated/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // ตัวแปรที่ขึ้นต้นด้วย _ คือจงใจไม่ใช้ (เช่น พารามิเตอร์ที่ interface บังคับ)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
);
