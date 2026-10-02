'use client';

import React, { useState } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion';
import { BadgeCheck, ShieldCheck } from 'lucide-react';

/// คนหนึ่งคนในกองรูปโปรไฟล์
export interface TooltipItem {
  id: string | number;
  name: string;
  designation: string;
  image?: string | null;
  /// เครื่องหมายยืนยัน — มาจาก layer2Role ของระบบย่อย ไม่ใช่ coreRole
  badge?: 'ADMIN' | 'STAFF' | null;
  online?: boolean;
}

/// กองรูปโปรไฟล์ที่ชี้แล้วขึ้นชื่อ
///
/// ใช้แสดง "ใครอยู่ในนี้บ้าง" แบบประหยัดพื้นที่ — สมาชิกห้อง คนในสาย
/// ผู้ชมสตอรี่ ที่ถ้าเรียงเป็นรายการจะกินทั้งหน้าจอ
///
/// รูปเหลื่อมกันด้วย -ml ไม่ใช่ position absolute เพื่อให้ความกว้างรวม
/// คำนวณเองตามจำนวนคน และห่อบรรทัดได้เมื่อจอแคบ
export function AnimatedTooltip({
  items,
  size = 56,
  max,
}: {
  items: TooltipItem[];
  size?: number;
  /// แสดงไม่เกินกี่คน ที่เหลือรวบเป็น "+n"
  max?: number;
}) {
  const [hovered, setHovered] = useState<string | number | null>(null);
  const x = useMotionValue(0);

  // สปริงทำให้ทูลทิปเอียงตามทิศที่เมาส์เข้ามา — รายละเอียดเล็กที่ทำให้
  // รู้สึกว่ามันตอบสนอง ไม่ใช่กล่องที่โผล่มาเฉย ๆ
  const springConfig = { stiffness: 100, damping: 5 };
  const rotate = useSpring(useTransform(x, [-100, 100], [-45, 45]), springConfig);
  const translateX = useSpring(
    useTransform(x, [-100, 100], [-50, 50]),
    springConfig,
  );

  const shown = max ? items.slice(0, max) : items;
  const hiddenCount = max ? Math.max(0, items.length - max) : 0;

  return (
    <div className="flex flex-row items-center">
      {shown.map((item) => (
        <div
          className="group relative -mr-3 last:mr-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
          key={item.id}
          // ชื่อและตำแหน่งของคนในกองรูปนี้ถูกซ่อนไว้หลังการชี้เมาส์อย่างเดียว
          // คนที่ใช้คีย์บอร์ดและคนที่ใช้จอสัมผัสจึงไม่มีทางอ่านได้เลย
          // ทั้งที่ในหน้าห้องแชทและห้องเสียง นี่เป็นที่เดียวที่บอกว่าใครเป็นใคร
          //
          // tabIndex + onFocus/onBlur ทำให้ Tab ไล่ถึงและป้ายขึ้นเหมือนชี้เมาส์
          tabIndex={0}
          onFocus={() => setHovered(item.id)}
          onBlur={() => setHovered(null)}
          onMouseEnter={() => setHovered(item.id)}
          onMouseLeave={() => setHovered(null)}
        >
          <AnimatePresence mode="popLayout">
            {hovered === item.id && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.6 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  transition: {
                    type: 'spring',
                    stiffness: 260,
                    damping: 10,
                  },
                }}
                exit={{ opacity: 0, y: 20, scale: 0.6 }}
                style={{ translateX, rotate, whiteSpace: 'nowrap' }}
                className="absolute -top-14 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center rounded-lg bg-foreground px-3 py-1.5 text-background shadow-xl"
              >
                <div className="absolute inset-x-6 -bottom-px h-px bg-gradient-to-r from-transparent via-primary to-transparent" />

                <span className="text-xs font-semibold">
                  {item.name}
                  {item.badge && (
                    <span className="ml-1 inline-flex align-middle text-primary">
                      {item.badge === 'ADMIN' ? (
                        <ShieldCheck aria-hidden className="size-3.5" />
                      ) : (
                        <BadgeCheck aria-hidden className="size-3.5" />
                      )}
                      <span className="sr-only">
                        {item.badge === 'ADMIN' ? 'ผู้ดูแลระบบ' : 'เจ้าหน้าที่'}
                      </span>
                    </span>
                  )}
                </span>
                <span className="text-[11px] opacity-70">
                  {item.designation}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <div
            className="relative"
            onMouseMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();

              x.set(event.clientX - bounds.left - bounds.width / 2);
            }}
          >
            {item.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.image}
                alt={item.name}
                width={size}
                height={size}
                className="relative rounded-full border-2 border-background object-cover transition duration-300 group-hover:z-30 group-hover:scale-105"
                style={{ width: size, height: size }}
              />
            ) : (
              <span
                className="relative grid place-items-center rounded-full border-2 border-background bg-secondary font-semibold text-secondary-foreground transition duration-300 group-hover:z-30 group-hover:scale-105"
                style={{ width: size, height: size, fontSize: size * 0.36 }}
              >
                <span aria-hidden>
                  {item.name.trim().charAt(0).toUpperCase() || '?'}
                </span>

                {/* ตัวอักษรย่อตัวเดียวไม่ได้บอกว่าใคร — ต้องมีชื่อเต็มให้อ่าน */}
                <span className="sr-only">
                  {item.name}
                  {item.designation ? ` · ${item.designation}` : ''}
                </span>
              </span>
            )}

            {item.online && (
              <span
                className="absolute bottom-0 right-0 rounded-full border-2 border-background bg-success"
                style={{ width: size * 0.26, height: size * 0.26 }}
              >
                <span className="sr-only">ออนไลน์</span>
              </span>
            )}
          </div>
        </div>
      ))}

      {hiddenCount > 0 && (
        <span
          className="relative grid shrink-0 place-items-center rounded-full border-2 border-background bg-muted text-xs font-semibold text-muted-foreground"
          style={{ width: size, height: size }}
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  );
}
