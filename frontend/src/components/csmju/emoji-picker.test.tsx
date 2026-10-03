import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiPanel, isEmojiOnly, POPULAR_EMOJI } from './emoji-picker';

/// เทสต์แผงอิโมจิแบบ Instagram
///
/// ข้อมูลจริงทั้งชุด (Unicode + คำค้นไทยของ CLDR) ถูกโหลดในเทสต์ด้วย
/// เพื่อพิสูจน์ว่าค้นภาษาไทยได้จริง ไม่ใช่แค่ค้นชื่อภาษาอังกฤษ
///
/// วาดปุ่มเกือบสองพันปุ่มใน jsdom ช้ากว่าเบราว์เซอร์จริงมาก — ตอนรันพร้อมเทสต์อื่น
/// เกินเพดาน 5 วินาทีของ vitest ได้ จึงขยายเพดานเฉพาะไฟล์นี้
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  window.localStorage.clear();
});

describe('แผงอิโมจิ', () => {
  it('**มีครบทุกหมวดมาตรฐาน** และแท็บหมวดด้านล่าง', async () => {
    render(<EmojiPanel onPick={vi.fn()} />);

    for (const label of [
      'หน้ายิ้มและผู้คน',
      'สัตว์และธรรมชาติ',
      'อาหารและเครื่องดื่ม',
      'กิจกรรม',
      'การเดินทางและสถานที่',
      'วัตถุ',
      'สัญลักษณ์',
      'ธงชาติ',
    ]) {
      expect(await screen.findByRole('heading', { name: label }, { timeout: 15_000 })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }

    // ตัวอย่างจากหลายหมวด รวมลำดับ ZWJ และธง
    for (const emoji of ['😀', '🐱', '🍜', '⚽', '🚗', '💡', '❤️', '🇹🇭', '👩‍💻']) {
      expect(screen.getAllByRole('button', { name: emoji }).length).toBeGreaterThan(0);
    }
  });

  it('**ค้นหาภาษาไทยได้** — "แมว" เจอหน้าแมว', async () => {
    render(<EmojiPanel onPick={vi.fn()} />);

    await screen.findByRole('heading', { name: 'หน้ายิ้มและผู้คน' }, { timeout: 15_000 });
    await userEvent.type(screen.getByLabelText('ค้นหาอีโมจิ'), 'แมว');

    expect(await screen.findByRole('heading', { name: 'ผลการค้นหา' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '🐱' })).toBeInTheDocument();
  });

  it('ค้นหาภาษาอังกฤษได้ และบอกเมื่อไม่พบ', async () => {
    render(<EmojiPanel onPick={vi.fn()} />);

    await screen.findByRole('heading', { name: 'หน้ายิ้มและผู้คน' }, { timeout: 15_000 });
    await userEvent.type(screen.getByLabelText('ค้นหาอีโมจิ'), 'pizza');
    expect(await screen.findByRole('button', { name: '🍕' })).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('ค้นหาอีโมจิ'));
    await userEvent.type(screen.getByLabelText('ค้นหาอีโมจิ'), 'ไม่มีคำนี้แน่นอน');
    expect(await screen.findByText('ไม่พบอีโมจิ')).toBeInTheDocument();
  });

  it('เลือกแล้วส่งอิโมจิออกไป และจำไว้เป็น "ใช้ล่าสุด"', async () => {
    const onPick = vi.fn();
    const { unmount } = render(<EmojiPanel onPick={onPick} />);

    await screen.findByRole('heading', { name: 'หน้ายิ้มและผู้คน' }, { timeout: 15_000 });
    await userEvent.click(screen.getAllByRole('button', { name: '🐱' })[0]);
    expect(onPick).toHaveBeenCalledWith('🐱');
    unmount();

    render(<EmojiPanel onPick={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'ใช้ล่าสุด' }, { timeout: 15_000 })).toBeInTheDocument();
  });

  it('แบบรีแอ็กชันเริ่มที่ "ได้รับความนิยมสูงสุด" แบบ Instagram', async () => {
    render(<EmojiPanel variant="reaction" onPick={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'ได้รับความนิยมสูงสุด' }, { timeout: 15_000 })).toBeInTheDocument();
    await waitFor(() => expect(POPULAR_EMOJI.length).toBe(14));
  });
});

describe('ข้อความที่มีแต่อิโมจิ', () => {
  it.each([
    ['👁👄👁', true],
    ['😂', true],
    ['👩‍💻 🇹🇭', true],
    ['😀😀😀😀', false],
    ['ok 😀', false],
    ['', false],
  ])('%s → %s', (text, expected) => {
    expect(isEmojiOnly(text)).toBe(expected);
  });
});
