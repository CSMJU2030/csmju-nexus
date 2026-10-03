import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/// เทสต์การจัดการ session ตาม standards 1.7.0 (auth-contract.md ข้อ 5 · 7)
///
/// - 401 จาก API ที่ไหนก็ตาม → พาทั้งหน้าไป `/auth/login?next=<path+query>`
///   (silent re-SSO) ด้วย `window.location` ไม่ใช่ fetch
/// - **กันวน:** เพิ่งกลับจาก re-SSO ไม่ถึง 30 วินาทีแล้วยังได้ 401 → แสดงปุ่ม
///   "เข้าสู่ระบบอีกครั้ง" แทนการ redirect ซ้ำ
/// - ออกจากระบบ = ฟอร์ม POST ไป `/auth/logout` (หลังบ้าน 303 ไปเว็บ Core Hub)

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  let handler: (() => void) | null = null;

  return {
    ApiError: actual.ApiError,
    api: {
      get: (path: string) => apiGet(path),
      post: (path: string, body?: unknown) => apiPost(path, body),
    },
    setUnauthorizedHandler: (fn: (() => void) | null) => {
      handler = fn;
    },
    /// ให้เทสต์เรียกได้เหมือน api.ts เจอ 401 จากคำขออื่น
    __fire401: () => handler?.(),
  };
});

let assigned: string | null = null;
let submitted: HTMLFormElement[] = [];

beforeEach(() => {
  vi.resetModules();
  apiGet.mockReset();
  apiPost.mockReset();
  assigned = null;
  submitted = [];
  window.sessionStorage.clear();

  // jsdom ส่งฟอร์มจริงไม่ได้ ("Not implemented") — จับไว้ดูว่าส่งไปที่ไหน
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
    this: HTMLFormElement,
  ) {
    submitted.push(this);
  });

  // `window.location.href = …` ใน jsdom จะพยายามเปลี่ยนหน้าจริง
  // จึงแทนที่ด้วยตัวจับค่าเพื่อดูว่าเราพาไปไหน
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: '/reels',
      search: '?id=7',
      get href() {
        return 'http://localhost:3222/reels?id=7';
      },
      set href(value: string) {
        assigned = value;
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function load() {
  const mod = await import('./session');
  const apiMod = (await import('./api')) as unknown as {
    __fire401: () => void;
  };

  return { ...mod, fire401: apiMod.__fire401 };
}

const ME = {
  id: 'user-002',
  email: 'student@core.local',
  coreRole: 'student' as const,
  subsystemRole: 'GUEST' as const,
  session: { expiresAt: '2026-10-02T00:15:00.000Z' },
};

const RE_SSO = `/auth/login?next=${encodeURIComponent('/reels?id=7')}`;

async function unauthorized() {
  const { ApiError } = await import('./api');

  return new ApiError(401, 'UNAUTHORIZED', 'ยืนยันตัวตนไม่สำเร็จ');
}

describe('SessionProvider', () => {
  it('ล็อกอินอยู่ก็เรนเดอร์เนื้อหาตามปกติ', async () => {
    apiGet.mockResolvedValue(ME);

    const { SessionProvider } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    expect(await screen.findByText('เนื้อหาของแอป')).toBeInTheDocument();
    expect(assigned).toBeNull();
  });

  it('**ลงทะเบียนเป็นสมาชิกทุกครั้งที่เปิดแอป** (GET /subsystem-members/me) — ผู้ใช้ใหม่จะได้ชื่อและสิทธิ์ที่ถูก', async () => {
    // พบตอนทดสอบกับ Core Hub จริง: ไม่มีอะไรเรียกเส้นนี้ ผู้ใช้ใหม่ทั้งระบบโชว์เป็น UUID
    apiGet.mockResolvedValue(ME);

    const { SessionProvider } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    await screen.findByText('เนื้อหาของแอป');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/subsystem-members/me'));
  });

  it('ลงทะเบียนสมาชิกล้ม → แอปยังเปิดได้ตามปกติ', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/subsystem-members/me') throw new Error('db down');
      return ME;
    });

    const { SessionProvider } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    expect(await screen.findByText('เนื้อหาของแอป')).toBeInTheDocument();
  });

  it('ยังไม่ล็อกอิน (401 ตอนเปิด) → พาทั้งหน้าไป /auth/login?next=<path+query>', async () => {
    apiGet.mockRejectedValue(await unauthorized());

    const { SessionProvider } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    await waitFor(() => expect(assigned).toBe(RE_SSO));
    expect(screen.queryByText('เนื้อหาของแอป')).not.toBeInTheDocument();
  });

  it('**token หมดอายุกลางทาง → re-SSO ทั้งหน้า**', async () => {
    apiGet.mockResolvedValue(ME);

    const { SessionProvider, fire401 } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    await screen.findByText('เนื้อหาของแอป');
    await act(async () => fire401());

    await waitFor(() => expect(assigned).toBe(RE_SSO));
    expect(await screen.findByText(/กำลังพาไปเข้าสู่ระบบ/)).toBeInTheDocument();
  });

  it('**กันวน:** เพิ่งกลับจาก re-SSO ไม่ถึง 30 วินาทีแล้วยังได้ 401 → ปุ่ม "เข้าสู่ระบบอีกครั้ง" ไม่ redirect', async () => {
    // เพิ่งพาไป re-SSO เมื่อ 5 วินาทีก่อน
    window.sessionStorage.setItem('csmju:last-resso', String(Date.now() - 5_000));
    apiGet.mockRejectedValue(await unauthorized());

    const { SessionProvider } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    const button = await screen.findByRole('link', { name: 'เข้าสู่ระบบอีกครั้ง' });

    expect(button).toHaveAttribute('href', RE_SSO);
    expect(assigned).toBeNull();
  });

  it('re-SSO ครั้งก่อนเกิน 30 วินาทีแล้ว → พาไปเองได้อีก', async () => {
    window.sessionStorage.setItem('csmju:last-resso', String(Date.now() - 31_000));
    apiGet.mockRejectedValue(await unauthorized());

    const { SessionProvider } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    await waitFor(() => expect(assigned).toBe(RE_SSO));
  });

  it('sessionStorage ใช้ไม่ได้ (โหมดส่วนตัว) → ไม่มีตัวนับกันวน จึงให้กดเอง', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    apiGet.mockRejectedValue(await unauthorized());

    const { SessionProvider } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    expect(await screen.findByRole('link', { name: 'เข้าสู่ระบบอีกครั้ง' })).toBeInTheDocument();
    expect(assigned).toBeNull();
  });

  it('error อื่นที่ไม่ใช่ 401 ต้องบอกสาเหตุจริง ไม่ซ่อน และไม่ redirect', async () => {
    apiGet.mockRejectedValue(new Error('ติดต่อหลังบ้านไม่ได้'));

    const { SessionProvider } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    expect(await screen.findByText('ติดต่อหลังบ้านไม่ได้')).toBeInTheDocument();
    expect(assigned).toBeNull();
  });
});

describe('ออกจากระบบ', () => {
  async function renderWithSignOut() {
    apiGet.mockResolvedValue(ME);

    const { SessionProvider, useSignOut } = await load();

    function SignOutButton() {
      const signOut = useSignOut();

      return (
        <button type="button" onClick={() => void signOut()}>
          ออกจากระบบ
        </button>
      );
    }

    render(
      <SessionProvider>
        <SignOutButton />
      </SessionProvider>,
    );

    return screen.findByRole('button', { name: 'ออกจากระบบ' });
  }

  it('**ส่งฟอร์ม POST ไป /auth/logout** (ไม่ใช่ fetch) — หลังบ้าน 303 ไปเว็บ Core Hub', async () => {
    const button = await renderWithSignOut();

    await act(async () => button.click());

    expect(submitted).toHaveLength(1);
    expect(submitted[0].method).toBe('post');
    expect(new URL(submitted[0].action, 'http://localhost:3222').pathname).toBe('/auth/logout');
    // ห้ามส่ง token ไปเพิกถอนเองแบบตัวเดิม (POST /api/v1/auth/logout)
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('ล้างตัวนับกันวน — คนถัดไปที่ใช้เครื่องนี้ไม่ติดปุ่มค้าง', async () => {
    const button = await renderWithSignOut();

    window.sessionStorage.setItem('csmju:last-resso', String(Date.now()));
    await act(async () => button.click());

    expect(window.sessionStorage.getItem('csmju:last-resso')).toBeNull();
  });
});

describe('ตัวช่วย', () => {
  it('loginHref เข้ารหัส next', async () => {
    const { loginHref } = await load();

    expect(loginHref('/reels?id=7&x=1')).toBe('/auth/login?next=%2Freels%3Fid%3D7%26x%3D1');
    expect(loginHref()).toBe('/auth/login');
  });

  it('isStaffLike: อาจารย์ได้สิทธิ์เท่าเจ้าหน้าที่ ผู้เยี่ยมชมไม่ได้', async () => {
    const { isStaffLike } = await load();

    expect(isStaffLike('staff')).toBe(true);
    expect(isStaffLike('lecturer')).toBe(true);
    expect(isStaffLike('admin')).toBe(true);
    expect(isStaffLike('student')).toBe(false);
    expect(isStaffLike('alumni')).toBe(false);
    expect(isStaffLike('guest')).toBe(false);
  });
});
