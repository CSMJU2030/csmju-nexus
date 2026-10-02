'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/// พื้นที่เลื่อนที่ซ่อนแถบเลื่อนบนมือถือ และทำให้บางบนเดสก์ท็อป
///
/// ไม่ใช้ @radix-ui/react-scroll-area เพราะตัวนั้นแทนแถบเลื่อนของระบบด้วย
/// div ที่วาดเอง ซึ่งแลกมาด้วย JavaScript และการสูญเสียพฤติกรรมเลื่อนแบบ
/// native (โมเมนตัมบน trackpad, ปุ่ม Home/End) — สำหรับรายการแชทที่ยาว
/// การเลื่อนแบบ native สำคัญกว่าความสวยของแถบ
export function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'overflow-y-auto overscroll-contain',
        '[scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]',
        '[&::-webkit-scrollbar]:w-1.5',
        '[&::-webkit-scrollbar-track]:bg-transparent',
        '[&::-webkit-scrollbar-thumb]:rounded-full',
        '[&::-webkit-scrollbar-thumb]:bg-border',
        'hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
