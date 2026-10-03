'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, IdCard, LogIn, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

/// แถบสลับ "เข้าสู่ระบบ / สมัครสมาชิก" พร้อมตัวชี้ที่เลื่อนตาม
///
/// **ทั้งสองทางส่งไปที่ CSMJU2030 Core ไม่มีช่องรับรหัสผ่านสักช่อง**
///
/// Blueprint หน้า 8 ห้ามระบบย่อยทำหน้า Login เอง เหตุผลจริงหนักกว่ากฎ:
/// ถ้า 36 ระบบย่อยต่างคนต่างรับรหัสผ่าน รหัสของนักศึกษาจะไปอยู่ 36 ที่
/// ที่ไหนหลุดที่เดียวก็หลุดหมด และเปลี่ยนรหัสครั้งเดียวต้องเปลี่ยน 36 รอบ
///
/// component นี้จึงเป็น "ป้ายบอกทาง" ที่สวยและใช้ง่าย ไม่ใช่ประตูที่รับกุญแจ

export type AuthMode = 'signin' | 'signup';

interface AuthSwitchProps {
  /// ปลายทางหน้าล็อกอินของ Core — ไม่ส่งมา = ปุ่มปิดพร้อมบอกเหตุผล
  signInUrl?: string;
  /// ปลายทางหน้าสมัครของ Core
  signUpUrl?: string;
  /// เส้นทางที่ให้ Core ส่งกลับมาหลังทำเสร็จ (ต่อกับโดเมนของหน้านี้เอง)
  callbackPath?: string;
  defaultMode?: AuthMode;
  className?: string;
}

const TABS: {
  mode: AuthMode;
  label: string;
  icon: typeof LogIn;
  heading: string;
  body: string;
  cta: string;
}[] = [
  {
    mode: 'signin',
    label: 'เข้าสู่ระบบ',
    icon: LogIn,
    heading: 'มีบัญชี CSMJU2030 อยู่แล้ว',
    body:
      'ใช้บัญชีเดียวกับระบบอื่นของมหาวิทยาลัย กดปุ่มด้านล่างเพื่อไปยืนยันตัวตน ' +
      'ที่ศูนย์กลาง แล้วระบบจะพากลับมาที่นี่เอง',
    cta: 'ไปยืนยันตัวตนที่ CSMJU2030',
  },
  {
    mode: 'signup',
    label: 'สมัครสมาชิก',
    icon: IdCard,
    heading: 'ยังไม่มีบัญชี CSMJU2030',
    body:
      'บัญชีออกโดยมหาวิทยาลัย ไม่ได้สมัครที่ระบบนี้ — กดเพื่อไปหน้าลงทะเบียน ' +
      'ของส่วนกลาง เมื่อได้บัญชีแล้วกลับมาเข้าสู่ระบบได้ทันที',
    cta: 'ไปหน้าลงทะเบียนของมหาวิทยาลัย',
  },
];

/// ประกอบ URL ตอนคลิก ไม่ใช่ตอน render
///
/// `window.location.origin` มีเฉพาะฝั่งเบราว์เซอร์ ถ้าเอาไปใส่ใน href ตอน
/// render ฝั่งเซิร์ฟเวอร์จะได้คนละค่ากับฝั่งเบราว์เซอร์ แล้ว React จะเตือน
/// hydration mismatch — คำนวณตอนคลิกจึงตรงไปตรงมาและไม่ต้องมี effect
function coreUrl(base: string, callbackPath?: string): string {
  if (!callbackPath) return base;

  const callback = `${window.location.origin}${callbackPath}`;

  return `${base}?redirect_uri=${encodeURIComponent(callback)}`;
}

/// เส้นเวลาของสปริงเดิม (stiffness 320, damping 30, mass 1) สุ่มทุก 30ms
/// ตลอด 450ms — เขียนเป็น `linear()` ของ CSS ได้เส้นเดียวกับที่ framer-motion
/// เคยคำนวณทีละเฟรม รวมถึงการเลยเป้าเล็กน้อย (~0.8%) ก่อนหยุด
const SPRING_EASING =
  'linear(0, 0.107, 0.316, 0.527, 0.701, 0.827, 0.911, 0.961, 0.989, 1.002, 1.007, 1.008, 1.007, 1.005, 1.003, 1)';
const SPRING_MS = 450;

/// ผู้ใช้ตั้งค่า "ลดการเคลื่อนไหว" ไว้ที่ระบบหรือไม่ (jsdom ไม่มี matchMedia = ไม่ได้ตั้ง)
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function AuthSwitch({
  signInUrl,
  signUpUrl,
  callbackPath = '/auth/callback',
  defaultMode = 'signin',
  className,
}: AuthSwitchProps) {
  const [mode, setMode] = useState<AuthMode>(defaultMode);
  const tabsId = useId();
  const tabRefs = useRef<Record<AuthMode, HTMLButtonElement | null>>({
    signin: null,
    signup: null,
  });

  const active = TABS.find((tab) => tab.mode === mode) ?? TABS[0];
  const target = mode === 'signin' ? signInUrl : signUpUrl;

  /// ตัวชี้ (พื้นขาวใต้แท็บที่เลือก) เลื่อนจากแท็บเดิมไปแท็บใหม่
  ///
  /// ตัวชี้อยู่ "ในปุ่มของแท็บที่เลือก" ตลอด หน้าตาตอนหยุดนิ่งจึงเหมือนเดิมทุกพิกเซล
  /// การเลื่อนทำแบบ FLIP เหมือนที่ framer-motion (layoutId) ทำให้เดิม:
  /// จำตำแหน่งตัวชี้ก่อนสลับ → React ย้ายมันไปแท็บใหม่ → ดึงกลับไปวางที่เดิม
  /// ด้วย transform แล้วปล่อยให้ transition พามันมาที่ใหม่
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const fromRect = useRef<DOMRect | null>(null);

  function select(next: AuthMode) {
    if (next === mode) return;

    fromRect.current = indicatorRef.current?.getBoundingClientRect() ?? null;
    setMode(next);
  }

  useLayoutEffect(() => {
    const from = fromRect.current;
    const node = indicatorRef.current;

    fromRect.current = null;

    // ผู้ใช้ที่ตั้ง "ลดการเคลื่อนไหว" เห็นเป็นการสลับทันที (เดิม MotionConfig
    // reducedMotion="user" ทำหน้าที่นี้)
    if (!from || !node || prefersReducedMotion()) return;

    const to = node.getBoundingClientRect();
    if (!to.width) return;

    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const scale = from.width / to.width;

    if (!dx && scale === 1) return;

    node.style.transition = 'none';
    node.style.transform = `translateX(${dx}px) scaleX(${scale})`;
    // บังคับให้เบราว์เซอร์วาดตำแหน่งตั้งต้นก่อน ไม่งั้นมันจะข้ามไปตำแหน่งสุดท้ายเลย
    void node.offsetWidth;
    node.style.transition = `transform ${SPRING_MS}ms ${SPRING_EASING}`;
    node.style.transform = '';
  }, [mode]);

  /// ลูกศรซ้าย-ขวาต้องเลื่อนแท็บได้
  ///
  /// แถบแบบนี้ประกาศตัวเป็น tablist ซึ่งผู้ใช้คีย์บอร์ดคาดหวังว่าลูกศรจะใช้ได้
  /// ถ้าประกาศแล้วไม่ทำตาม จะแย่กว่าไม่ประกาศ เพราะเขาจะกดลูกศรแล้วไม่มีอะไรเกิดขึ้น
  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();

    const next: AuthMode = mode === 'signin' ? 'signup' : 'signin';

    select(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div
      className={cn(
        'w-full max-w-md csmju-surface p-5 shadow-sm',
        className,
      )}
    >
      <div
        role="tablist"
        aria-label="เลือกวิธีเข้าใช้งาน"
        className="relative flex rounded-xl bg-secondary/60 p-1"
      >
        {TABS.map((tab) => {
          const selected = tab.mode === mode;

          return (
            <button
              key={tab.mode}
              ref={(node) => {
                tabRefs.current[tab.mode] = node;
              }}
              type="button"
              role="tab"
              id={`${tabsId}-${tab.mode}-tab`}
              aria-selected={selected}
              aria-controls={`${tabsId}-${tab.mode}-panel`}
              // แท็บที่ไม่ได้เลือกต้องออกจากลำดับ Tab — ผู้ใช้ควรเข้ามาที่แถบ
              // ครั้งเดียวแล้วเลื่อนด้วยลูกศร ไม่ใช่ Tab ทีละอัน
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.mode)}
              onKeyDown={onKeyDown}
              className={cn(
                'relative z-10 flex flex-1 items-center justify-center gap-1.5',
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <tab.icon className="size-4" aria-hidden="true" />
              {tab.label}

              {selected && (
                // ตัวชี้ — การเลื่อนระหว่างแท็บอยู่ที่ useLayoutEffect ด้านบน
                <span
                  ref={indicatorRef}
                  className="absolute inset-0 -z-10 rounded-lg bg-card shadow-sm"
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${tabsId}-${active.mode}-panel`}
        aria-labelledby={`${tabsId}-${active.mode}-tab`}
        className="pt-5"
      >
        <h2 className="text-base font-semibold">{active.heading}</h2>

        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {active.body}
        </p>

        <button
          type="button"
          disabled={!target}
          onClick={() => {
            if (target) window.location.href = coreUrl(target, callbackPath);
          }}
          className={cn(
            'mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3',
            'bg-primary text-sm font-medium text-primary-foreground',
            'transition-opacity hover:opacity-90',
            'outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {active.cta}
          <ArrowRight className="size-4" aria-hidden="true" />
        </button>

        {!target && (
          <p
            role="status"
            className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-warning"
          >
            ยังต่อกับ CSMJU2030 Core ไม่ได้ — รอ PM ยืนยันโดเมนของหน้า
            {active.mode === 'signin' ? 'ล็อกอิน' : 'ลงทะเบียน'}กลาง
          </p>
        )}

        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck
            className="mt-0.5 size-3.5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span>
            หน้านี้<strong className="font-medium">ไม่รับรหัสผ่าน</strong>{' '}
            และระบบย่อยนี้ไม่เก็บรหัสผ่านของใครทั้งสิ้น — การยืนยันตัวตน
            เกิดที่ CSMJU2030 ที่เดียว
          </span>
        </p>
      </div>
    </div>
  );
}

export default AuthSwitch;
