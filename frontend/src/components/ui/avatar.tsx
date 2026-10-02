'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/// Avatar แบบไม่พึ่ง @radix-ui/react-avatar
///
/// เขียนเองเพราะต้องการแค่สามอย่าง: กรอบวงกลม, รูปที่โหลดได้, ตัวอักษรสำรอง
/// การเพิ่ม dependency เพื่อสามอย่างนี้ไม่คุ้ม — และ AvatarImage ของ radix
/// ก็ทำแค่จับ onLoad/onError เหมือนกัน
///
/// API เหมือน shadcn เพื่อให้ component ที่ก๊อปจาก 21st.dev ใช้ได้ทันที
/// โดยไม่ต้องแก้ import

const AvatarContext = React.createContext<{
  status: 'loading' | 'loaded' | 'error';
  setStatus: (next: 'loading' | 'loaded' | 'error') => void;
}>({ status: 'loading', setStatus: () => {} });

export function Avatar({
  className,
  children,
  ...props
}: React.ComponentProps<'span'>) {
  const [status, setStatus] = React.useState<'loading' | 'loaded' | 'error'>(
    'loading',
  );

  return (
    <AvatarContext.Provider value={{ status, setStatus }}>
      <span
        data-slot="avatar"
        className={cn(
          'relative flex size-10 shrink-0 overflow-hidden rounded-full',
          className,
        )}
        {...props}
      >
        {children}
      </span>
    </AvatarContext.Provider>
  );
}

export function AvatarImage({
  className,
  src,
  alt = '',
  ...props
}: React.ComponentProps<'img'>) {
  const { status, setStatus } = React.useContext(AvatarContext);

  React.useEffect(() => {
    setStatus(src ? 'loading' : 'error');
  }, [src, setStatus]);

  if (!src || status === 'error') {
    return null;
  }

  return (
    // ใช้ <img> ธรรมดา ไม่ใช่ next/image เพราะ URL ของรูปโปรไฟล์มาจาก Core
    // ซึ่งเป็นโดเมนที่ยังไม่รู้ตอน build — next/image ต้องประกาศโดเมนล่วงหน้า
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={cn('aspect-square size-full object-cover', className)}
      onLoad={() => setStatus('loaded')}
      onError={() => setStatus('error')}
      {...props}
    />
  );
}

export function AvatarFallback({
  className,
  children,
  ...props
}: React.ComponentProps<'span'>) {
  const { status } = React.useContext(AvatarContext);

  if (status === 'loaded') {
    return null;
  }

  return (
    <span
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
