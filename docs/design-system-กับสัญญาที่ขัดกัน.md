# `@csmju2030/design-system` กับสัญญาที่ขัดกัน

**เขียนถึง:** PM1 (เจ้าของ design system) · PM2 (เจ้าของ auth contract) · DevOps · PL
**วันที่ตรวจ:** 2026-09-27
**วิธีได้ข้อมูล:** clone ทั้งสอง repo มาอ่านโค้ดจริง ไม่ใช่อ่านจากเอกสารอย่างเดียว

---

## 1. ข้อสรุป

**`@csmju2030/design-system@1.3.0` สร้างตามสัญญาที่ `csmju2030-standards` v1.0.0 ยกเลิกไปแล้ว**

ทั้งสองฝั่งทำงานถูกต้องตามสิ่งที่ตัวเองเห็นในตอนนั้น — ปัญหาคือ**ลำดับเวลา**

```
7 ก.ย. 2569   design-system v1.3.0 ออก
              README: "implement csmju2030-standards v1.3.0"
              src/index.ts: CSMJU_STANDARDS_VERSION = "1.3.0"
                    │
                    │  4 วัน
                    ▼
11 ก.ย. 2569  csmju2030-standards v1.0.0 ออก
              CHANGELOG: "เวอร์ชัน 1.0.0–1.3.0 ก่อนหน้านี้เป็นช่วงเตรียมการ
                          จึงยกเลิกประวัติเดิมทั้งหมดแล้วเริ่มนับใหม่"
              auth-contract.md: "เอกสารนี้แทนที่ฉบับ OAuth2/Gateway เดิมทั้งฉบับ
                                 ฉบับก่อนหน้าอธิบายสถาปัตยกรรมที่ยังไม่มีจริง
                                 (API Gateway, /oauth/token, authorization code)"
```

สัญญา 1.3.0 ที่ design system implement ไว้ คือฉบับที่ standards v1.0.0
ประกาศว่า **"อธิบายสถาปัตยกรรมที่ยังไม่มีจริง"**

---

## 2. จุดที่ขัดกัน — อ่านจากโค้ดจริงทั้งหมด

| เรื่อง | design-system v1.3.0 | standards v1.0.0 |
| --- | --- | --- |
| token endpoint | `POST {CORE}/oauth/token` + `grant_type`<br>(`src/server/auth-routes.ts:75,147,185`) | **ไม่มี endpoint นี้** — SSO ผ่าน `GET /api/v1/auth/sso/authorize` |
| รูปแบบ flow | authorization code แลก token | 302 ส่ง `access_token` มาใน query string |
| ที่รับ callback | Next.js route handler `frontend/src/app/auth/[csmju]/route.ts` | **backend** `GET /auth/callback` (`requiredRoutes.ssoCallback`) |
| claim ใน JWT | `sub` `username` `layer1_role` `faculty`<br>(`src/lib/token-store.ts:19-26`) | `sub` `email` `role` `sid`<br>— **ไม่มี `username` และ `faculty`** |
| `/api/v1/me` | *"ไม่มี endpoint /me ในสัญญา"* (CHANGELOG 1.3.0) | **บังคับ** (`vocabulary.json` → `requiredRoutes.me`) |
| meta ของ pagination | `{page, per_page, total, total_pages}`<br>(`src/lib/errors.ts:36-42`) | `{total, page, limit, totalPages}` |
| Tailwind | v3 ผ่าน preset — ระบุเองว่า v4 จะโดน `ARC-02` ตีตก | เราใช้ v4 อยู่ |
| `jose` | อยู่ใน `FORBIDDEN_EVERYWHERE` ของ `csmju-ui-lint` | **บังคับให้ใช้** (`SEC-04` · `tech-stack.md` 1.3) |

> ข้อสุดท้ายเป็นข้อที่ชี้ขาดที่สุด: กฎหนึ่งห้ามใช้ `jose` อีกกฎหนึ่งบังคับให้ใช้
> (โชคดีที่ `csmju-ui-lint` สแกนเฉพาะ `frontend/` ส่วน `jose` ของเราอยู่ `backend/`
> จึงยังไม่ชนกันจริงในทางปฏิบัติ — แต่เจตนาของสองฝั่งขัดกันชัดเจน)

---

## 3. `csmju-ui-lint` **ยังไม่ถูกบังคับใช้จริง**

`docs/ROLLOUT-37-TEAMS.md` ของ design system ระบุว่าส่ง PR เข้า standards แล้ว:

> `[x]` ส่ง PR เข้า `csmju2030-standards`: `scripts/check-ui-designsystem.sh`
> + step ใน job `ui-token-compliance` + `VERSION` 1.4.0
> (branch `feature/design-system/ui-designsystem-check`)

**ตรวจแล้ว PR นั้นยังไม่ถูก merge:**

- `standards/scripts/` ไม่มีไฟล์ `check-ui-designsystem.sh`
- `subsystem-compliance.yml` job `ui-token-compliance` มีแค่ `check-ui-tokens.sh`
- `standards/VERSION` ยังเป็น `1.0.0` ไม่ใช่ `1.4.0`

**ผลที่ตามมา:** กฎ `DS-01`..`DS-22` ทั้งหมด (รวม `DS-22` ที่บังคับให้มี
`auth/[csmju]/route.ts`) **ไม่ได้ถูกบังคับโดย CI** สิ่งที่บังคับจริงมีแค่
`standards/scripts/*.sh` 18 ตัวเท่านั้น

---

## 3.5 ผลตรวจจริงด้วย `csmju-ui-lint`

`tools/csmju-ui-lint.mjs` ของ design system เป็น Node script ล้วน ไม่ต้องติดตั้ง
package จึงรันใส่โปรเจคเราได้เลย **นี่คือผลจริง ไม่ใช่ประมาณการ**

```
$ node <design-system>/tools/csmju-ui-lint.mjs
สรุป: 35 error · 141 warning
```

| รหัส | จำนวน | เรื่อง | สถานะ |
| --- | ---: | --- | --- |
| `DS-10` | 85 | Tailwind arbitrary value (`p-[13px]`) เลี่ยง token | 🔒 ต้องมี preset ของ package |
| `UI-04` | 36 | emoji ในหน้าจอ | ⚖️ เป็น**ข้อมูลโดเมน** ขอยกเว้น |
| `DS-07` | 15 | หน้าไม่ export `metadata` | ⚠️ 14/15 เป็น Client Component — ดูข้อ 3.6 |
| `DS-02` | 15 | segment ไม่มี `loading.tsx` | ⚠️ เป็นเรื่องความละเอียด ไม่ใช่ไม่มีเลย |
| `DS-03` | 14 | segment ไม่มี `error.tsx` | ⚠️ เช่นเดียวกัน |
| `DS-11` | 5 | `transition-all` | ✅ แก้ได้เอง |
| `DS-01` | 1 | root layout ไม่ได้ครอบ `<CsmjuAppShell>` | 🔒 ต้องมี package |
| `DS-22` | 1 | ไม่มี `app/auth/[csmju]/route.ts` | ❌ **ขัดกับ standards** — callback เป็นของ backend |
| `DS-08` | 1 | โหลดฟอนต์จาก Google Fonts CDN | ❌ **false positive** — ดูข้อ 3.6 |
| `SEC-05` | 1 | ระบบย่อยมีหน้า login ของตัวเอง | ❌ **false positive** — ดูข้อ 3.6 |
| `DS-06` · `DS-13` | 2 | เบ็ดเตล็ด | ⚠️ |

---

## 3.6 สามข้อที่ตัว lint ตัดสินผิด — ตรวจกับคู่มือ Next 16.3.6 ที่มากับโปรเจคแล้ว

### `DS-08` — "โหลดฟอนต์จาก Google Fonts CDN"

กฎจับด้วย regex `next/font/google` แต่คู่มือของ Next เองเขียนว่า:

> The `next/font` module automatically optimizes your fonts and **removes external
> network requests** for improved privacy and performance. It includes
> **built-in self-hosting** for any font file.
> — `next/dist/docs/01-app/01-getting-started/13-fonts.md`

`next/font/google` ดาวน์โหลดฟอนต์ **ตอน build** แล้ว self-host ไม่ได้ยิง CDN ตอนผู้ใช้เปิดหน้า
พิสูจน์จาก build output ของเราเอง:

```
$ grep -rl "fonts.googleapis.com|fonts.gstatic.com" .next --include=*.html --include=*.js --include=*.css
(ไม่พบ)
$ find .next -name "*.woff2" | wc -l
14
```

ศูนย์การอ้างถึง CDN · ฟอนต์ self-host 14 ไฟล์ — ตรงตามเจตนาของข้อ 4.1 ทุกประการ

### `SEC-05` — "ระบบย่อยมีหน้า login ของตัวเอง"

กฎจับจาก**ชื่อ path** (`app/login/`) `frontend/src/app/login/page.tsx` ของเรา
ยาว 104 บรรทัด **ไม่มี `<form>` ไม่มี `<input>` ไม่มีคำว่า password เลย** —
มีแต่ปุ่มที่ redirect ไป `CORE_LOGIN_URL` ซึ่งคือสิ่งที่ `auth-contract.md` ข้อ 1
สั่งให้ทำพอดี

`check-no-own-login.sh` ของ standards เองตรวจ**เนื้อหา** ไม่ใช่ชื่อโฟลเดอร์ จึงผ่าน

### `DS-02` / `DS-03` — "segment ไม่มี loading.tsx / error.tsx"

กฎตรวจว่าทุกโฟลเดอร์มีไฟล์ครบ แต่ Next ไม่ได้ทำงานแบบนั้น:

> `error.js` wraps a route segment **and its nested children** in a React Error Boundary.
> `loading.js` … will automatically wrap the `page.js` file **and any children below**
> in a `<Suspense>` boundary.
> — `next/dist/docs/01-app/03-api-reference/03-file-conventions/{error,loading}.md`

เรามี `app/error.tsx` · `app/global-error.tsx` · `app/not-found.tsx` ·
`app/(app)/loading.tsx` — **ทุกหน้าจึงมีตาข่ายรับอยู่แล้วโดยการสืบทอด**

สิ่งที่ยังขาดจริงคือ**ความละเอียด**: skeleton ตัวเดียวใช้ร่วมทุกหน้า ขณะที่ §9.1
ต้องการ skeleton ที่มีรูปร่างใกล้เคียงเนื้อหาจริงของแต่ละหน้า
→ เป็นงานที่ควรทำ **หลัง**ได้ `<Skeleton>` จาก package ไม่งั้นต้องเขียนสองรอบ

### `DS-07` — "หน้าไม่ export metadata" (ไม่ใช่ false positive แต่แก้ตรง ๆ ไม่ได้)

14 จาก 15 หน้าเป็น Client Component และคู่มือ Next ระบุชัด:

> The `metadata` object and `generateMetadata` function exports are
> **only supported in Server Components**.
> — `next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`

ทางแก้ตามคู่มือคือแยก `page.tsx` เป็น Server Component บาง ๆ ที่ export `metadata`
แล้วย้าย logic ไปไฟล์ลูกที่เป็น client — **14 หน้า × 2 ไฟล์** เป็นงานที่ควรทำ
แต่ควรทำรอบเดียวพร้อมตอนย้ายเข้า `<CsmjuAppShell>` ไม่ใช่แยกทำตอนนี้

---

## 3.7 emoji 36 จุด — เป็นข้อมูลโดเมน ไม่ใช่การตกแต่ง

`UI-04` / §16.2 ข้อ 14 ห้าม emoji ในหน้าจอระบบ เหตุผลถูกต้องสำหรับระบบทะเบียน
หรือระบบครุภัณฑ์ แต่ระบบเราเป็น**โซเชียลมีเดีย** และ emoji คือตัวฟีเจอร์

| ที่อยู่ | จำนวน | คืออะไร |
| --- | ---: | --- |
| `lib/csmju/types.ts:308-319` | 12 | **ชุดรีแอ็กชันที่อนุญาต** — เซตปิด 12 ค่า เทียบเท่า `error-codes.json` |
| `components/csmju/reaction-bar.tsx` | 12 | ปุ่มที่เรนเดอร์เซตนั้น |
| ไฟล์ `*.test.*` | 12 | เทสต์ของฟีเจอร์เดียวกัน |

ลบออก = ลบฟีเจอร์รีแอ็กชันทั้งฟีเจอร์ จึงขอ exception ตามข้อ 8

**ส่วนที่เป็นการตกแต่งจริง แก้ไปแล้ว** (ดูข้อ 9)

---

## 4. ทางออกเดียวที่ทำตามได้ทั้งสองฝั่ง

**แยกใช้ design system เฉพาะชั้น UI — ไม่ใช้ชั้น auth ของมัน**

| ส่วนของ package | ใช้ไหม | เหตุผล |
| --- | --- | --- |
| component ทั้งหมด (`Button` `DataTable` `Modal` `FormField` …) | ✅ ใช้ | ไม่ผูกกับสัญญา auth เลย · เป็นเป้าหมายจริงของ design system (37 ระบบหน้าตาเดียวกัน) |
| design token + `tailwind-preset` | ✅ ใช้ | ทำให้ `UI-01` ผ่านโดยไม่ต้องดูแล token เอง |
| `formatDate` `formatMoney` `csmjuTitle` | ✅ ใช้ | พ.ศ. · สตางค์ · timezone ไทย — ไม่เกี่ยวกับ auth |
| `@csmju2030/design-system/server` | ❌ **ไม่ใช้** | ยิง `/oauth/token` ซึ่ง Core Hub v1.0 ไม่มี |
| `token-store` · `useCsmjuUser` | ❌ ไม่ใช้ | อ่าน claim `username`/`faculty` ที่ token ไม่มี |
| การจัดการ 401 ใน `AppShell` | ❌ ไม่ใช้ | เรียก `/auth/refresh` ที่ไม่มีในสัญญา v1.0 |
| `useApi` / `csmjuFetch` | ⚠️ ต้องแก้ | อ่าน meta ผิดชื่อ และแนบ token จาก `token-store` |

**สิ่งที่เราทำเองต่อ:** ชั้น auth ด้วย `jose` + JWKS (เขียนเสร็จแล้ว 38 เทสต์ผ่าน)
ซึ่ง `SEC-04` บังคับ และเป็นสิ่งที่ Core Hub v1.0 รองรับจริง

---

## 5. ราคาของการย้ายไปใช้ design system

| งาน | ขนาด |
| --- | --- |
| Tailwind v4 → v3 (preset ของ design system เป็น v3) | ทั้ง `globals.css` + config |
| เขียน component ของเราใหม่ด้วยของส่วนกลาง | ~40 ไฟล์หน้าบ้าน |
| ทุก route segment ต้องมี `loading.tsx` + `error.tsx` | ~14 route |
| ครอบทุกหน้าด้วย `<CsmjuAppShell>` | `layout.tsx` |

**แลกกับ:** ตัด dependency ที่ต้องขออนุมัติได้ **10 ตัว** จาก 19 เหลือ 9
(`@radix-ui/*` 2 · `class-variance-authority` · `clsx` · `tailwind-merge` ·
`shadcn` · `tw-animate-css` · `framer-motion` · `lucide-react` · `@tailwindcss/postcss`)
เพราะสามตัวแรกที่ package ใช้ภายใน (`lucide-react` `clsx` `@fontsource/*`)
เป็น dependency ของ package เอง `ARC-02` จึงไม่ตรวจ

---

## 6. ติดตั้งไม่ได้ตอนนี้

package อยู่บน **GitHub Packages** ไม่ใช่ npm สาธารณะ

```
npm error code E401
401 Unauthorized - GET https://npm.pkg.github.com/@csmju2030%2fdesign-system
authentication token not provided
```

ต้องมี **GitHub Personal Access Token ที่มีสิทธิ์ `read:packages`** ใน `~/.npmrc`
ของเครื่องแต่ละคน — **ยังไม่ได้รับ**

---


---

## 8. ร่าง `.compliance-exceptions.yml` — **ยังไม่ได้สร้างไฟล์**

`ci-compliance-spec.md` ข้อ 11.1 ระบุว่าไฟล์นี้ **"แก้ได้เฉพาะ DevOps (คุมด้วย
CODEOWNERS)"** และ `check-exceptions.sh` บังคับให้ทุกรายการมี `issue` อ้างอิง
กระบวนการอนุมัติ เรายังไม่มีเลข issue จึงยังสร้างไม่ได้ — **ถ้าสร้างเองตอนนี้
จะเท่ากับปลอมหลักฐานการอนุมัติ** ร่างไว้ให้ DevOps คัดลอกไปใช้เมื่ออนุมัติแล้ว

```yaml
# .compliance-exceptions.yml
version: 1

exceptions:
  - check: UI-04
    scope: "frontend/src/lib/csmju/types.ts"
    reason: >-
      เซตอิโมจิรีแอ็กชัน 12 ค่าเป็นข้อมูลโดเมนของระบบโซเชียล ไม่ใช่การตกแต่ง
      หน้าจอ เทียบเท่า contracts/error-codes.json — ลบออกคือลบฟีเจอร์
      ส่วนอิโมจิที่เป็นการตกแต่งจริงถูกแทนด้วยไอคอน Lucide ไปแล้ว
    approved_by: ["@pm1"]
    issue: "csmju2030-standards#TBD"
    expires: "TBD"

  - check: UI-04
    scope: "frontend/src/components/csmju/reaction-bar.tsx"
    reason: "ปุ่มที่เรนเดอร์เซตรีแอ็กชันข้างต้น"
    approved_by: ["@pm1"]
    issue: "csmju2030-standards#TBD"
    expires: "TBD"

  - check: DS-22
    scope: "frontend/src/app"
    reason: >-
      DS-22 บังคับให้ SSO callback อยู่ที่ Next.js app/auth/[csmju]/route.ts
      แต่ standards v1.0.0 vocabulary.json requiredRoutes.ssoCallback กำหนดให้
      อยู่ที่ backend GET /auth/callback — ทำตามพร้อมกันไม่ได้ เราเลือกทำตาม
      standards เพราะเป็นตัวที่ CI บังคับจริง
    approved_by: ["@pm2"]
    issue: "csmju2030-standards#TBD"
    expires: "TBD"
```

> `DS-08` และ `SEC-05` **ไม่ขอ exception** เพราะทั้งคู่เป็น false positive ของตัว lint
> (ดูข้อ 3.6) วิธีแก้ที่ถูกคือแก้ regex ในตัว lint ไม่ใช่ให้ระบบย่อยขอยกเว้น

---

## 9. สิ่งที่แก้ไปแล้วในรอบนี้ — ทำได้โดยไม่ต้องรอ PM และไม่ต้องมี package

| ไฟล์ | แก้อะไร | ทำไมแก้ได้เลย |
| --- | --- | --- |
| `components/reels/ReelsFeed.tsx` | **ลบทิ้ง** | ไม่มีไฟล์ไหน import เลย · ข้างในเป็น mock data (`DUMMY_REELS` ชื่อปลอม รหัสนักศึกษาปลอม) · โหลดวิดีโอจาก `assets.mixkit.co` ซึ่งผิดข้อ 4.1 เรื่อง CDN ภายนอก |
| `app/(app)/profile/[username]/page.tsx` | `❤ 12 · 👁 34` → ไอคอน `Heart` / `Eye` + `<span className="sr-only">` | เป็นการตกแต่งล้วน · ของเดิม screen reader อ่านไม่ออกด้วย |
| `components/ui/animated-tooltip.tsx` | `✓✓` / `✓` → `ShieldCheck` / `BadgeCheck` + ข้อความ "ผู้ดูแลระบบ" / "เจ้าหน้าที่" | เครื่องหมายถูกเปล่า ๆ ไม่บอกว่าหมายถึงอะไร ทั้งกับตาและกับ screen reader |
| `subsystem.yaml` | เพิ่มบล็อก `ui:` ตาม `ui-design-system.md` ข้อ 19.2 | ประกาศตามจริงว่ายังไม่ได้ใช้ design system พร้อมเหตุผล |

**ผล:** `UI-04` 40 → 36 · warning 145 → 141
ที่เหลือทั้ง 36 คือฟีเจอร์รีแอ็กชันและเทสต์ของมัน ซึ่งขอ exception ตามข้อ 8

**ไม่มีอะไรถดถอย:** `run-all-checks.sh` ยังได้ 17/18 เท่าเดิม (ข้อที่ตกคือ
`check-no-secrets.sh` ซึ่งอ่าน `backend/.env` ในเครื่อง — ไฟล์นั้นไม่ได้ถูก track
และอยู่ใน `.gitignore` จึงผ่านบน clone ใหม่) · typecheck ผ่าน · lint ผ่าน ·
เทสต์หน้าบ้าน 168/168 ผ่าน

---

## 9.1 สองเรื่องที่พบระหว่างทาง และเป็นการตัดสินใจของ PL ไม่ใช่ของผม

1. **`/mockup`** — `app/(app)/mockup/page.tsx` ขนาด 19,737 ไบต์ เป็นหน้าจอปลอม
   ทั้งหน้า (ข้อมูลฮาร์ดโค้ด) และถูกลิงก์จากเมนูจริงที่ `app/(app)/layout.tsx:85`
   แปลว่าผู้ใช้กดเข้าไปเจอได้บน production
2. **`/preview`** — `app/preview/page.tsx` ลักษณะเดียวกัน

ทั้งคู่ build ติดและขึ้นใน route list จริง ถ้าตั้งใจเก็บไว้เพื่อนำเสนอ PM ก็เก็บได้
แต่ควรย้ายออกจากเมนูหลัก หรือกันด้วย env ไม่ให้ขึ้น production
**ผมไม่ลบให้ เพราะเดาไม่ได้ว่าจะใช้นำเสนอหรือไม่**

---

## 10. สิ่งที่ขอจาก PM

1. **ชี้ขาดว่า design system จะออก v2.0 ตามสัญญา v1.0.0 หรือไม่ และเมื่อไหร่**
   ถ้าจะออก เราจะรอแล้วย้ายทีเดียว · ถ้าไม่ออก เราจะใช้เฉพาะชั้น UI ตามข้อ 4
   **ข้อนี้กระทบทั้ง 37 ระบบ ไม่ใช่แค่ระบบเรา**
2. **PAT ที่มีสิทธิ์ `read:packages`** — ไม่มีก็ติดตั้งไม่ได้เลย
3. **merge PR `feature/design-system/ui-designsystem-check` หรือปิดทิ้ง**
   ตอนนี้ `csmju-ui-lint` อยู่ในสถานะ "มีกฎแต่ไม่มีใครบังคับ" ซึ่งแย่กว่า
   ไม่มีกฎ เพราะทีมที่ทำตามกับทีมที่ไม่ทำตามได้ผลเท่ากัน
4. **ยืนยันเรื่อง Tailwind** — design system เป็น v3 · เราเป็น v4 ·
   `@tailwindcss/postcss` ไม่อยู่ใน whitelist
   ถ้าให้ย้ายลง v3 เราทำได้ แต่ต้องรู้ก่อนเริ่มเขียนหน้าจอเพิ่ม
5. **แก้ `csmju-ui-lint` สามกฎที่ตัดสินผิด** (ข้อ 3.6) — `DS-08` ควรจับ
   `<link href="fonts.googleapis.com">` ไม่ใช่ `next/font/google` · `SEC-05`
   ควรตรวจเนื้อหาแบบ `check-no-own-login.sh` ไม่ใช่ชื่อโฟลเดอร์ ·
   `DS-02`/`DS-03` ควรนับการสืบทอดของ Next ไม่ใช่บังคับทุกโฟลเดอร์
   ถ้ากฎยังเป็นแบบนี้ ทั้ง 37 ทีมจะเจอ false positive เหมือนกันหมด
6. **อนุมัติ exception 3 รายการในข้อ 8** พร้อมเลข issue และวันหมดอายุ
