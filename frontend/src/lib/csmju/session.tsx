'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

/// ตัวตนของผู้ใช้ที่ล็อกอินอยู่ — **มาจาก Core Hub ทั้งหมด ไม่มีของปลอม**
///
/// Central SSO ของ standards 1.7.0 (auth-contract.md ข้อ 5 · 7):
///
///   1. ทุกการเข้าสู่ระบบเริ่มที่ `GET /auth/login?next=<หน้านี้>` ของเราเอง
///      (หน้าบ้าน rewrite ไปที่หลังบ้าน) ซึ่งสร้าง state แล้วส่งไปเว็บ Core Hub
///   2. Core Hub ล็อกอินหรือต่ออายุให้เงียบ ๆ แล้วส่งกลับมาที่ `/auth/callback`
///   3. หลังบ้านตรวจ state + token ครบ 10 ขั้น ตั้งคุกกี้ HttpOnly แล้วพากลับหน้าเดิม
///   4. หน้าบ้านถาม `GET /api/v1/me` ว่าคุกกี้นั้นเป็นของใคร
///
/// หน้าบ้านจึง **อ่าน token ไม่ได้เลย** (HttpOnly) และเปลี่ยนตัวตนเองไม่ได้
///
/// **Silent re-SSO:** API ตอบ 401 เมื่อไร (ยังไม่ล็อกอิน หรือ token 15 นาทีหมด)
/// พาทั้งหน้าไป `/auth/login?next=<path และ query ปัจจุบัน>` ด้วย `window.location`
/// — ห้ามใช้ fetch เพราะตาม redirect ไป Core Hub ไม่ได้และไม่ได้คุกกี้

import { api, ApiError, setUnauthorizedHandler } from './api';

/// core role ทั้ง 6 ค่า (authorization.md ข้อ 2 · standards 1.6.0+)
export type CoreRole = 'student' | 'alumni' | 'staff' | 'lecturer' | 'guest' | 'admin';
export type SubsystemRole = 'GUEST' | 'EDITOR' | 'ADMIN';

/// รูปร่างตาม `contracts/openapi.yaml` (`MeEnvelope`) — สี่ฟิลด์บังคับ
/// และ `session.expiresAt` ที่ไม่บังคับ (เวลาหมดอายุของ token)
export interface Me {
  /// ค่า `sub` จาก token เช่น "user-002" — **ไม่ใช่รหัสนักศึกษา**
  id: string;
  email: string;
  coreRole: CoreRole;
  subsystemRole: SubsystemRole;
  session?: { expiresAt: string };
}

export { isStaffLike } from './roles';

/// ทางเข้าระบบ — `/auth/login` ของเราเอง (ไม่ใช่หน้า login ของ Core Hub)
///
/// `next` ต้องเป็น path ภายใน หลังบ้านตรวจซ้ำตามกฎข้อ 5.2 อีกชั้นอยู่แล้ว
export function loginHref(next?: string): string {
  return next ? `/auth/login?next=${encodeURIComponent(next)}` : '/auth/login';
}

/// path และ query ของหน้าปัจจุบัน — ค่า `next` ของ re-SSO
export function currentPath(): string {
  return window.location.pathname + window.location.search;
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; me: Me }
  /// กำลังพาทั้งหน้าไป /auth/login — Core Hub จะส่งกลับมาหน้าเดิมเอง
  | { status: 'redirecting' }
  /// เพิ่งกลับจาก re-SSO ไม่ถึง 30 วินาทีแล้วยังได้ 401 — **ห้าม redirect ซ้ำ**
  /// แสดงปุ่ม "เข้าสู่ระบบอีกครั้ง" ให้ผู้ใช้กดเอง (auth-contract.md ข้อ 7 กันวน)
  | { status: 'stalled' }
  | { status: 'error'; message: string };

/// กันวนลูป: เวลาที่พาไป re-SSO ครั้งล่าสุด
///
/// ไม่ล้างค่านี้ตอนกลับมาสำเร็จโดยเจตนา — ถ้า /me ผ่านแต่คำขออื่นยังได้ 401
/// ภายใน 30 วินาที (เช่นคุกกี้ตั้งไม่ติด) การล้างจะทำให้วนไม่จบ
const RESSO_KEY = 'csmju:last-resso';
const RESSO_COOLDOWN_MS = 30_000;

function shouldAutoReSso(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RESSO_KEY) ?? 0);

    if (Date.now() - last < RESSO_COOLDOWN_MS) return false;

    window.sessionStorage.setItem(RESSO_KEY, String(Date.now()));

    return true;
  } catch {
    // โหมดส่วนตัวบล็อก sessionStorage — ไม่มีตัวนับกันวน ให้ผู้ใช้กดเอง
    return false;
  }
}

const SessionContext = createContext<State | null>(null);
const SignOutContext = createContext<(() => Promise<void>) | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  /// 401 จากที่ไหนก็ตาม → re-SSO ทั้งหน้า หรือปุ่มเมื่อเพิ่งกลับมาไม่ถึง 30 วินาที
  const reSso = useCallback(() => {
    if (shouldAutoReSso()) {
      setState({ status: 'redirecting' });
      window.location.href = loginHref(currentPath());
      return;
    }

    setState({ status: 'stalled' });
  }, []);

  // ดัก 401 ที่เกิดจาก **คำขออื่น** ระหว่างใช้งาน (token 15 นาทีหมดกลางทาง)
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState((current) => {
        // ยังไม่รู้ตัวตน = คำขอ /me ด้านล่างจัดการเอง ไม่ต้องซ้อน
        if (current.status === 'ready') queueMicrotask(reSso);

        return current;
      });
    });

    return () => setUnauthorizedHandler(null);
  }, [reSso]);

  useEffect(() => {
    let alive = true;

    api
      .get<Me>('/me')
      .then((me) => {
        if (alive) setState({ status: 'ready', me });
      })
      .catch((error: unknown) => {
        if (!alive) return;

        // 401 = ยังไม่ล็อกอินหรือหมดอายุ — ไม่ใช่ความผิดพลาด
        // Core Hub ที่ยังจำผู้ใช้ได้จะส่งกลับมาเองภายในไม่ถึงวินาที
        if (error instanceof ApiError && error.status === 401) {
          reSso();
          return;
        }

        setState({
          status: 'error',
          message:
            error instanceof Error ? error.message : 'ตรวจสอบตัวตนไม่สำเร็จ',
        });
      });

    return () => {
      alive = false;
    };
  }, [reSso]);

  /// ออกจากระบบ **ทั้งหมด** — ส่งฟอร์ม POST ไป `/auth/logout` แบบเปลี่ยนทั้งหน้า
  ///
  /// หลังบ้านลบคุกกี้ทั้งสองแล้ว 303 ไปหน้า `/logout` ของ Core Hub ให้ผู้ใช้
  /// ยืนยันการออกจาก Core Hub (ออกแค่ระบบนี้ไม่พอ — กดเข้าใหม่จะ SSO กลับมาทันที)
  /// เป็นฟอร์มไม่ใช่ fetch เพราะ fetch ตาม redirect ข้าม origin ไม่ได้
  const signOut = useCallback(async () => {
    try {
      window.sessionStorage.removeItem(RESSO_KEY);
    } catch {
      // ไม่มีอะไรให้ล้าง
    }

    const form = document.createElement('form');

    form.method = 'POST';
    form.action = '/auth/logout';
    form.style.display = 'none';
    document.body.appendChild(form);
    form.submit();
  }, []);

  return (
    <SessionContext.Provider value={state}>
      <SignOutContext.Provider value={signOut}>
        {state.status === 'ready' ? children : <SessionGate state={state} />}
      </SignOutContext.Provider>
    </SessionContext.Provider>
  );
}

/// ออกจากระบบ — ใช้ได้เฉพาะใต้ `<SessionProvider>`
export function useSignOut(): () => Promise<void> {
  const signOut = useContext(SignOutContext);

  if (!signOut) {
    throw new Error('useSignOut ต้องอยู่ใต้ <SessionProvider>');
  }

  return signOut;
}

/// หน้าจอระหว่างที่ยังไม่รู้ว่าเป็นใคร
function SessionGate({ state }: { state: Exclude<State, { status: 'ready' }> }) {
  if (state.status === 'loading' || state.status === 'redirecting') {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <p className="text-csmju-label text-muted-foreground">
          {state.status === 'loading'
            ? 'กำลังตรวจสอบตัวตน…'
            : 'กำลังพาไปเข้าสู่ระบบด้วยบัญชี CSMJU2030…'}
        </p>
      </div>
    );
  }

  const copy =
    state.status === 'stalled'
      ? {
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          body: 'เพิ่งกลับมาจากการเข้าสู่ระบบแต่ยังยืนยันตัวตนไม่ได้ — ลองอีกครั้ง ถ้ายังไม่ได้ให้ตรวจว่าเปิดเว็บด้วย localhost ไม่ใช่ 127.0.0.1',
        }
      : { title: 'ตรวจสอบตัวตนไม่สำเร็จ', body: state.message };

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-csmju-title">{copy.title}</h1>

        <p className="mt-2 text-csmju-body text-muted-foreground">{copy.body}</p>

        {/* <a> ไม่ใช่ <Link> — /auth/login เป็นของหลังบ้าน ต้องเปลี่ยนทั้งหน้า */}
        <a
          href={loginHref(currentPath())}
          className="csmju-brand mt-5 inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-csmju-label font-medium shadow-csmju-glow"
        >
          เข้าสู่ระบบอีกครั้ง
        </a>
      </div>
    </div>
  );
}

/// ตัวตนของผู้ใช้ปัจจุบัน — ใช้ได้เฉพาะใต้ `<SessionProvider>`
///
/// คืนค่าแบบ synchronous ได้เพราะ provider ไม่เรนเดอร์ children จนกว่าจะรู้
/// แล้วว่าเป็นใคร หน้าจอข้างในจึงไม่ต้องเขียนเคส "ยังไม่รู้ว่าเป็นใคร" ซ้ำ ๆ
export function useMe(): Me {
  const state = useContext(SessionContext);

  if (!state) {
    throw new Error('useMe ต้องอยู่ใต้ <SessionProvider>');
  }

  if (state.status !== 'ready') {
    throw new Error('ยังไม่รู้ว่าผู้ใช้เป็นใคร');
  }

  return state.me;
}
