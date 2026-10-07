# หน้าเว็บของระบบย่อย (Next.js standalone) — docs/deployment.md ข้อ 3
# build จากรากของ repo เพราะ pnpm workspace เก็บ lockfile ไว้ที่ราก:
#   docker build -f frontend/Dockerfile -t <ชื่อระบบ>-web .
#
# - BACKEND_URL ถูกฝังลง image ตอน build (rewrites ของ next.config.ts ถูกคำนวณตอน next build)
#   ตั้งตอนรัน container แล้วไม่มีผล · ค่าเริ่มต้น http://api:4000 คือ service "api"
#   ใน compose ของระบบเดียวกัน (deployment.md ข้อ 3.1) — ไม่ต้องแก้
# - ห้ามใส่ secret ใน ARG / ENV — ใครดึง image ไปก็อ่านได้

# ---------- build stage ----------
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable pnpm

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter frontend...

COPY frontend/ frontend/
# บางระบบไม่มี public/ — สร้างไว้ให้ COPY ของ stage ถัดไปไม่พัง
RUN mkdir -p frontend/public
# หน้าที่ prerender ตอน build (เช่นหน้าที่ไม่อ่านคุกกี้) ใช้ค่าตอน build ด้วย
ARG BACKEND_URL=http://api:4000
ARG CORE_HUB_WEB_URL=https://csmju2030.jowave.com
# NEXT_PUBLIC_* ถูกฝังลงไฟล์ JavaScript ตอน build (ตั้งตอนรันไม่มีผล) — ลิงก์กลับพอร์ทัลและหน้าตั้งค่าโปรไฟล์ของ Core Hub
ARG NEXT_PUBLIC_CORE_HUB_WEB_URL=https://csmju2030.jowave.com
ENV BACKEND_URL=$BACKEND_URL \
    CORE_HUB_WEB_URL=$CORE_HUB_WEB_URL \
    NEXT_PUBLIC_CORE_HUB_WEB_URL=$NEXT_PUBLIC_CORE_HUB_WEB_URL
RUN pnpm --filter frontend build

# ---------- runtime stage ----------
FROM node:22-alpine AS runner

WORKDIR /app
# โค้ดฝั่ง server (เช่น fetch ไป /api/v1/me) อ่าน BACKEND_URL ตอนรัน — ให้ตรงกับที่ฝังไว้ตอน build
ARG BACKEND_URL=http://api:4000
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    BACKEND_URL=$BACKEND_URL

# standalone ของ pnpm workspace คงโครงของ workspace ไว้:
# /app/frontend/server.js และ node_modules ที่ trace แล้วอยู่ที่ /app/node_modules
COPY --from=builder --chown=node:node /app/frontend/.next/standalone ./
COPY --from=builder --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=node:node /app/frontend/public ./frontend/public

USER node
EXPOSE 3000

# ตรวจแค่ว่า server รับการเชื่อมต่อ — ไม่ขึ้นกับ backend
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "require('net').connect(3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"

CMD ["node", "frontend/server.js"]
