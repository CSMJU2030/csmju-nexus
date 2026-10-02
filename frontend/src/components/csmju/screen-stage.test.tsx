import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenStage } from './screen-stage';

/// เทสต์จอที่กำลังแชร์
///
/// สองเรื่องที่ต้องกันไว้ให้ได้ตลอดไป:
///
///   1. **ผู้แชร์ต้องเห็นจอตัวเอง** — ของเดิมเรนเดอร์เฉพาะจอของคนอื่น
///      คนที่กดแชร์จึงไม่มีทางรู้ว่าเลือกจอถูกไหม ซึ่งเป็นสาเหตุอันดับหนึ่ง
///      ของการแชร์ผิดจอ (แชร์ทั้งเดสก์ท็อปทั้งที่ตั้งใจแชร์แค่หน้าต่างเดียว)
///
///   2. **วิดีโอต้อง muted เสมอ** — ของเดิมไม่ได้ใส่ เสียงผู้แชร์จึงดังซ้อน
///      สองรอบ เพราะ <RemoteAudio> เล่น stream เดียวกันอยู่แล้ว

vi.mock('@/components/csmju/user-name', () => ({
  UserName: ({ coreUserId }: { coreUserId: string }) => <span>{coreUserId}</span>,
}));

/// jsdom ไม่รองรับ srcObject — ต้องประกาศเองไม่งั้นการกำหนดค่าจะเงียบหาย
beforeEach(() => {
  if (!('srcObject' in HTMLMediaElement.prototype)) {
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      writable: true,
      value: null,
    });
  }

  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    writable: true,
    value: null,
  });
});

const fakeStream = () => ({ id: 'stream-1' }) as unknown as MediaStream;

function video(): HTMLVideoElement {
  const el = document.querySelector('video');

  if (!el) throw new Error('ไม่พบ <video>');

  return el;
}

describe('ScreenStage', () => {
  it('ไม่มี stream ก็ไม่เรนเดอร์อะไรเลย', () => {
    const { container } = render(
      <ScreenStage stream={null} presenterCoreUserId="user-003" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('**ผู้แชร์เห็นจอของตัวเอง**', () => {
    render(
      <ScreenStage stream={fakeStream()} presenterCoreUserId={null} />,
    );

    expect(screen.getByText('คุณกำลังแชร์หน้าจอนี้')).toBeInTheDocument();
    expect(
      screen.getByLabelText('หน้าจอที่คุณกำลังแชร์'),
    ).toBeInTheDocument();
  });

  it('ผู้ชมเห็นว่าใครกำลังแชร์', () => {
    render(
      <ScreenStage stream={fakeStream()} presenterCoreUserId="user-003" />,
    );

    expect(screen.getByText('user-003')).toBeInTheDocument();
    expect(
      screen.getByLabelText('หน้าจอที่อีกฝ่ายกำลังแชร์'),
    ).toBeInTheDocument();
  });

  it('**วิดีโอต้อง muted เสมอ** — ทั้งจอตัวเองและจอคนอื่น', () => {
    // จอตัวเอง: ไม่ muted = เสียงจากเครื่องวนกลับเข้าไมค์
    const mine = render(
      <ScreenStage stream={fakeStream()} presenterCoreUserId={null} />,
    );

    expect(video().muted).toBe(true);
    mine.unmount();

    // จอคนอื่น: <RemoteAudio> เล่น stream เดียวกันอยู่แล้ว
    // ไม่ muted = ได้ยินเสียงเขาสองรอบซ้อนกัน (บั๊กเดิม)
    render(
      <ScreenStage stream={fakeStream()} presenterCoreUserId="user-003" />,
    );

    expect(video().muted).toBe(true);
  });

  it('ผูก stream เข้ากับตัวเล่นจริง', () => {
    const stream = fakeStream();

    render(<ScreenStage stream={stream} presenterCoreUserId="user-003" />);

    expect(video().srcObject).toBe(stream);
  });

  it('ย่อ/ขยายได้', async () => {
    render(<ScreenStage stream={fakeStream()} presenterCoreUserId={null} />);

    await userEvent.click(screen.getByRole('button', { name: 'ย่อจอ' }));
    expect(screen.getByRole('button', { name: 'ขยายจอ' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ขยายจอ' }));
    expect(screen.getByRole('button', { name: 'ย่อจอ' })).toBeInTheDocument();
  });

  it('ซ่อนแล้วยังมีปุ่มเรียกกลับมา — ไม่ใช่หายไปเลย', async () => {
    render(<ScreenStage stream={fakeStream()} presenterCoreUserId={null} />);

    await userEvent.click(screen.getByRole('button', { name: 'ซ่อนจอที่แชร์' }));

    // ต้องไม่กลายเป็นว่าปิดไปแล้วเปิดกลับไม่ได้
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByText('คุณกำลังแชร์หน้าจอ')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button'));
    expect(document.querySelector('video')).not.toBeNull();
  });

  it('ผู้แชร์กดหยุดได้จากบนจอเลย', async () => {
    const onStop = vi.fn();

    render(
      <ScreenStage
        stream={fakeStream()}
        presenterCoreUserId={null}
        onStopSharing={onStop}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'หยุดแชร์หน้าจอ' }),
    );

    expect(onStop).toHaveBeenCalledOnce();
  });

  it('กรอบมีชื่อให้โปรแกรมอ่านหน้าจอ — แยกจากปุ่มชื่อซ้ำบนแถบควบคุม', () => {
    render(<ScreenStage stream={fakeStream()} presenterCoreUserId={null} />);

    expect(
      screen.getByRole('region', { name: 'จอที่กำลังแชร์' }),
    ).toBeInTheDocument();
  });

  it('ผู้ชมไม่มีปุ่มหยุดแชร์ของคนอื่น', () => {
    render(
      <ScreenStage stream={fakeStream()} presenterCoreUserId="user-003" />,
    );

    expect(
      screen.queryByRole('button', { name: 'หยุดแชร์หน้าจอ' }),
    ).not.toBeInTheDocument();
  });

  it('เต็มจอล้มเหลวก็ไม่ทำให้ทั้งหน้าพัง', async () => {
    // เบราว์เซอร์ปฏิเสธ requestFullscreen ได้หลายกรณี (นโยบายของ iframe,
    // ไม่ได้มาจากการกดของผู้ใช้) — ล้มแล้วก็แค่ไม่เต็มจอ
    Element.prototype.requestFullscreen = vi
      .fn()
      .mockRejectedValue(new Error('ไม่อนุญาต'));

    render(<ScreenStage stream={fakeStream()} presenterCoreUserId={null} />);

    await userEvent.click(screen.getByRole('button', { name: 'ดูเต็มจอ' }));

    // ยังอยู่ในโหมดปกติ และวิดีโอยังอยู่
    expect(screen.getByRole('button', { name: 'ดูเต็มจอ' })).toBeInTheDocument();
    expect(document.querySelector('video')).not.toBeNull();
  });
});
