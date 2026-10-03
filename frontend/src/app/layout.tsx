import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// ฟอนต์เก็บไว้ใน repo (app/fonts · สัญญาอนุญาต OFL แนบไว้ข้างไฟล์) แทน next/font/google
// · next/font/google ดาวน์โหลดจาก Google ตอน build — CI ของ org เคยล้มเพราะดึงไม่ได้
//   ("Can't resolve '@vercel/turbopack-next/internal/font/google/font'")
// · ui-design-system ของ PM ห้ามใช้ next/font/google อยู่แล้ว
// ทั้งสามไฟล์เป็น variable font จึงระบุช่วงน้ำหนักแทนรายการน้ำหนัก
const geistSans = localFont({
  src: "./fonts/Geist-Variable.ttf",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.ttf",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// Geist ไม่มีอักขระไทย — UI ทั้งระบบเป็นภาษาไทย จึงต้องมีฟอนต์ที่ครอบคลุม
// ไม่งั้นเบราว์เซอร์จะเลือกฟอนต์ระบบมาแทนเอง ซึ่งควบคุมหน้าตาไม่ได้
const notoThai = localFont({
  src: "./fonts/NotoSansThai-Variable.ttf",
  variable: "--font-noto-thai",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: {
    default: "CS Nexus",
    template: "%s · CS Nexus",
  },
  description:
    "ศูนย์กลางสังคมออนไลน์ วิดีโอสั้น ห้องคอลเสียง และแชทแลกเปลี่ยนไฟล์ประจำสาขาวิทยาการคอมพิวเตอร์",
};

/// ตั้งธีมก่อนเบราว์เซอร์วาดเฟรมแรก
///
/// **ต้องเป็นสคริปต์ที่รันทันทีใน <head> ไม่ใช่ใน React** — ถ้ารอให้ React
/// ทำงานก่อน เบราว์เซอร์จะวาดหน้าสว่างไปแล้วหนึ่งเฟรม แล้วค่อยกระพริบเป็นมืด
/// ซึ่งแสบตามากในห้องมืดและดูเหมือนเว็บพัง
///
/// ตรรกะตรงกับ `applyTheme` ใน components/csmju/theme-toggle.tsx
/// และคีย์ต้องตรงกับ `THEME_KEY` ที่นั่น
///
/// ห่อ try/catch เพราะโหมดส่วนตัวของเบราว์เซอร์โยน error ตอนแตะ localStorage
/// ซึ่งจะทำให้ทั้งสคริปต์หยุดและ colorScheme ไม่ถูกตั้ง
const THEME_BOOTSTRAP = `
try {
  var c = localStorage.getItem('csmju:theme');
  var dark = c === 'dark' || (c !== 'light' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
} catch (e) {}
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      // สคริปต์ข้างล่างแก้ class ของ <html> ก่อน React จะเทียบ
      // ไม่ใส่บรรทัดนี้แล้วผู้ใช้โหมดมืดจะเจอคำเตือน hydration ทุกครั้ง
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoThai.variable} h-full antialiased`}
    >
      <head>
        <script
          // เนื้อหาเป็นค่าคงที่ในไฟล์นี้ ไม่มีอะไรมาจากผู้ใช้
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
