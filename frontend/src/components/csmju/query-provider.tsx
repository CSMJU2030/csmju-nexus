'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/csmju/api';

/// ชั้นจัดการข้อมูลของทั้งแอป
///
/// ย้ายมาจากรูปแบบ "โหลดเองในทุกหน้า" (`load()` ใน useCallback แล้วเรียกใน
/// useEffect) ซึ่งซ้ำกัน 12 แห่งและมีปัญหาเดียวกันทุกแห่ง:
///   - ยิงซ้ำเมื่อสองหน้าจอขอข้อมูลชุดเดียวกันพร้อมกัน
///   - ไม่มีแคช กลับมาหน้าเดิมทีก็โหลดใหม่ทั้งหน้า จอขาวทุกครั้ง
///   - setState หลัง unmount ถ้าผู้ใช้เปลี่ยนหน้าระหว่างที่ยังโหลดไม่เสร็จ
///
/// `staleTime` 30 วินาที = stale-while-revalidate: กลับมาหน้าเดิมแล้วเห็น
/// ข้อมูลเดิมทันที แล้วค่อยอัปเดตเบื้องหลังถ้ามันเก่ากว่านั้น
export function QueryProvider({ children }: { children: React.ReactNode }) {
  // สร้างใน state ไม่ใช่ระดับโมดูล — ระดับโมดูลจะแชร์แคชข้ามผู้ใช้กันตอน
  // render ฝั่งเซิร์ฟเวอร์ ซึ่งหมายถึงข้อมูลของคนหนึ่งรั่วไปอีกคน
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,

            // ลองใหม่เฉพาะที่ลองแล้วมีประโยชน์
            //
            // 4xx คือคำขอของเราผิดเอง (สิทธิ์ไม่พอ · ไม่พบ · กรอกผิด)
            // ลองซ้ำกี่ครั้งก็ได้คำตอบเดิม แถมหน่วงให้ผู้ใช้เห็น error ช้าลง
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.isUserFixable) {
                return false;
              }

              return failureCount < 2;
            },

            // กลับมาที่แท็บแล้วดึงของใหม่ — เป็นจังหวะที่ผู้ใช้คาดหวังว่า
            // จะเห็นของล่าสุดพอดี
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
