import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // เทสต์ e2e ใช้ฐานข้อมูลจริงร่วมกัน จึงห้ามรันขนานกัน
    fileParallelism: false,
  },
});
