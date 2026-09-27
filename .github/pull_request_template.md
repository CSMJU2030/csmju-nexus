## สรุปสิ่งที่ทำใน PR นี้

<!-- อธิบายสั้นๆ 1-2 ประโยค -->

## ประเภทการเปลี่ยนแปลง

- [ ] `feat` — เพิ่มฟีเจอร์ใหม่
- [ ] `fix` — แก้บั๊ก
- [ ] `refactor` — ปรับโครงสร้างโค้ด
- [ ] `chore` / `docs` / `test` / `ci`

## Checklist (AIE ต้องติ๊กก่อน request review)

### มาตรฐานกลาง
- [ ] รัน `git submodule update --remote standards/` ก่อนเริ่มงานแล้ว
- [ ] Branch name ตรงรูปแบบ `feature/<subsystem>/<เรื่อง>`
- [ ] Commit message ตาม Conventional Commits ทุก commit
- [ ] PR นี้โฟกัสเรื่องเดียว (ไม่ปนหลายเรื่องที่ไม่เกี่ยวกัน)

### สถาปัตยกรรม
- [ ] ไม่มี Database connection หรือ Prisma ใน `frontend/`
- [ ] ไม่มี dependency นอก whitelist ของ stack
- [ ] ไม่มี UI library อื่นนอก `@csmju2030/design-system`

### Auth
- [ ] ไม่ได้สร้างหน้า login หรือ form username/password เอง
- [ ] ไม่ได้เขียนโค้ด verify JWT signature เอง
- [ ] ไม่เก็บ token ใน `localStorage`

### API & Data
- [ ] ถ้าแก้ endpoint → อัปเดต `openapi.json` ใน PR นี้ด้วย
- [ ] Response ทุก endpoint ห่อด้วย `{ success, data/error, meta }`
- [ ] `error.code` อยู่ในรายการมาตรฐาน 6 ค่า
- [ ] Field ทุกตัวเป็น `snake_case` และตรงกับ `data-dictionary.md`
- [ ] ใช้ `username` ไม่ใช้ `student_id` / `user_id` / `stdId`

### UI (ถ้ามีการแก้หน้าจอ)
- [ ] ทุกหน้าอยู่ใน `<CsmjuAppShell>`
- [ ] ไม่มี hex สีหรือ px ดิบ ใช้ class จาก token ใน `@theme` เท่านั้น (ui-design-system.md ข้อ 3)
- [ ] ครบ 4 สถานะ: loading / empty / error / success
- [ ] ทุก input มี `<label>` ที่มองเห็นได้
- [ ] ทดสอบที่ 360px แล้วไม่มี horizontal scroll

### Security
- [ ] ไม่แก้ไฟล์ใน `.github/workflows/`
- [ ] ไม่มี hardcoded secret / connection string / API key
- [ ] ไม่มีไฟล์ `.env` ที่มีค่าจริงใน PR นี้

### สิ่งที่ AI ตรวจแทนไม่ได้ (AIE ยืนยันด้วยตนเอง)
- [ ] ทดสอบบนมือถือจริง (Android และ iOS อย่างน้อยอย่างละ 1 เครื่อง)
- [ ] ทดสอบด้วยคีย์บอร์ดจริง (กด Tab ไล่ทั้งหน้า)
- [ ] ตรวจข้อความไทยด้วยตาตนเองแล้ว ว่าเป็นภาษาที่คนใช้จริง

## หมายเหตุสำหรับ PL

<!-- จุดที่ไม่แน่ใจ / จุดที่ต้องการความเห็น / trade-off ที่เลือกไว้ -->
