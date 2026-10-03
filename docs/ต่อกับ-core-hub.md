# ต่อระบบเรากับ Core Hub (standards 1.7.0 · SSO 1.1)

**อ้างอิง:** `csmju2030-standards` v1.7.0 — `docs/auth-contract.md` (ฉบับ 1.2) · `docs/connect-core-hub.md` · `docs/conformance.md`
**ย้ายจาก 1.0 มา 1.7 เมื่อ:** 2 ต.ค. 2569
**สถานะ:** conformance 1.7.0 ผ่าน **69/69 · 0 failed · 0 skipped** ผ่าน `http://localhost:3222` กับ Core Hub ในเครื่อง

> ⚠️ **standards 1.7.0 สั่งว่า "ไม่ต้องโคลนหรือรัน Core Hub เอง — repo ของ Core Hub มีข้อมูลนักศึกษาจริง
> ถ้าเคยโคลนไว้ให้ลบทิ้ง"** (connect-core-hub.md บรรทัดแรก)
> ทดสอบกับ server จริงแทน Core Hub ในเครื่องทุกครั้งที่ทำได้

---

> **อัปเดต 2 ต.ค. 2569 — ต่อ Core Hub ตัวจริงแล้ว:** ระบบชื่อ `csmju-nexus` · frontend `3222` · backend `4222` ·
> `CORE_HUB_URL` = `CORE_HUB_WEB_URL` = `https://csmju2030.jowave.com` · ลงทะเบียนด้วยบัญชีเจ้าของระบบของทีมแล้ว
> (callback `http://localhost:3222/auth/callback`) — **รอ admin ระบบกลางอนุมัติ + เปิดใช้งาน** ก่อนจึงจะ login ได้ ·
> บัญชี conformance อยู่นอก repo ที่ `~/.csmju/conformance-accounts.json` (`CONFORMANCE_ACCOUNTS_FILE`) ·
> ส่วนที่เหลือของเอกสารนี้เขียนตอนรันกับ Core Hub ในเครื่อง ใช้เป็นทางเลือกเมื่อ server จริงล่ม

## 1. Flow — ผู้ใช้เดินทางยังไง

หน้าบ้าน `:3222` เป็น**ประตูเดียวของระบบ** (`frontend/next.config.ts` rewrite `/api/*` และ
`/auth/login` `/auth/callback` `/auth/logout` ไปที่หลังบ้าน `:4222`) คุกกี้ทั้งหมดจึงอยู่บน origin ของหน้าเว็บ

### 1.1 เข้าจากระบบเรา (ทางหลัก)

```text
① ปุ่ม "เข้าสู่ระบบ" หรือ API ตอบ 401 → เบราว์เซอร์ไปทั้งหน้า (window.location)
     GET http://localhost:3222/auth/login?next=/reels?id=7
② หลังบ้าน: state สุ่ม 32 ไบต์ (base64url)
     Set-Cookie: csmju_nexus_sso_state=<state>.<next base64url>
                 HttpOnly; SameSite=Lax; Path=/auth/callback; Max-Age=600 (Secure เมื่อ production)
     302 {CORE_HUB_WEB_URL}/sso/authorize?subsystem=csmju-nexus&state=<state>   (ไม่ส่ง callback_url)
③ เว็บ Core Hub: ล็อกอินอยู่แล้ว = ผ่านเงียบ ๆ · ยังไม่ล็อกอิน = หน้า login แล้วกลับมาข้อ ③
     Core Hub ตรวจ: มีในทะเบียน → APPROVED → ACTIVE → role เป็น key ใน role mapping (ไม่ผ่าน = หน้า /sso/error ของ Core Hub)
④ 302 http://localhost:3222/auth/callback?access_token=…&token_type=Bearer&expires_in=900&state=<state>
⑤ หลังบ้าน (ตาราง 5.1):
     ตั้งคุกกี้ลบ state **ก่อน**ตรวจ (ใช้ได้ครั้งเดียว) · เทียบ state แบบ constant-time
     ตรวจ token 10 ขั้น → แมป role → Set-Cookie csmju_nexus_access_token
       (HttpOnly; SameSite=Lax; Path=/; Max-Age = exp − ตอนนี้) → 302 ไป next (ตรวจ next ซ้ำ)
⑥ หน้าบ้านถาม GET /api/v1/me → ได้ตัวตน + session.expiresAt
```

### 1.2 เข้าจาก sidebar ของ Core Hub

Core Hub เป็นคนเริ่ม จึงไม่มี state → callback **ทิ้ง token · ไม่ตั้งคุกกี้ใดเลย · ไม่แตะคุกกี้ state** → `302 /auth/login`
→ วิ่งข้อ ② ต่อ ผู้ใช้ล็อกอินอยู่แล้วจึงผ่านเองโดยไม่เห็นหน้าอะไร
ลิงก์ callback ที่มี token ของผู้โจมตีจึงทำให้เหยื่อได้ session ของผู้โจมตีไม่ได้ (กัน login CSRF)

### 1.3 ตาราง callback (auth-contract.md ข้อ 5.1) — ทุกแถวมี e2e ใน `backend/test/auth-sso.e2e-spec.ts`

| callback มาแบบ | ตอบ |
|---|---|
| ไม่มี `access_token` | `400` |
| ไม่มี `state` | `302 /auth/login` · ไม่มี `Set-Cookie` เลย |
| มี state แต่ไม่มีคุกกี้ state / ไม่ตรง | `401` ไม่ redirect · ขอ `text/html` ได้หน้าไทยมีลิงก์ "เข้าสู่ระบบอีกครั้ง" |
| token ไม่ผ่าน 10 ขั้น | `401` |
| role ที่ไม่รับ | `403` |
| ผ่านทุกข้อ | คุกกี้ session + `302` ไป next |

ทุกคำตอบของ `/auth/*` มี `Cache-Control: no-store` · callback มี `Referrer-Policy: no-referrer` ·
log เป็น JSON บรรทัดเดียว เฉพาะ `path` (ไม่มี URL เต็ม ไม่มี header Cookie)

### 1.4 token หมดอายุ (15 นาที) และกันวน

API ตอบ `401` → `SessionProvider` (`frontend/src/lib/csmju/session.tsx`) พาทั้งหน้าไป
`/auth/login?next=<path+query ปัจจุบัน>` แล้ว Core Hub ต่ออายุให้เงียบ ๆ
**กันวน:** ถ้าเพิ่งพาไปไม่ถึง 30 วินาทีแล้วยังได้ 401 → แสดงปุ่ม "เข้าสู่ระบบอีกครั้ง" แทนการ redirect ซ้ำ
(sessionStorage `csmju:last-resso` · ใช้ sessionStorage ไม่ได้ = ให้กดเองเสมอ)

### 1.5 ออกจากระบบ

`useSignOut()` ส่ง**ฟอร์ม POST** ไป `/auth/logout` → หลังบ้านลบคุกกี้ทั้งสอง (Path เดิมของแต่ละตัว)
→ `303 {CORE_HUB_WEB_URL}/logout` ให้ผู้ใช้ยืนยันออกจาก Core Hub
(ตัวเดิม `POST /api/v1/auth/logout` ที่ส่ง token ไปเพิกถอนเองถูกถอดแล้ว — token ห้ามส่งไป endpoint นอกรายการ ข้อ 6.1)

### 1.6 socket.io

rewrite ของ Next ส่งต่อ WebSocket ไม่ได้ socket.io จึงต่อตรง `ws://localhost:4222/realtime`
คุกกี้ session เป็น host-only ของ `localhost` และคุกกี้ไม่แยกพอร์ต จึงติดไปที่ `:4222` ด้วย
(ทดสอบในเบราว์เซอร์จริงแล้ว: จับมือด้วยคุกกี้อย่างเดียวสำเร็จ · ยังมีตั๋ว 60 วินาทีจาก `POST /api/v1/realtime-tickets` เป็นทางสำรอง)
ตอนขึ้น host จริงที่ frontend กับ backend คนละโดเมน ทางคุกกี้จะใช้ไม่ได้ เหลือทางตั๋ว

---

## 2. พอร์ตและ host

| พอร์ต | ใคร | หมายเหตุ |
| ---: | --- | --- |
| `3000` | Core Hub API | `CORE_HUB_URL=http://localhost:3000` |
| `3100` | Core Hub เว็บ | `CORE_HUB_WEB_URL=http://127.0.0.1:3100` — รันด้วย `next dev -H 127.0.0.1` |
| `4222` | หลังบ้านเรา (พอร์ตที่ PM กำหนดให้ csmju-nexus) | ไม่ต้องเปิดให้เบราว์เซอร์ใช้ตรง ยกเว้น socket.io |
| `3222` | หน้าบ้านเรา (พอร์ตที่ PM กำหนดให้ csmju-nexus) | **ประตูเดียว** · Callback URL ในทะเบียน = `http://localhost:3222/auth/callback` |
| `55432` | PostgreSQL | คนละ database กับ Core Hub |

**localhost กับ 127.0.0.1 ต่างกันจริง** (คุกกี้ผูกกับชื่อ host ไม่แยกพอร์ต):
- ระบบเราต้องเปิดด้วย `localhost:3222` เพราะ callback ลงทะเบียนเป็น localhost — เปิดด้วย 127.0.0.1 แล้วคุกกี้ state
  อยู่คนละ host กับ callback → 401 "เข้าสู่ระบบอีกครั้ง"
- เว็บ Core Hub ในเครื่องต้องใช้ `127.0.0.1:3100` ตรงกับที่ผู้ใช้ล็อกอิน เพราะคุกกี้ `csmju_access_token` ของมันเป็น
  host-only ของ 127.0.0.1 ถ้า `/sso/authorize` อยู่ที่ localhost:3100 คุกกี้ไม่ติดไป ต้องล็อกอินใหม่ทุกครั้ง
- ผลดีข้างเคียง: คุกกี้ของเว็บ Core Hub (127.0.0.1) ไม่ไหลมาที่ระบบเรา (localhost) — ตรวจในเบราว์เซอร์แล้ว
  และต่อให้ไหลมา ระบบเราก็ไม่อ่าน (อ่านเฉพาะ `csmju_nexus_access_token` · ข้อ 6)

---

## 3. ตั้งเครื่อง

### 3.1 ระบบเรา

```bash
pnpm install
pnpm --filter backend exec prisma migrate deploy        # ห้าม migrate reset
pnpm --filter backend build && node backend/dist/main.js # :4222
pnpm --filter frontend dev                               # :3222
```

`backend/.env` (ดู `backend/.env.example`):

```env
CORE_HUB_URL=http://localhost:3000
CORE_HUB_JWKS_URL=http://localhost:3000/api/v1/.well-known/jwks.json
CORE_HUB_WEB_URL=http://127.0.0.1:3100
CORE_HUB_ISSUER=core-hub
CORE_HUB_AUDIENCE=csmju2030
SUBSYSTEM_ID=csmju-nexus
```

`frontend/.env.local` (ดู `frontend/.env.example`):

```env
BACKEND_URL=http://127.0.0.1:4222
NEXT_PUBLIC_CORE_HUB_WEB_URL=http://127.0.0.1:3100
```

แก้ `.env.local` หรือ `next.config.ts` แล้วต้องรีสตาร์ต `next dev` ทุกครั้ง

### 3.2 ทะเบียนใน Core Hub ในเครื่อง

ค่าที่ต้องตรงกับ `subsystem.yaml`: `callbackUrl = http://localhost:3222/auth/callback` · `baseUrl = http://localhost:3222`
· `defaultRoleMapping` (key คือรายชื่อ role ที่ Core Hub ยอมให้เข้า) · `APPROVED` + `ACTIVE`

แก้ทะเบียนที่มีอยู่ด้วยบัญชี admin ของ Core Hub ในเครื่อง:
`PATCH /api/v1/subsystems/<id>` `{ "callbackUrl": "...", "baseUrl": "..." }` และ
`PATCH /api/v1/subsystems/<id>/role-mapping` `{ "defaultRoleMapping": {...} }`

> 2 ต.ค. 2569: แก้ `callbackUrl`/`baseUrl` เป็น :3222 แล้ว · role mapping ใส่ `lecturer`/`guest` ไม่ได้ —
> Core Hub ในเครื่องรุ่นเก่าตอบ `404 Role not found: lecturer, guest` (ตาราง role ของมันมีแค่ 4 ค่า)
> ทะเบียนในเครื่องจึงยังมี 4 key ส่วน `subsystem.yaml` กับโค้ดมีครบ 6 ตามมาตรฐาน

### 3.3 ต่อกับ server จริง (https://csmju2030.jowave.com) — ขั้นตอนของ PL

ทำตาม standards `docs/connect-core-hub.md` ข้อ 3–6 · **ยังไม่ได้ทำ** (ห้ามลงทะเบียนแทน PL):

1. DevOps เลื่อน `ci.yml` เป็น `@v1.5.2` ขึ้นไป แล้วเลื่อน `.standards-version` + submodule `standards/` เป็น `1.7.0` (PR แยก)
2. PL login `https://csmju2030.jowave.com` ด้วยบัญชีเจ้าของระบบของทีม → `/backoffice/subsystems/new` กรอก:
   ชื่อ `csmju-nexus` · Callback URL `http://localhost:3222/auth/callback` · Base URL **เว้นว่าง** ·
   บทบาท student/alumni/guest → `GUEST`, staff/lecturer → `EDITOR`, admin → `ADMIN` (กรอกให้ถูกตั้งแต่แรก — แก้เองไม่ได้หลังอนุมัติ)
3. รอ admin ระบบกลางอนุมัติ + เปิดใช้งาน
4. `backend/.env`: `CORE_HUB_URL` และ `CORE_HUB_WEB_URL` = `https://csmju2030.jowave.com` · `CORE_HUB_JWKS_URL` = `.../api/v1/.well-known/jwks.json`
5. `subsystem.yaml`: `core_hub_url` / `core_hub_web_url` เป็น server จริง · `probes.create.denied_role: guest` (นักศึกษาไม่มีรหัสผ่าน)
6. conformance ด้วยไฟล์บัญชี**นอก repo**: `CONFORMANCE_ACCOUNTS_FILE=~/.csmju/conformance-accounts.json node standards/conformance/run.js`
   (คีย์ `owner` `staff` `lecturer` `alumni` `guest` · รหัสได้จากผู้ดูแล dev server ทางข้อความส่วนตัวเท่านั้น · login ผิดซ้ำ = บัญชีร่วมล็อกทั้งโครงการ)
7. ตรวจ log: `grep -iE "eyJ|access_token=|authorization:|cookie:"` ต้องไม่พบอะไร (ดูข้อ 5 ข้อ 2 ด้วย)

---

## 4. เทสต์

| ไฟล์ | ตรวจอะไร |
|---|---|
| `backend/src/auth/core-hub-token.verifier.spec.ts` | 10 ขั้น รวมขั้น 9 (ไม่มี iat · อายุ 7 วัน · ขอบ 960/961 วินาที) และขั้น 10 (`azp`) · role 6 ค่า · role นอกรายการ = 403 |
| `backend/src/auth/next-path.spec.ts` | กฎ `next` 5 ข้อ · คุกกี้ state · constant-time |
| `backend/src/common/http/http-exception.filter.spec.ts` | 429/503 + `Retry-After` · Prisma P2024 → 503 · bug อื่น → 500 · log แค่ path |
| `backend/test/auth-sso.e2e-spec.ts` | `/auth/login` · ทุกแถวของตาราง 5.1 · `/auth/logout` · `/api/v1/me` (`session.expiresAt`) |
| `backend/test/core-hub-live.e2e-spec.ts` | token จริงจาก Core Hub ในเครื่อง ผ่าน flow มี state · sidebar ไม่มี state · token ดัดแปลง 10 แบบ (ข้ามเองถ้าไม่มี Core Hub) |
| `frontend/src/lib/csmju/session.test.tsx` | 401 → `/auth/login?next=` · กันวน 30 วินาที · logout เป็นฟอร์ม POST |
| conformance 1.7.0 | `node <standards-1.7.0>/conformance/run.js` จากรากของ repo → 69/69 |
| เบราว์เซอร์จริง | login ผ่าน `/auth/login` ที่ `http://localhost:3222` แล้วทดสอบด้วยมือ |

---

## 5. ข้อจำกัดที่รู้อยู่

1. **Core Hub เว็บในเครื่องรุ่นเก่าไม่มี `/sso/authorize` และ `/logout`** — `/sso/authorize` ตอบ 307 ไปหน้าแรก
   และเมนูระบบใน sidebar ใช้ launcher เดิม `/api/sso/<ชื่อ>` ที่สร้าง state เอง (`crypto.randomUUID()`) state จึงไม่ตรง
   → callback ตอบ 401 ซึ่ง**ถูกต้องตามสัญญา** ห้ามผ่อนการตรวจ state · ต้องใช้ Core Hub รุ่นที่รองรับ SSO 1.1 (server จริงรองรับแล้ว)
   conformance ไม่กระทบเพราะ runner เรียก API `sso/authorize` พร้อม `&state=` เอง
2. **Next พิมพ์ `Failed to proxy <URL เต็ม>` เมื่อส่งต่อไปหลังบ้านไม่สำเร็จ** — ถ้าเป็น `/auth/callback` URL นั้นมี token
   (log ของ `next dev` ไม่ใช่ของเรา) เกิดเมื่อหลังบ้านล่มหรือรีสตาร์ต และเกิดจาก keep-alive ชนกัน ซึ่งแก้แล้ว
   (`main.ts` ตั้ง `keepAliveTimeout` 65 วินาที) · demo ของมาตรฐานมีจุดเดียวกัน — ควรแจ้งทีม standards
3. ทะเบียนในเครื่องไม่มี `lecturer`/`guest` (ข้อ 3.2)
4. WebSocket ข้ามโดเมนตอนขึ้นระบบจริงใช้ได้แค่ทางตั๋ว (ข้อ 1.6)
