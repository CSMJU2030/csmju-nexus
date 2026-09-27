# csmju-nexus

CS Nexus — ระบบย่อยของโครงการ CSMJU2030

มาตรฐานกลางอยู่ใน `standards/` (submodule ของ CSMJU2030/csmju2030-standards)
สร้างจาก standards v1.0.0

## เริ่มทำงาน

```bash
git submodule update --init --remote standards/
pnpm install
git checkout -b feature/nexus/<เรื่องที่ทำ>
```

ก่อนเปิด PR อ่าน `standards/docs/github-workflow.md` ข้อ 1
