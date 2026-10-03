'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/// Dialog แบบไม่พึ่ง @radix-ui/react-dialog
///
/// ใช้ `<dialog>` ของเบราว์เซอร์เป็นฐาน เพราะมันให้สามอย่างที่ยากจะทำถูก
/// ด้วยมือมาให้ฟรี:
///   1. โฟกัสถูกกักในกล่อง (Tab ไม่หลุดไปหลังฉาก)
///   2. Escape ปิดเอง
///   3. อยู่บนชั้น top layer จริง ไม่มี z-index ไหนกดทับได้
///
/// เขียนเองแทนการลง radix เพราะสามข้อนั้นคือ 90% ของเหตุผลที่คนใช้ radix
/// สำหรับ dialog — และ `<dialog>` รองรับครบทุกเบราว์เซอร์ปัจจุบันแล้ว
///
/// API ตรงกับ shadcn เพื่อให้ component ที่ก๊อปจาก 21st.dev ใช้ได้โดยไม่แก้ import

interface DialogContextValue {
  open: boolean;
  setOpen: (next: boolean) => void;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialog(component: string): DialogContextValue {
  const context = React.useContext(DialogContext);

  if (!context) {
    throw new Error(`<${component}> ต้องอยู่ภายใน <Dialog>`);
  }

  return context;
}

export function Dialog({
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolled;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setUncontrolled(next);
      }

      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const value = React.useMemo(() => ({ open, setOpen }), [open, setOpen]);

  return (
    <DialogContext.Provider value={value}>{children}</DialogContext.Provider>
  );
}

export function DialogTrigger({
  children,
  asChild,
}: {
  children: React.ReactNode;
  asChild?: boolean;
}) {
  const { setOpen } = useDialog('DialogTrigger');

  // asChild: ยืมปุ่มที่ผู้เรียกส่งมาแทนที่จะห่อด้วยปุ่มอีกชั้น
  // (ปุ่มซ้อนปุ่มเป็น HTML ที่ไม่ถูกต้อง และทำให้ style เพี้ยน)
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      onClick?: (event: React.MouseEvent) => void;
    }>;

    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event);
        setOpen(true);
      },
    });
  }

  return (
    <button type="button" onClick={() => setOpen(true)}>
      {children}
    </button>
  );
}

export function DialogContent({
  className,
  children,
  showCloseButton = true,
}: {
  className?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
}) {
  const { open, setOpen } = useDialog('DialogContent');
  const ref = React.useRef<HTMLDialogElement | null>(null);

  React.useEffect(() => {
    const dialog = ref.current;

    if (!dialog) return;

    if (open && !dialog.open) {
      // showModal() ไม่ใช่ show() — ตัวแรกกักโฟกัสและวาง backdrop ให้
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // ห้าม `if (!open) return null`
  //
  // การถอด <dialog> ออกจาก DOM ในเรนเดอร์เดียวกับที่สั่งปิด ทำให้ effect
  // ข้างบนเจอ ref.current เป็น null แล้ว `dialog.close()` ไม่เคยถูกเรียกเลย
  // — เบราว์เซอร์จึงไม่ได้ทำลำดับการปิดของมัน ซึ่งเป็นตัวที่ **คืนโฟกัส
  // กลับไปยังปุ่มที่กดเปิด** ผลคือโฟกัสร่วงไปที่ <body> คนที่ใช้คีย์บอร์ด
  // ต้อง Tab ไล่ใหม่ตั้งแต่ต้นหน้าทุกครั้งที่ปิดกล่อง
  //
  // เก็บตัว <dialog> ไว้เสมอ (ไม่เปิดก็ถูกซ่อนด้วย UA stylesheet อยู่แล้ว)
  // แต่ยังถอดลูกออกตอนปิด เพื่อไม่ให้ effect ของลูกทำงานทั้งที่ไม่ได้เปิด
  return (
    <dialog
      ref={ref}
      // `cancel` ยิงเมื่อกด Escape — ต้องรับเองเพื่อให้ state ของเราตรงกับ DOM
      onCancel={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
      onClose={() => setOpen(false)}
      // คลิกฉากหลังเพื่อปิด · เทียบ target กับตัว dialog เอง เพราะ
      // ::backdrop นับเป็น target เดียวกับ <dialog>
      onClick={(event) => {
        if (event.target === ref.current) {
          setOpen(false);
        }
      }}
      className={cn(
        // **`m-auto` ห้ามหาย** — preflight ของ Tailwind ตั้ง margin: 0 ให้ทุก element
        // ซึ่งลบ margin: auto ที่เบราว์เซอร์ใช้จัด <dialog> ให้อยู่กลางจอ กล่องทุกใบ
        // จึงไปติดมุมซ้ายบน (พบ 29 ก.ย. 2569 — เป็นทั้งกล่องแก้โปรไฟล์และกล่องห้อง)
        //
        // max-h + overflow ให้จอเตี้ย (มือถือแนวนอน) ยังเลื่อนถึงปุ่มล่างสุดได้
        'm-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto csmju-surface p-0 text-card-foreground shadow-xl',
        'backdrop:bg-black/50 backdrop:backdrop-blur-sm',
        'open:animate-in open:fade-in-0 open:zoom-in-95',
        className,
      )}
    >
      {open && (
        <div className="relative">
          {children}

          {showCloseButton && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="ปิด"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}
    </dialog>
  );
}

export function DialogHeader({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1', className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<'h2'>) {
  return (
    <h2 className={cn('font-semibold leading-none', className)} {...props} />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<'p'>) {
  return (
    <p className={cn('text-sm text-muted-foreground', className)} {...props} />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

export function DialogClose({
  children,
  asChild,
}: {
  children: React.ReactNode;
  asChild?: boolean;
}) {
  const { setOpen } = useDialog('DialogClose');

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      onClick?: (event: React.MouseEvent) => void;
    }>;

    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event);
        setOpen(false);
      },
    });
  }

  return (
    <button type="button" onClick={() => setOpen(false)}>
      {children}
    </button>
  );
}
