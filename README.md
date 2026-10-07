# CS Nexus

ศูนย์กลางชุมชนออนไลน์ของสาขาวิทยาการคอมพิวเตอร์ — ผสมสิ่งที่แต่ละแอปทำได้ดี
ไว้ในที่เดียว: ฟีดและกระดานถามตอบแบบ **Facebook** · คลิปสั้นและสตอรี่แบบ
**Instagram** · ห้องแชทและห้องเสียงแบบ **Discord** · นัดประชุมและเธรดแบบ
**Microsoft Teams**

ระบบย่อยภายใต้ **CSMJU2030** · repo `CSMJU2030/csmju-nexus` · มาตรฐาน 1.7.0 (`.standards-version`)

---

## เริ่มใช้งาน

ต้องเปิดสองระบบ: **Core Hub** (ผู้ให้ตัวตน อีก repo หนึ่ง) แล้วค่อยเป็น **ระบบนี้**

ระบบนี้ไม่มีหน้า login ของตัวเอง (มาตรฐานห้าม · `auth-contract.md` ข้อ 5)
ทำตาม **standards 1.7.0 (SSO 1.1)**: หน้าบ้าน `http://localhost:3222` เป็นประตูเดียว
— `/api/*` และ `/auth/login` `/auth/callback` `/auth/logout` ถูก rewrite ไปหลังบ้าน :4222

```text
ปุ่มเข้าสู่ระบบ / API ตอบ 401 → /auth/login?next=<หน้าเดิม>   (หลังบ้านสร้าง state + คุกกี้ state)
  → 302 {CORE_HUB_WEB_URL}/sso/authorize?subsystem=csmju-nexus&state=…
  → ล็อกอินที่ Core Hub (หรือผ่านเงียบ ๆ ถ้าล็อกอินอยู่แล้ว)
  → /auth/callback?access_token=…&state=…  ตรวจ state + token 10 ขั้น
  → คุกกี้ csmju_nexus_access_token (HttpOnly) → กลับหน้าเดิม
ออกจากระบบ = ฟอร์ม POST /auth/logout → ลบคุกกี้ → 303 {CORE_HUB_WEB_URL}/logout
```

**ถ้า Core Hub ไม่ได้รัน จะเจอ `ERR_CONNECTION_REFUSED`** ซึ่งไม่ใช่ระบบนี้พัง
Core Hub ต้องเป็นรุ่นที่มีหน้า `/sso/authorize` และ `/logout` (SSO 1.1 ขึ้นไป) — รุ่นเก่าที่มีแค่
`/api/sso/<ชื่อ>` จะส่ง state ของตัวเองมา แล้ว callback ตอบ 401 "เข้าสู่ระบบอีกครั้ง" ซึ่งถูกต้องตามสัญญา
รายละเอียดทั้งหมด: [docs/ต่อกับ-core-hub.md](docs/ต่อกับ-core-hub.md)

### 1. Core Hub (:3000 API · :3100 หน้า login)

วิธีตั้งครั้งแรก (สร้างกุญแจ · ลงทะเบียนระบบนี้) ดู [docs/ต่อกับ-core-hub.md](docs/ต่อกับ-core-hub.md)
ตั้งเสร็จแล้ว ครั้งต่อไปเปิดแค่สองเทอร์มินัล ในโฟลเดอร์ของ Core Hub:

```bash
cd backend && node dist/src/main.js      # :3000
pnpm --filter frontend dev               # :3100 (สั่งจากรากของ Core Hub)
```

### 2. ระบบนี้ — ทางที่ 1: Docker (คำสั่งเดียว)

```bash
docker compose up -d --build
```

ได้ฐานข้อมูล · migration · หลังบ้าน · หน้าบ้าน ครบในคำสั่งเดียว
ถ้าเคยเปิดฐานข้อมูลด้วย `pnpm --filter backend db:up` ไว้ ให้ปิดก่อน
(`pnpm --filter backend db:down`) ไม่งั้นพอร์ต 55432 จะชนกัน — ข้อมูลไม่หาย
เพราะทั้งสองทางใช้ volume เดียวกัน

### 2. ระบบนี้ — ทางที่ 2: รันเองตอนพัฒนา

```bash
pnpm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

pnpm --filter backend db:up                      # PostgreSQL :55432
pnpm --filter backend exec prisma migrate deploy # ลงตาราง
pnpm --filter backend start:dev                  # หลังบ้าน :4222 (เปิดค้างไว้)
pnpm --filter frontend dev                       # หน้าบ้าน :3222 (เทอร์มินัลใหม่)
```

> ใช้ `prisma migrate deploy` ไม่ใช่ `migrate dev` — อย่างหลังอาจสร้าง migration
> ที่ drop คอลัมน์แล้วสร้างใหม่ ทำให้ **ข้อมูลหาย** (`data-dictionary.md` ข้อ 9)
>
> ต้องใช้ `pnpm` เท่านั้น (กฎ `QA-05`) — `npm install` จะสร้าง
> `package-lock.json` ซึ่ง CI ไม่รับ

เปิด **http://localhost:3222**

เปิดด้วย `localhost` เท่านั้น ไม่ใช่ `127.0.0.1` — คุกกี้ผูกกับชื่อ host และ callback ลงทะเบียนเป็น localhost

| ที่อยู่ | คืออะไร |
|---|---|
| http://localhost:3222 | หน้าบ้าน (ประตูเดียวของระบบ) |
| http://localhost:3222/api/v1 | API (rewrite ไป :4222) |
| http://localhost:3222/api/health | สถานะระบบ |
| http://localhost:4222/api/docs | เอกสาร API (Swagger) |
| ws://localhost:4222/realtime | socket.io — ต่อตรงที่หลังบ้าน เพราะ rewrite ของ Next ส่งต่อ WebSocket ไม่ได้ |
| http://127.0.0.1:3100 | เว็บ Core Hub (หน้า login · `/sso/authorize` · `/logout`) |

ค่า env ที่เกี่ยวกับ SSO: `backend/.env` ต้องมี `CORE_HUB_WEB_URL` · `frontend/.env.local` ต้องมี `BACKEND_URL`
(ดู `.env.example` ทั้งสองไฟล์) · แก้ `next.config.ts` หรือ `.env.local` แล้วต้องรีสตาร์ต `next dev`

**บัญชีสำหรับทดสอบ** (จาก seed ของ Core Hub · ใช้ในเครื่องพัฒนาเท่านั้น)

| email | รหัสผ่าน | สิทธิ์ในระบบนี้ |
|---|---|---|
| `admin@core.local` | `password1` | ADMIN |
| `staff@core.local` | `password3` | EDITOR |
| `student@core.local` | `password2` | GUEST |

---

## ระบบอัตโนมัติ

ครั้งแรกที่ clone ให้รันหนึ่งครั้ง:

```bash
pnpm run setup         # เปิดใช้ git hooks (ต้องมีคำว่า run — `pnpm setup` เป็นคำสั่งอื่นของ pnpm)
```

หลังจากนั้นจะมีสองด่านทำงานให้เอง:

| เมื่อไหร่ | ตรวจอะไร | ใช้เวลา |
| --- | --- | --- |
| ก่อน commit | ชนิดข้อมูลของฝั่งที่แก้ + ดักไฟล์ความลับ | ~3 วิ |
| ก่อน push | ชนิดข้อมูล · กฎการเขียนโค้ด · เทสต์ ทั้งสองฝั่ง · openapi ตรงกับโค้ด | ~40 วิ |

ตรวจตามมาตรฐานชุดเดียวกับ CI ได้ด้วย `pnpm check:standards`
(`bash standards/scripts/run-all-checks.sh .` — ต้อง `git submodule update --init` ก่อน)

## ขึ้นระบบจริง

ดู [DEPLOY.md](DEPLOY.md) — ขึ้นบน server ของคณะผ่าน image บน ghcr.io (PM/DevOps ดูแล · standards `deployment.md`)
และวิธีทดสอบในเครื่องแบบเดียวกับ server ด้วย `docker compose up -d --build`

## เจอปัญหาบ่อย ๆ

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| กดเข้าสู่ระบบแล้วขึ้น `ERR_CONNECTION_REFUSED` ที่ `127.0.0.1:3100` | Core Hub ไม่ได้รัน — **ไม่ใช่ระบบนี้พัง** | เปิด Core Hub ตามหัวข้อ "เริ่มใช้งาน" ข้อ 1 |
| login ผ่านแล้วแต่ API ตอบ 401 ทุกคำขอ | Core Hub เพิ่งสร้างกุญแจใหม่ หลังบ้านยังถือกุญแจเก่าในแคช | รีสตาร์ตหลังบ้าน แล้ว login ใหม่ |
| หน้าเว็บขึ้น "ติดต่อหลังบ้านไม่ได้" | หลังบ้านไม่ได้รัน | `pnpm --filter backend start:dev` |
| `Can't reach database server at 127.0.0.1:55432` | คอนเทนเนอร์ไม่ได้รัน — **ไม่ใช่โค้ดพัง** | `pnpm --filter backend db:up` |
| `EADDRINUSE :::4222` | มีเซิร์ฟเวอร์ค้างอยู่ | ดูคำสั่งด้านล่าง |

พอร์ตค้างบน Windows (`kill` กับ `pkill` ใช้ไม่ได้):

```bash
powershell -Command "Get-NetTCPConnection -LocalPort 4000 -State Listen | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
```

---

## โครงสร้าง

```
csmju-nexus/
├── frontend/src/           หน้าบ้าน — Next.js 16 (App Router) · React 19 · Tailwind v4
│   ├── app/(app)/          หน้าจอทั้งหมด ใต้เปลือกเดียวกัน
│   ├── components/ui/      component ที่ใช้ซ้ำได้ (แบบ shadcn)
│   ├── components/csmju/   component ที่ผูกกับโดเมนของเรา
│   └── lib/csmju/          ชั้นเรียก API · socket · ตัวตน · ชนิดข้อมูล
├── backend/                หลังบ้าน — NestJS 12 (ESM) · Prisma 7 · PostgreSQL 17
├── standards/              submodule มาตรฐานกลาง (ห้ามแก้)
├── .github/                CI และ CODEOWNERS ของ org (ห้ามแก้)
└── subsystem.yaml          manifest ของระบบย่อย (CI และ conformance อ่านไฟล์นี้)
```

**หน้าบ้านไม่ต่อฐานข้อมูลเอง** (Blueprint หน้า 13) ทุกอย่างผ่าน
`frontend/src/lib/csmju/api.ts` — ถ้าเห็น `import` ของ Prisma หรือ `pg` ใน `frontend/`
นั่นคือการละเมิดข้อห้าม ไม่ใช่ทางลัด

รายละเอียดของหลังบ้านทั้งหมด (สถาปัตยกรรม เหตุผลของแต่ละการตัดสินใจ
ข้อจำกัดที่รู้ตัว) อยู่ที่ [`backend/README.md`](backend/README.md)

---

## หน้าจอ

| หน้า | เทียบกับ | ทำอะไรได้ |
|---|---|---|
| ฟีดชุมชน | Facebook | ตั้งกระทู้ · อิโมจิ 12 แบบ · คอมเมนต์ · บันทึก · แท็กวิชา |
| คลิปสั้น | Instagram | อัปโหลด · เล่น · ไลก์ · คอมเมนต์ · ยอดผู้ชม |
| สตอรี่ | Instagram | โพสต์ · ดูแบบเต็มจอ · หมดอายุ 24 ชั่วโมง · รายชื่อผู้ชม |
| ข้อความ | Instagram | DM หนึ่งต่อหนึ่ง · โทรด้วยเสียง |
| ห้องแชท | Discord · Teams | ข้อความสด · เธรด · ปักหมุด · แก้ข้อความ · `@` เมนชัน |
| ห้องเสียง | Discord | WebRTC mesh · แชร์หน้าจอ · เพดาน 8 ที่นั่ง |
| นัดประชุม | Teams | นัดล่วงหน้า · แจ้งทุกคนในห้อง |
| โปรไฟล์ · ค้นหา · ที่บันทึกไว้ · แผงผู้ดูแล | ทั้งสี่ | ติดตาม · ค้น 4 หมวด · audit log · สิทธิ์ · โควตา |

---

## การทดสอบ

สามชุด แยกตามสิ่งที่แต่ละชุดจับได้จริง — **ไม่มีชุดไหนแทนกันได้**

```bash
pnpm --filter frontend test   # หน้าบ้าน — component ในเบราว์เซอร์จำลอง
pnpm --filter backend test    # หลังบ้าน — หน่วยทดสอบ
pnpm test:e2e                 # หลังบ้าน — มาตรฐาน API และความปลอดภัย (ต้องมีฐานข้อมูล)
```

| ชุด | รันที่ไหน | จับอะไรได้ | จับอะไรไม่ได้ |
|---|---|---|---|
| หน้าบ้าน (vitest + jsdom) | เบราว์เซอร์จำลอง | วงจร render · effect ซ้ำ · หน่วยความจำรั่ว | กฎของ API จริง |
| หลังบ้าน (supertest) | โพรเซสเดียวกับ Nest | envelope · สิทธิ์ · การกันเข้าถึงข้ามคน | **CORS** และทุกอย่างที่เบราว์เซอร์บังคับ |
| สคริปต์ยิงจริง | ต่อเซิร์ฟเวอร์ที่รันอยู่ | socket · WebRTC · การต่อใหม่ | — |

### บทเรียนสองข้อที่ได้มาแบบเจ็บตัว

**หนึ่ง: HTTP 200 จาก curl ไม่ได้แปลว่าเบราว์เซอร์ใช้งานได้**

หลังบ้านไม่ได้เปิด CORS เลย เบราว์เซอร์บล็อกทุกคำขอด้วย "Failed to fetch"
แต่เทสต์ 40 ตัวเขียวหมด เพราะ supertest, curl และ node fetch **ไม่บังคับ CORS**
— มันเป็นกฎที่เบราว์เซอร์บังคับฝ่ายเดียว

หน้าเว็บเรนเดอร์ได้ (นั่นคือ SSR shell) แต่ไม่เคยโหลดข้อมูลได้เลยสักครั้ง
ตอนนี้มีเทสต์ที่ตรวจ **header ที่ตอบกลับ** ไม่ใช่แค่ status code

**สอง: การไล่ assert คำเตือนของ React ทีละที่ เชื่อถือไม่ได้**

เดิมเขียนเทสต์ที่ดัก `console.error` แล้ว assert ว่าไม่มี
"Cannot update a component" — **เทสต์นั้นเขียวทั้งที่บั๊กยังอยู่ครบ**
เพราะ React แจ้งคำเตือนแต่ละแบบครั้งเดียวต่อคู่ component เทสต์ก่อนหน้า
ในไฟล์เดียวกันกินคำเตือนไปแล้ว

ตอนนี้ [`frontend/vitest.setup.ts`](frontend/vitest.setup.ts) ดักที่ระดับชุดทดสอบ:
`console.error` ครั้งแรกที่เกิดในเทสต์ไหนก็ตาม **ทำให้เทสต์นั้นแดงทันที**
เทสต์ที่ตั้งใจให้เกิด error เรียก `expectConsoleError()` เพื่อขออนุญาต

---

## บั๊กที่ชุดทดสอบหน้าบ้านจับได้ (และวิธีพิสูจน์ว่าเทสต์ใช้ได้จริง)

ทั้งสองตัวเป็นบั๊กชนิดเดียวกัน: **ผลข้างเคียงอยู่ใน state updater**
React เรียก updater ระหว่าง render และเรียกซ้ำได้ (StrictMode เรียกสองครั้งเสมอ)
สิ่งที่อยู่ในนั้นต้องเป็นการคำนวณค่าใหม่ล้วน ๆ

### 1. ตัวเล่นสตอรี่ปิดตัวเองไม่ได้

```ts
setIndex((current) => {
  if (current + 1 >= stories.length) {
    onClose();          // ← setState ของ component แม่ ระหว่าง render
    return current;
  }
  return current + 1;
});
```

React ฟ้อง `Cannot update a component (StoryViewer) while rendering a
different component (StoryOverlay)` — แก้โดยอ่าน `index` จาก state ตรง ๆ
แล้วตัดสินใจนอก updater

### 2. blob URL รั่วตอนเลือกรูป

```ts
setPreviewUrl((current) => {
  if (current) URL.revokeObjectURL(current);
  return URL.createObjectURL(picked);   // ← สร้าง URL ใหม่ในทุกครั้งที่ updater ถูกเรียก
});
```

วัดได้: **StrictMode สร้าง 2 URL ต่อไฟล์เดียว · 3 URL รั่ว · 1 URL คืนซ้ำ**
เบราว์เซอร์ถือ blob ไว้จนปิดแท็บ ผู้ใช้ที่ลองเลือกรูปหลายสิบใบจะกินหน่วยความจำ
โดยไม่มีอะไรบอก

แก้โดยให้ ref เป็นเจ้าของ URL ปัจจุบัน และคืนที่เดียวคือใน event handler

### พิสูจน์ว่าเทสต์จับได้จริง

เทสต์ที่ไม่เคยเห็นตัวเองแดง ไม่ต่างจากไม่มีเทสต์ — ทั้งสองข้อจึงยืนยันด้วยการ
**เอาบั๊กกลับเข้าไปแล้วดูว่าแดง** ก่อนเอาโค้ดที่แก้แล้วกลับมา

หลังแก้ยังกวาดทั้ง `src/` ด้วยสคริปต์หา `setX(prev => { ... })` ที่มีผลข้างเคียง
ข้างใน — ไม่พบที่อื่นอีก

---

## CI Gate

`.github/workflows/ci.yml` ของ org เรียก workflow กลาง `subsystem-compliance.yml`
ของ `csmju2030-standards` — 8 job ต้องเขียวทั้งหมด (Convention · Standards Version ·
Security & Stack · API Contract Sync · Data Dictionary · UI Token · Code Quality ·
Exception Validation) และ PL (`@csmju2030/pl-nexus`) ต้อง approve ตาม CODEOWNERS
ไฟล์ใน `.github/` และ `standards/` แก้ไม่ได้ — DevOps ดูแล

`openapi:check` เทียบ `openapi.json` ที่ commit ไว้กับโค้ดปัจจุบัน —
จับกรณีที่มีคนเพิ่ม endpoint แล้ว commit โดยไม่ได้บูตเซิร์ฟเวอร์ ซึ่งทำให้
contract ใน repo เก่ากว่าโค้ด แล้วระบบย่อยอื่นเขียนโค้ดผิดตาม

---

## ที่ยังไม่ได้ทำ

| เรื่อง | สถานะ |
|---|---|
| ย้ายไปใช้ `@csmju2030/design-system` | รอสิทธิ์ `read:packages` และคำชี้ขาดเรื่องสัญญา auth ของ DS (UI-01 จะตกจนกว่าจะย้ายเสร็จ) |
| TURN server | ยังไม่มี — ผู้ใช้หลัง NAT ที่เจาะไม่ได้จะเชื่อมเสียงไม่ติด (หน้าจอเตือนแล้ว) |
