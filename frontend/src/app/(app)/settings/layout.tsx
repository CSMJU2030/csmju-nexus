import { SettingsShell } from './settings-shell';

/// เมนูซ้ายของหน้าตั้งค่าอยู่ที่ layout ไม่ใช่ในแต่ละหน้า — สลับหน้าย่อยแล้ว
/// ช่องค้นหากับตำแหน่งเลื่อนของเมนูต้องไม่รีเซ็ตทุกครั้ง
export default function SettingsLayout({ children }: LayoutProps<'/settings'>) {
  return <SettingsShell>{children}</SettingsShell>;
}
