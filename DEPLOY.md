# ขึ้นระบบจริง (standards `docs/deployment.md` 1.4+)

ระบบย่อยทุกตัวขึ้นบน server ของคณะที่ PM/DevOps ดูแล — **ทีมไม่ได้ deploy เอง** และไม่ใช้บริการภายนอก
(เดิมไฟล์นี้อธิบาย Vercel + Render + Supabase ซึ่งขัดกับมาตรฐานแล้ว)

## ภาพรวม

| | web | api |
|---|---|---|
| image (GitHub Actions build จาก `main` · `.github/workflows/images.yml` ของ DevOps) | `ghcr.io/csmju2030/csmju-nexus-web` | `ghcr.io/csmju2030/csmju-nexus-api` |
| Dockerfile | `frontend/Dockerfile` (Next.js standalone · `BACKEND_URL=http://api:4000` ฝังตอน build) | `backend/Dockerfile` + `backend/docker/entrypoint.sh` |
| พอร์ตใน container | 3000 | 4000 · `GET /api/health` |
| ตอนสตาร์ต | `node frontend/server.js` | `prisma migrate deploy` แล้ว `node dist/main.js` |
| env | `CORE_HUB_WEB_URL` · `SUBSYSTEM_ID` · `TZ` | ทุกตัวใน `backend/.env.example` (server: `NODE_ENV=production` · `PORT=4000` · `DATABASE_POOL_MAX=5`) |

- ชื่อเว็บ: `https://csmju-nexus.jowave.com` (Cloudflare → Apache → `127.0.0.1:<พอร์ตใน csmju-map.txt>`)
- **หลังขึ้น server แล้ว login จาก `localhost` ไม่ได้อีก** (callback ในทะเบียนมีค่าเดียว) — ทดสอบบน server เท่านั้น
- หลังขึ้นครั้งแรก server ดึง `:main` ใหม่เองทุก ~10 นาที → **merge เข้า `main` = deploy** · ย้อนเวอร์ชันให้ DevOps ปักหมุด tag `sha-…`

## ทดสอบในเครื่องแบบเดียวกับ server (deployment.md ข้อ 6)

```bash
# ปิด pnpm dev ก่อน (ใช้พอร์ต 3222 เดียวกัน)
docker compose up -d --build        # db + api + web → http://localhost:3222
docker compose ps                   # db api web ต้อง healthy
docker stats --no-stream            # web + api รวมไม่ควรเกิน ~400 MB (จำกัด api 512m · web 384m)
docker compose down
```

## ข้อมูลสำหรับ DevOps (checklist ข้อ 7.2)

- **ไฟล์ของผู้ใช้เก็บในฐานข้อมูลของระบบ** (ตาราง `stored_objects`) ไฟล์ละไม่เกิน 10 MB · โควตาต่อคนผู้ดูแลปรับได้ — ขนาดฐานโตตามการใช้ ต้องตกลงเพดานรวม (ข้อ 4.3: เกิน 1 GB ต้องตกลง)
- **แชท/สายเรียกเข้า/ห้องเสียง (socket.io)** ผ่าน path `/realtime` ที่ web rewrite ไป api — ใช้ได้ทันทีแบบ long-polling ·
  ถ้าเปิดให้ reverse proxy ส่ง `Upgrade` ของ `/realtime` ไปที่ container api ได้ จะเป็น WebSocket (หน่วงน้อยกว่า) โดยไม่ต้องแก้โค้ด ·
  สถานะห้อง/presence อยู่ในหน่วยความจำ จึงต้องรัน api **instance เดียว**
- เสียง/วิดีโอคอลเป็น WebRTC แบบ P2P (เซิร์ฟเวอร์ส่งแค่ signaling) · STUN สาธารณะตั้งไว้แล้ว · TURN (`TURN_URL` ฯลฯ) ไม่บังคับ
- ค่าลับที่ต้องตั้ง: `STORAGE_URL_SECRET` (`openssl rand -hex 32`) — ไม่ตั้งระบบยังทำงาน แต่ลิงก์ไฟล์ที่แจกไปใช้ไม่ได้หลัง api เริ่มใหม่
- migration ไม่มี `CREATE EXTENSION` (ใช้ได้กับ role ที่ไม่ใช่ superuser)
