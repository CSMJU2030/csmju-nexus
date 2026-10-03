# REPORT — csmju-nexus

> **ระบบ:** CS Nexus (`csmju-nexus`) · สังคมออนไลน์ วิดีโอสั้น และห้องคอลประจำสาขา
> **มาตรฐาน:** `csmju2030-standards` **1.7.1** (`.standards-version` และ submodule ชี้ v1.7.1)
> **Core Hub:** `https://csmju2030.jowave.com` · ทะเบียน `csmju-nexus` สถานะ **APPROVED / ACTIVE**
> **ระดับ conformance เป้าหมาย:** L3
> **รันเมื่อ:** 3 ต.ค. 2569 บนเครื่องพัฒนา Windows (Node 22 · pnpm 12.6.0) กับ commit `d045d49` บน `main`

## ผลรัน

`./standards/scripts/run-all-checks.sh .` (standards v1.7.1) — 10 บรรทัดสุดท้าย:

```
  ✅ PASS  API Contract Sync           check-api-conventions.sh
  ✅ PASS  Data Dictionary Compliance  check-field-aliases.sh
  ✅ PASS  Data Dictionary Compliance  check-snake-case.sh
  ✅ PASS  Data Dictionary Compliance  check-no-hardcoded-faculty.sh
  ✅ PASS  Data Dictionary Compliance  check-money-fields.sh
  ✅ PASS  UI Token Compliance         check-ui-tokens.sh
  ✅ PASS  Code Quality                check-qa.sh
  ✅ PASS  Exception Validation        check-exceptions.sh

❌ 1 / 19 checks failed — merge would be blocked.
```

ข้อที่ตกคือ **GH-02** ซึ่งเกิดเฉพาะตอนรันในเครื่อง:
- ข้อความที่ตก: `Feature/nexus/import cs nexus (#5)`
- **สาเหตุ:** เป็น title ที่ GitHub ตั้งให้ตอน squash merge PR #5 บน `main` ซึ่งแก้ย้อนหลังไม่ได้แล้ว ในเครื่องสคริปต์หา `origin/main` ไม่เจอ (remote ชื่อ `org`) จึงตรวจทุก commit รวมถึงตัวนี้
- **บน CI ไม่เป็นปัญหา:** CI ตรวจเฉพาะ commit ใน PR ผลบน GitHub ของ PR #5 คือ **CI ผ่านครบ 8/8 ด่าน**
- **บทเรียน:** ตอน squash merge ครั้งต่อไปต้องแก้ title ให้เป็น `type(nexus): …` ก่อนกด Confirm

`CONFORMANCE_ACCOUNTS_FILE=~/.csmju/conformance-accounts.json node standards/conformance/run.js` (standards v1.7.1 · Core Hub จริง) — 10 บรรทัดสุดท้าย:

```
  PASS  L3-18      callback without state → 302 to /auth/login, no session cookie
  PASS  L3-19      callback with a state but no state cookie → 401, no session cookie
  PASS  L3-20      state from one /auth/login with the cookie of another → 401
  PASS  L3-21      next=//evil.example.com still lands on a path of the subsystem itself

── L3 · SSO — sign-out
  PASS  L3-22      POST /auth/logout → 303 to Core Hub web /logout and clears csmju_nexus_access_token

────────────────────────────────────────────────────────────
RESULT: 69 passed · 0 failed · 0 skipped · 0 warnings · retries: 0
✅ CONFORMANT — csmju-nexus meets standard v1.2 L3
```

**เทสต์อื่น:**
- backend unit 118/118 · backend e2e 144/144 (compliance + auth-sso)
- frontend vitest 671/671 · tsc และ ESLint สะอาดทั้งสองฝั่ง
- `next build` / `nest build` ผ่าน

**ทดสอบในเบราว์เซอร์จริงกับ Core Hub จริง** ด้วยบัญชีเจ้าของระบบ, staff และ guest ล็อกอินบัญชีละครั้งเดียว ทุกหน้าผ่าน:
- **ฟีด:** โพสต์รูป, รีแอ็กชัน, คอมเมนต์, แชร์ผ่าน DM, สตอรี่
- **คลิปสั้น:** อัปโหลด, ถูกใจ, คอมเมนต์, รีโพสต์
- **IG Direct:** ส่งข้อความสด, ตอบกลับ, แก้ไข, ปักหมุด, ยกเลิกการส่ง, การ์ดประวัติการโทร
- **ห้องแบบ Discord:** guest สร้างห้องประจำวิชาไม่ได้, รีแอ็กชันกดซ้ำได้, ห้องเสียงไม่หลุดเมื่อเปลี่ยนหน้า
- **อื่นๆ:** การตั้งค่าทุกหน้า, กิจกรรม, การแจ้งเตือน
- **ออกจากระบบ:** ได้ 303 ไป `/logout` ของ Core Hub

## ไฟล์ที่สร้าง/แก้ไข

โค้ดทั้งระบบเข้า repo นี้ใน PR #5 ส่วนหลักมีดังนี้

**backend/**
- `backend/src/auth/`: ชั้น auth ตาม auth-contract 1.2
  - `sso.controller.ts`: `/auth/login`, `/auth/callback`, `/auth/logout`
  - `sso-session.ts`, `next-path.ts`
  - `core-hub-token.verifier.ts`: ตรวจ token 10 ขั้น ผ่าน JWKS + `kid`
  - `jwks.service.ts`, `core-hub-jwt.guard.ts`
  - `me.controller.ts`, `role-mapping.ts`
  - `auth-events.ts`: log แบบ JSON บรรทัดเดียวตาม logging 1.1 · log แค่ path
- `backend/src/common/`: envelope, `http-exception.filter.ts` (error code 9 ค่า · 429/503 มี `Retry-After`), `member-role.ts`, `roles.guard.ts`, storage
- `backend/src/modules/`: โมดูลโดเมน
  - เนื้อหา: posts, reels, stories, comments/reactions, follows, search
  - แชท: channels/messages (IG Direct + ห้องแบบ Discord), realtime (socket.io + WebRTC signaling), voice, calls
  - ผู้ใช้: notifications, blocks, settings, profiles, activity
  - อื่นๆ: assets, admin
- `backend/prisma/`: schema + migration (คอลัมน์ snake_case ผ่าน `@map`) · Prisma **7.9.1** pin เป๊ะ + `PrismaPg`
- `backend/openapi.json`: สร้างจาก `@nestjs/swagger` · JSON field เป็น camelCase · `openapi:check` ผ่าน

**frontend/**
- `frontend/next.config.ts`: rewrite `/api/*` และ `/auth/login|callback|logout` ไป backend (frontend เป็นประตูเดียว)
- `frontend/src/lib/csmju/session.tsx`: ได้ 401 → `/auth/login?next=` พร้อมกันวน · logout เป็นฟอร์ม POST
- `frontend/src/app/`: ทุกหน้า (ฟีด, คลิปสั้น, ข้อความ, ห้อง, การตั้งค่า, กิจกรรม ฯลฯ)
- `frontend/src/app/fonts/`: ฟอนต์ variable (Geist, Geist Mono, Noto Sans Thai · OFL) ผ่าน `next/font/local`
  - เปลี่ยนจาก `next/font/google` ซึ่งทำให้ build ล้มบน CI และ ui-design-system ห้ามใช้

**ราก repo**
- `subsystem.yaml`: name `csmju-nexus` · `base_url http://localhost:3222` · `core_hub_url` / `core_hub_web_url` ชี้ server จริง · public endpoints · probes · role 6 ค่า

## ชั้น auth ที่คัดลอกมา

- **คัดลอกจาก demo-student-subsystem:** ไม่ได้คัดลอกทั้งไฟล์ ระบบนี้เริ่มก่อนที่ demo จะออก SSO 1.1 จึงเขียนตาม `auth-contract.md` 1.2 และใช้โครงเดียวกับ demo
  - ไฟล์อยู่ใน `backend/src/auth/` ตามรายการข้างบน
  - ตรวจกับ conformance 1.7.1 (L1–L3) แล้วผ่าน 69/0/0
- **แก้ไข:** ไม่มีการแก้ตรรกะตรวจ token หลังผ่าน conformance
  - ปัญหา "ผู้ใช้ใหม่ไม่มีชื่อ" ที่เจอระหว่างทดสอบกับ server จริง แก้ฝั่งหน้าบ้านแทน (เรียก `GET /api/v1/subsystem-members/me` หลัง `/me`) โดยไม่แตะ `me.controller.ts`

## Role mapping ที่ประกาศ (ต้องตรงกับ default_role_mapping ในทะเบียน)

| core role | subsystem role |
|---|---|
| student | GUEST |
| alumni | GUEST |
| guest | GUEST |
| staff | EDITOR |
| lecturer | EDITOR |
| admin | ADMIN |

ตรงกันทั้ง `subsystem.yaml`, `backend/src/auth/role-mapping.ts` และทะเบียนใน Core Hub
- สิทธิ์ระดับเจ้าหน้าที่ใช้ `isStaffLike` (staff · lecturer · admin) ทั้ง backend และหน้าจอ
- guest และ alumni สร้างห้องประจำวิชาไม่ได้ (L2-12 ผ่าน)

## ข้อสมมติที่ตั้งเอง (เพราะมาตรฐานไม่ได้ระบุ)

1. **ชื่อที่แสดง:** token ไม่มีชื่อ-นามสกุล และระบบย่อยห้ามเก็บชื่อจริง จึงใช้ส่วนหน้าของอีเมลเป็นชื่อแสดงใน `profile_cache` ซึ่งเป็นแคช ไม่ใช่แหล่งความจริง
2. **realtime:** ใช้ socket.io (อยู่ใน whitelist ตั้งแต่ 1.7.1) เชื่อมตรงไปที่ backend `:4222` เพราะ rewrite ของ Next ส่งต่อ WebSocket ไม่ได้ · socket ตรวจ token ด้วยตัวตรวจชุดเดียวกับ REST
3. **การโทร:** ใช้ WebRTC แบบ mesh สูงสุด 6 คนต่อสาย ไม่มี SFU · ไม่ได้ตั้ง TURN server เพราะต้องฟรี ผู้ใช้หลัง NAT แบบเข้มอาจต่อไม่ติด
4. **ไฟล์แนบ:** เก็บบนดิสก์ของ backend และเข้าถึงด้วย signed URL · object storage ไม่อยู่ใน whitelist
5. **ข้อมูลกลาง** (รหัสวิชาที่ใช้แท็กห้อง/โพสต์): เก็บแค่ `code` ไม่มีตารางหรือ seed รายวิชาของตัวเอง
6. **UI:** ยังไม่ใช้ `@csmju2030/design-system` ตามที่ PM แจ้ง (ใช้แบบที่ทำอยู่ต่อได้) · สีทั้งหมดอยู่ใน CSS variable และ UI-01 ผ่าน

## สิ่งที่ยังทำไม่ได้ / เคสที่ยังไม่ผ่าน

- **ฟีเจอร์ที่กำลังทำใน PR แยก** (เจอตอนทดสอบกับ server จริง ไม่ใช่ regression):
  - เชิญสมาชิกเข้าห้องใน `/chat`
  - ลบโพสต์/คลิป/สตอรี่แล้วคืนพื้นที่และโควตา และลบรีแอ็กชันที่ค้าง
  - หัวแชท DM แสดงชื่อแทนรหัส
- **ยังไม่ได้ขึ้น host จริง:** รอ PM กำหนดว่าใคร deploy ที่ไหน
  - เมื่อขึ้น host ต้องให้ admin เปลี่ยน Callback / Base URL เป็น `https` และตั้ง `NODE_ENV=production` ตาม `connect-core-hub.md` ข้อ 9
- **ทดสอบ role student ยังไม่ได้:** server จริงไม่มีบัญชีรหัสผ่านของนักศึกษา (เข้าด้วย MJU SSO เท่านั้น) ทดสอบได้กับ Core Hub ในเครื่องเท่านั้น
- **แจ้ง PM แล้ว** (ไม่ใช่งานของทีม):
  - design-system 1.3.0 ยังใช้สัญญา auth รุ่นเก่า
  - Next.js อาจพิมพ์ URL ของ callback ที่มี token ลง log เมื่อ backend ล่ม (demo ก็เป็นเหมือนกัน)
