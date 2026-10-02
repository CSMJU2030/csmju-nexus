import { ActivityShell } from './activity-shell';

/// เมนูซ้ายอยู่ที่ layout — สลับระหว่าง "การกดถูกใจ" กับ "ความคิดเห็น" แล้ว
/// เมนูต้องไม่วาดใหม่ทั้งแผง
export default function ActivityLayout({ children }: LayoutProps<'/activity'>) {
  return <ActivityShell>{children}</ActivityShell>;
}
