import { AppRail } from '@/components/csmju/app-rail';
import { CallProvider } from '@/components/csmju/call-provider';
import { VoiceRoomProvider } from '@/components/csmju/voice-room-provider';
import { VoiceRoomDock } from '@/components/csmju/voice-room-panel';
import { MessagesDock } from '@/components/csmju/messages-dock';
import { MobileTabBar, MobileTopBar } from '@/components/csmju/mobile-bars';
import { QueryProvider } from '@/components/csmju/query-provider';
import { MotionProvider } from '@/components/ui/motion-provider';
import { SessionProvider } from '@/lib/csmju/session';

/// เปลือกของแอป — หน้าตาแบบ Instagram บนเว็บ
///
///   จอกว้าง   แถบไอคอนแคบทางซ้าย (AppRail) · ไม่มีแถบบน · ปุ่มข้อความลอยขวาล่าง
///   จอแคบ     แถบบน (ชื่อระบบ · ค้นหา · หัวใจ · ≡) · แถบล่างเจ็ดไอคอน
///
/// ต่างจาก Instagram ตรงที่แถบซ้ายถือห้องแชท/ห้องเสียงแบบ Discord และนัดประชุม
/// แบบ Teams ไว้ด้วย — ทุกโหมดของระบบอยู่ห่างแค่คลิกเดียวจากทุกหน้า
///
/// `SessionProvider` อยู่ชั้นนอกสุด เพราะทุกหน้าใต้ `(app)` ต้องรู้ว่าผู้ใช้
/// เป็นใครก่อนจะเรนเดอร์อะไรได้ หน้าจอข้างในจึงเรียก `useMe()` ได้ทันที
export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    // CallProvider อยู่ที่ layout เพราะเสียงกริ่งต้องดังได้จากทุกหน้า
    // VoiceRoomProvider ก็เช่นกัน — ห้องเสียงแบบ Discord ต้องต่อค้างไว้ระหว่างเปลี่ยนหน้า
    // (อยู่ชั้นนอกของ CallProvider เพราะการโทรต้องสั่งให้ออกจากห้องเสียงก่อนได้)
    <QueryProvider>
      <SessionProvider>
        <MotionProvider>
          <VoiceRoomProvider>
          <CallProvider>
            {/* h-dvh + overflow-hidden: แถบซ้ายอยู่กับที่ เนื้อหาเลื่อนในตัวเอง */}
            <div className="flex h-dvh overflow-hidden bg-background">
              <AppRail />

              <div className="flex min-w-0 flex-1 flex-col">
                <MobileTopBar />

                {/* pb ล่างเว้นที่ให้แถบล่างของมือถือไม่ทับบรรทัดสุดท้าย */}
                <main className="relative min-w-0 flex-1 overflow-y-auto pb-[calc(3rem+env(safe-area-inset-bottom))] lg:pb-0">
                  {children}
                </main>
              </div>

              <MobileTabBar />
              <MessagesDock />
              <VoiceRoomDock />
            </div>
          </CallProvider>
          </VoiceRoomProvider>
        </MotionProvider>
      </SessionProvider>
    </QueryProvider>
  );
}
