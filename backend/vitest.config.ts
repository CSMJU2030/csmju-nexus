import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite รองรับ path จาก tsconfig ได้เองแล้ว ไม่ต้องใช้ vite-tsconfig-paths
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    exclude: ['**/*.e2e-spec.ts', 'node_modules/**', 'dist/**'],
  },
});
