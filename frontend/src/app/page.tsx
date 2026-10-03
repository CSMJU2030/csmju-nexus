import { redirect } from "next/navigation";

/// หน้าแรกพาไปที่ฟีดชุมชน
///
/// เดิมไฟล์นี้เขียน redirect("/") ซึ่งชี้กลับมาที่ตัวเอง = วนไม่จบ
/// และชนกับ (dashboard)/page.tsx ที่เป็น route "/" เหมือนกัน
export default function RootPage() {
  redirect("/feed");
}
