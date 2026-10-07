# backend ของระบบย่อย (NestJS) — standards docs/deployment.md ข้อ 3
# build context คือ "รากของ repo" เพราะ pnpm workspace เก็บ lockfile ไว้ที่ราก
#   docker build -f backend/Dockerfile -t csmju-nexus-api .
#
# - ตอนเริ่ม container: prisma migrate deploy แล้วค่อยเปิด server (docker/entrypoint.sh)
# - ค่าทุกอย่างมาจาก env ตอนรัน (DATABASE_URL · CORE_HUB_* · SUBSYSTEM_ID) — ห้ามใส่ secret ใน ARG / ENV

# ---------- build stage ----------
FROM node:22-alpine AS builder

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm

# `prisma generate` (postinstall) โหลด prisma.config.ts ซึ่งต้องมี DATABASE_URL
# การ generate ไม่ได้ต่อฐานข้อมูล ค่านี้จึงเป็นแค่ placeholder ตอน build
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build_only

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# postinstall ของ backend คือ `prisma generate` ซึ่งต้องเห็น schema ตั้งแต่ตอน install
COPY backend/package.json backend/prisma.config.ts backend/
COPY backend/prisma backend/prisma
RUN pnpm install --frozen-lockfile --filter backend...

COPY backend/ backend/
RUN pnpm --filter backend exec prisma generate \
 && pnpm --filter backend build

# ---------- runtime stage ----------
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PORT=4000
RUN corepack enable pnpm

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/prisma.config.ts backend/
COPY backend/prisma backend/prisma
# ต้องรัน install script: @prisma/engines ดาวน์โหลด engine ที่ `prisma migrate deploy` ใช้ตอนนี้
# (ข้ามไปแล้ว container จะพยายามดาวน์โหลดตอนสตาร์ตและพังเพราะเขียน node_modules ไม่ได้)
# store และ cache ของ pnpm ลบทิ้งใน RUN เดียวกัน ไม่งั้นติดไปใน image อีก ~700 MB
RUN pnpm install --frozen-lockfile --prod --filter backend... \
      --store-dir /tmp/pnpm-store \
 && rm -rf /tmp/pnpm-store /root/.cache/pnpm

# dist/ มีทั้งโค้ดที่ compile แล้ว (dist/main.js) และ Prisma client (dist/generated/prisma)
# ไฟล์เป็นของ root แต่ทุกคนอ่านได้ — user node ไม่ต้องเขียนอะไรใน /app
# (ห้าม chown -R ทั้ง /app: Docker จะเก็บไฟล์ทุกไฟล์ซ้ำอีกชั้น image โตขึ้นเท่าตัว)
COPY --from=builder /app/backend/dist ./backend/dist
COPY --chmod=755 backend/docker/entrypoint.sh ./backend/docker/entrypoint.sh

USER node
WORKDIR /app/backend

EXPOSE 4000

# API-05: GET /api/health ตอบ 200 เมื่อพร้อมรับงาน
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "dist/main.js"]
