import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExploreFooter } from './explore-footer';
import {
  RECENT_KEY,
  recentFromQuery,
  SearchRecents,
  useSearchRecents,
  type RecentItem,
} from './explore-recents';

/// เทสต์ "ค้นหาล่าสุด" และท้ายหน้าสำรวจ
///
///   - **แยกตามบัญชี** — เครื่องในแล็บสลับคนใช้ คนถัดไปต้องไม่เห็นว่าคนก่อนค้นใคร
///   - localStorage โยน error ได้ (หน้าต่างส่วนตัว) หน้าต้องไม่พัง
///   - ล้างทั้งหมดต้องยืนยันด้วยข้อความตาม Instagram
///   - ท้ายหน้าลิงก์เฉพาะของที่มีจริง

vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span aria-hidden />,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: coreUserId }),
}));

const person: RecentItem = { kind: 'person', id: 'user-003', title: 'staff', subtitle: 'user-003' };

beforeEach(() => {
  window.localStorage.clear();
});

describe('useSearchRecents', () => {
  it('**แยกตาม id ผู้ใช้** ใต้คีย์ csmju:search-recent', () => {
    const a = renderHook(() => useSearchRecents('user-002'));

    act(() => a.result.current.add(person));

    const b = renderHook(() => useSearchRecents('user-003'));

    expect(b.result.current.items).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '{}')).toEqual({
      'user-002': [person],
    });

    // เปิดหน้าใหม่ด้วยบัญชีเดิม → ยังอยู่
    expect(renderHook(() => useSearchRecents('user-002')).result.current.items).toEqual([person]);
  });

  it('กดของเดิมซ้ำ = ย้ายขึ้นบนสุด ไม่ซ้ำสองแถว · ลบทีละแถว · ล้างทั้งหมด', () => {
    const { result } = renderHook(() => useSearchRecents('user-002'));
    const query = recentFromQuery('pointer');

    act(() => result.current.add(person));
    act(() => result.current.add(query));
    act(() => result.current.add(person));

    expect(result.current.items).toEqual([person, query]);

    act(() => result.current.remove(person));
    expect(result.current.items).toEqual([query]);

    act(() => result.current.clear());
    expect(result.current.items).toEqual([]);
  });

  it('คำค้นที่ขึ้นต้นด้วย # จำเป็นแฮชแท็ก', () => {
    expect(recentFromQuery(' #CSMJU ')).toEqual({ kind: 'hashtag', id: '#CSMJU' });
    expect(recentFromQuery('pointer')).toEqual({ kind: 'query', id: 'pointer' });
  });

  it('**localStorage โยน error → ไม่พัง** แค่ไม่มีรายการล่าสุด', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });

    const { result } = renderHook(() => useSearchRecents('user-002'));

    expect(result.current.items).toEqual([]);
    act(() => result.current.add(person));
    expect(result.current.items).toEqual([person]);

    get.mockRestore();
    set.mockRestore();
  });

  it('ข้อมูลในเครื่องเสีย (แก้มือ) → กรองแถวที่ไม่รู้จักทิ้ง', () => {
    window.localStorage.setItem(
      RECENT_KEY,
      JSON.stringify({ 'user-002': [person, { kind: 'evil' }, 42, { kind: 'query', id: 'ok' }] }),
    );

    const { result } = renderHook(() => useSearchRecents('user-002'));

    expect(result.current.items).toEqual([person, { kind: 'query', id: 'ok' }]);
  });
});

describe('รายการล่าสุด', () => {
  function renderList(items: RecentItem[]) {
    const props = {
      items,
      onRemove: vi.fn(),
      onClear: vi.fn(),
      onOpen: vi.fn(),
      onSearch: vi.fn(),
    };

    render(<SearchRecents {...props} />);

    return props;
  }

  it('ว่าง → "ไม่มีการค้นหาล่าสุด" และไม่มีปุ่มล้างทั้งหมด', () => {
    renderList([]);

    expect(screen.getByRole('heading', { name: 'ล่าสุด' })).toBeInTheDocument();
    expect(screen.getByText('ไม่มีการค้นหาล่าสุด')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ล้างทั้งหมด' })).not.toBeInTheDocument();
  });

  it('คนพาไปโปรไฟล์ · ห้องพาไปห้องแชท · คำค้นค้นซ้ำ · ✕ ลบแถวนั้น', async () => {
    const user = userEvent.setup();
    const props = renderList([
      person,
      { kind: 'room', id: 'ch-1', title: 'ติวสอบ DS' },
      { kind: 'query', id: 'pointer' },
    ]);

    expect(screen.getByRole('link', { name: /staff/ })).toHaveAttribute('href', '/profile/user-003');
    expect(screen.getByRole('link', { name: /ติวสอบ DS/ })).toHaveAttribute('href', '/chat?channel=ch-1');

    await user.click(screen.getByRole('button', { name: 'pointer' }));
    expect(props.onSearch).toHaveBeenCalledWith('pointer');

    await user.click(screen.getByRole('button', { name: 'ลบ ติวสอบ DS ออกจากรายการล่าสุด' }));
    expect(props.onRemove).toHaveBeenCalledWith({ kind: 'room', id: 'ch-1', title: 'ติวสอบ DS' });
  });

  it('**ล้างทั้งหมดต้องยืนยัน** ด้วยข้อความตาม Instagram · "ไม่ใช่ตอนนี้" ไม่ล้าง', async () => {
    const user = userEvent.setup();
    const props = renderList([person]);

    await user.click(screen.getByRole('button', { name: 'ล้างทั้งหมด' }));

    const dialog = screen.getByRole('dialog');

    expect(dialog).toHaveTextContent('ล้างประวัติการค้นหาใช่ไหม');
    expect(dialog).toHaveTextContent(
      'คุณจะไม่สามารถยกเลิกการกระทำนี้ได้ และหากคุณล้างประวัติการค้นหา คุณอาจยังคงเห็นบัญชีที่คุณเคยค้นหาเป็นบัญชีที่แนะนำ',
    );

    await user.click(screen.getByRole('button', { name: 'ไม่ใช่ตอนนี้' }));
    expect(props.onClear).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'ล้างทั้งหมด' }));
    // ปุ่มแดงในกล่องยืนยันชื่อเดียวกับลิงก์ด้านบน — เลือกตัวที่อยู่ในกล่อง
    const confirm = screen
      .getAllByRole('button', { name: 'ล้างทั้งหมด' })
      .find((button) => button.closest('dialog'));

    await user.click(confirm as HTMLElement);
    expect(props.onClear).toHaveBeenCalledOnce();
  });
});

describe('ท้ายหน้าสำรวจ', () => {
  it('**ลิงก์เฉพาะของที่มีจริง** (เอกสาร API) ที่เหลือเป็นตัวหนังสือ · บรรทัดลิขสิทธิ์', () => {
    render(<ExploreFooter />);

    const links = screen.getAllByRole('link');

    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('API');
    expect(links[0]).toHaveAttribute('href', '/api/docs');

    for (const label of ['เกี่ยวกับ', 'ความช่วยเหลือ', 'ความเป็นส่วนตัว', 'ข้อกำหนด', 'ภาษา ไทย']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('© 2026 CS Nexus · CSMJU2030 มหาวิทยาลัยแม่โจ้')).toBeInTheDocument();
  });
});
