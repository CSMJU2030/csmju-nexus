import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactionBar } from '@/components/csmju/reaction-bar';
import type { ReactionSummary } from '@/lib/csmju/types';

/// เทสต์แถบอิโมจิ
///
/// จุดที่ต้องพิสูจน์: การถอนรีแอ็กชันส่ง DELETE พร้อม query string ที่ถูกต้อง
/// (อิโมจิต้องเข้ารหัส URL ไม่งั้นหลังบ้านจะได้ค่าเพี้ยนแล้วลบไม่ตรงตัว)

const summary = (totals: ReactionSummary['totals']): ReactionSummary => ({
  targetKind: 'POST',
  targetId: 'p1',
  totals,
  totalCount: totals.reduce((sum, row) => sum + row.count, 0),
});

function mockFetch(json: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true, data: json }),
  } as Response);
}

// แผงอิโมจิชุดเต็มวาดปุ่มเกือบสองพันปุ่ม — jsdom ช้ากว่าเบราว์เซอร์จริงมาก
vi.setConfig({ testTimeout: 30_000 });

describe('ReactionBar', () => {
  const original = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = original;
  });

  it('แสดงยอดที่มีคนกดแล้ว', () => {
    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={summary([
          { emoji: '👍', count: 3, reactedByMe: false },
          { emoji: '🎉', count: 1, reactedByMe: true },
        ])}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('ยังไม่มีใครกด = มีแค่ปุ่มเพิ่มรีแอ็กชัน', () => {
    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={null}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    ).toBeInTheDocument();
  });

  it('เลือกอิโมจิจากตัวเลือกแล้วยิง POST', async () => {
    const next = summary([{ emoji: '👍', count: 1, reactedByMe: true }]);
    const spy = mockFetch(next);

    globalThis.fetch = spy;

    const onChange = vi.fn();

    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={null}
        onChange={onChange}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    );
    // แผงโหลดชุดอิโมจิแบบ dynamic import — รอจนหมวดแรกขึ้นก่อน
    await userEvent.click((await screen.findAllByRole('button', { name: '👍' }, { timeout: 15_000 }))[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(next));

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];

    expect(url).toContain('/reactions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      targetKind: 'POST',
      targetId: 'p1',
      emoji: '👍',
    });
  });

  it('กดอิโมจิที่ตัวเองกดไว้แล้ว = ถอน (DELETE พร้อม query ที่เข้ารหัสถูก)', async () => {
    const spy = mockFetch(summary([]));

    globalThis.fetch = spy;

    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={summary([{ emoji: '👍', count: 1, reactedByMe: true }])}
        onChange={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTitle('กดอีกครั้งเพื่อถอน'));

    await waitFor(() => expect(spy).toHaveBeenCalled());

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];

    expect(init.method).toBe('DELETE');
    // อิโมจิต้องเข้ารหัส ไม่งั้นหลังบ้านได้ค่าเพี้ยนแล้วลบไม่ตรงตัว
    expect(url).toContain('emoji=%F0%9F%91%8D');
    expect(url).toContain('targetId=p1');
  });

  it('หลังบ้านปฏิเสธแล้วแสดงเหตุผลให้ผู้ใช้เห็น', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () =>
        JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'ไม่พบห้องนี้ หรือคุณไม่ได้เป็นสมาชิก',
          },
        }),
    } as Response);

    render(
      <ReactionBar
        targetKind="MESSAGE"
        targetId="m1"
        summary={null}
        onChange={vi.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    );
    // แผงโหลดชุดอิโมจิแบบ dynamic import — รอจนหมวดแรกขึ้นก่อน
    await userEvent.click((await screen.findAllByRole('button', { name: '👍' }, { timeout: 15_000 }))[0]);

    // ข้อความจากหลังบ้านต้องถึงผู้ใช้ ไม่ใช่เงียบไปเฉย ๆ
    expect(
      await screen.findByText(/ไม่พบห้องนี้ หรือคุณไม่ได้เป็นสมาชิก/),
    ).toBeInTheDocument();
  });

  it('**กด Esc แล้วแผงต้องปิด**', async () => {
    // ของเดิมปิดได้ทางเดียวคือกดปุ่มเดิมซ้ำ ซึ่งหาไม่เจอถ้าแผงบังปุ่มอยู่
    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={null}
        onChange={vi.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    );

    expect(await screen.findByLabelText('ค้นหาอีโมจิ', {}, { timeout: 15_000 })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByLabelText('ค้นหาอีโมจิ')).not.toBeInTheDocument();
  });

  it('กดที่อื่นแล้วแผงต้องปิด', async () => {
    render(
      <div>
        <button type="button">ที่อื่น</button>
        <ReactionBar
          targetKind="POST"
          targetId="p1"
          summary={null}
          onChange={vi.fn()}
        />
      </div>,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'ที่อื่น' }));

    expect(screen.queryByLabelText('ค้นหาอีโมจิ')).not.toBeInTheDocument();
  });

  it('กดในแผงเองไม่ทำให้แผงปิดก่อนจะเลือกได้', async () => {
    // ถ้าตัวดัก "กดที่อื่น" ไม่ยกเว้นตัวแผงเอง จะเลือกอิโมจิไม่ได้เลยสักตัว
    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={null}
        onChange={vi.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    );

    const search = await screen.findByLabelText('ค้นหาอีโมจิ', {}, { timeout: 15_000 });

    await userEvent.pointer({ target: search, keys: '[MouseLeft>]' });

    expect(screen.getByLabelText('ค้นหาอีโมจิ')).toBeInTheDocument();
  });

  it('**ตัวเลือกมีอิโมจิครบชุดมาตรฐาน** เริ่มที่ "ได้รับความนิยมสูงสุด" แบบ Instagram', async () => {
    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={null}
        onChange={vi.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    );

    // หาแผงด้วยชื่อ ไม่ใช่ตำแหน่งใน DOM — แผงลอยผ่าน portal ไปที่ body
    expect(await screen.findByRole('heading', { name: 'ได้รับความนิยมสูงสุด' }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ธงชาติ' })).toBeInTheDocument();

    const panel = screen.getByLabelText('ค้นหาอีโมจิ').closest("[role=dialog]")!;

    // เดิมมี 12 ตัว — ตอนนี้ต้องเป็นชุดเต็มหลักพันตัว
    expect(panel.querySelectorAll('button').length).toBeGreaterThan(1000);
  });

  it('อิโมจิที่ไม่อยู่ในชุดเดิม 12 ตัวก็กดได้ (เช่น 🥰)', async () => {
    const next = summary([{ emoji: '🥰', count: 1, reactedByMe: true }]);
    const spy = mockFetch(next);

    globalThis.fetch = spy;

    render(
      <ReactionBar targetKind="POST" targetId="p1" summary={null} onChange={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }));
    await userEvent.click((await screen.findAllByRole('button', { name: '🥰' }, { timeout: 15_000 }))[0]);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string).emoji).toBe('🥰');
  });
});

describe('ชื่อที่โปรแกรมอ่านหน้าจออ่านได้', () => {
  it('ปุ่มอิโมจิในตัวเลือกมีชื่อจริง ไม่ใช่ปุ่มเปล่า', async () => {
    // ชื่อปุ่มคือตัวอิโมจิเอง ซึ่งโปรแกรมอ่านหน้าจออ่านเป็นชื่อมาตรฐานได้
    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={summary([])}
        onChange={vi.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    );

    expect((await screen.findAllByRole('button', { name: '😂' }, { timeout: 15_000 })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '🙏' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '💡' }).length).toBeGreaterThan(0);
  });

  it('ยอดที่กดแล้วอ่านออกว่าเป็นอิโมจิอะไร กี่คน', async () => {
    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={summary([{ emoji: '👍', count: 3, reactedByMe: true }])}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: /ถูกใจ 3 คน · คุณกดแล้ว/ }),
    ).toBeInTheDocument();
  });
});

