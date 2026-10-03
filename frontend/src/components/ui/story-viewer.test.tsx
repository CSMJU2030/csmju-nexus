import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// ชื่อมาจากแคชโปรไฟล์ — coreUserId จริงเป็น UUID ที่ห้ามขึ้นจอ
vi.mock('@/components/csmju/user-name', () => ({
  useProfile: (coreUserId: string) => ({
    coreUserId,
    displayName: coreUserId === 'a1b2c3d4-0000-4000-8000-000000000001' ? 'สมศักดิ์' : 'ผู้ใช้',
    avatarUrl: null,
    syncedAt: null,
    badge: null,
  }),
}));

const { StoryViewer } = await import('./story-viewer');
type Story = import('./story-viewer').Story;
const SOMSAK = 'a1b2c3d4-0000-4000-8000-000000000001';

/// เทสต์ของตัวเล่นสตอรี่
///
/// ชุดนี้เกิดขึ้นเพราะบั๊กจริง: `next()` เรียก `onClose()` (ซึ่งเป็น setState
/// ของ component แม่) อยู่ข้างใน updater ของ `setIndex` — React เรียก updater
/// ระหว่าง render จึงโยน "Cannot update a component while rendering a
/// different component"
///
/// เทสต์ที่ยิง HTTP อย่างเดียวจับข้อนี้ไม่ได้เลย เพราะมันเป็นเรื่องของวงจร
/// การ render ไม่ใช่เรื่องของ API

const stories: Story[] = [
  { id: 's1', type: 'image', src: 'https://example.test/1.png' },
  { id: 's2', type: 'image', src: 'https://example.test/2.png' },
];

function open() {
  return userEvent.click(screen.getByRole('button', { name: /ดูสตอรี่ของ/ }));
}

describe('StoryViewer', () => {
  it('เปิดแล้วแสดงสตอรี่ชิ้นแรก', async () => {
    render(<StoryViewer stories={stories} coreUserId={SOMSAK} />);

    await open();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByAltText(/สตอรี่ของ สมศักดิ์/)).toHaveAttribute(
      'src',
      stories[0].src,
    );
  });

  it('กดฝั่งขวาแล้วไปชิ้นถัดไป', async () => {
    render(<StoryViewer stories={stories} coreUserId={SOMSAK} />);

    await open();
    await userEvent.click(screen.getByRole('button', { name: 'ไปต่อ' }));

    expect(screen.getByAltText(/สตอรี่ของ สมศักดิ์/)).toHaveAttribute(
      'src',
      stories[1].src,
    );
  });

  it('ดูจบชิ้นสุดท้ายแล้วปิดเอง และแจ้ง onAllStoriesViewed ครั้งเดียว', async () => {
    const onAllStoriesViewed = vi.fn();

    render(
      <StoryViewer
        stories={stories}
        coreUserId={SOMSAK}
        onAllStoriesViewed={onAllStoriesViewed}
      />,
    );

    await open();

    // ไปชิ้นสุดท้าย แล้วกดต่ออีกครั้ง = จบ
    await userEvent.click(screen.getByRole('button', { name: 'ไปต่อ' }));
    await userEvent.click(screen.getByRole('button', { name: 'ไปต่อ' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    expect(onAllStoriesViewed).toHaveBeenCalledTimes(1);
  });

  // หมายเหตุ: เดิมมีเทสต์ตรงนี้ที่ดัก console.error เองแล้ว assert ว่าไม่มี
  // "Cannot update a component" — มันเขียวทั้งที่บั๊กยังอยู่ เพราะ React
  // แจ้งคำเตือนแต่ละแบบครั้งเดียว เทสต์ก่อนหน้าจึงกินคำเตือนไปหมดแล้ว
  //
  // ตอนนี้ vitest.setup.ts ดักที่ระดับชุดทดสอบ: console.error ครั้งแรก
  // ที่เกิดในเทสต์ไหนก็ตาม ทำให้เทสต์นั้นแดงทันที ซึ่งเชื่อถือได้จริง

  it('รายงานการดูครั้งเดียวต่อชิ้น แม้ component แม่ render ใหม่', async () => {
    // onStoryView เป็น arrow function ใหม่ทุก render ถ้า effect ผูกกับมัน
    // ตรง ๆ จะยิงซ้ำทุกครั้งที่แม่ render — อาการคือ POST /views รัว ๆ
    const onStoryView = vi.fn();

    const { rerender } = render(
      <StoryViewer
        stories={stories}
        coreUserId={SOMSAK}
        onStoryView={onStoryView}
      />,
    );

    await open();

    expect(onStoryView).toHaveBeenCalledTimes(1);

    // บังคับให้แม่ render ใหม่ด้วย callback ตัวใหม่
    rerender(
      <StoryViewer
        stories={stories}
        coreUserId={SOMSAK}
        onStoryView={(story, index) => onStoryView(story, index)}
      />,
    );

    rerender(
      <StoryViewer
        stories={stories}
        coreUserId={SOMSAK}
        onStoryView={(story, index) => onStoryView(story, index)}
      />,
    );

    expect(onStoryView).toHaveBeenCalledTimes(1);
  });

  it('ปุ่มลูกศรและ Escape ใช้ได้', async () => {
    render(<StoryViewer stories={stories} coreUserId={SOMSAK} />);

    await open();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByAltText(/สตอรี่ของ สมศักดิ์/)).toHaveAttribute(
      'src',
      stories[1].src,
    );

    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByAltText(/สตอรี่ของ สมศักดิ์/)).toHaveAttribute(
      'src',
      stories[0].src,
    );

    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('รูปโหลดไม่ขึ้นแล้วแจ้ง onMediaError และบอกผู้ใช้', async () => {
    const onMediaError = vi.fn();

    render(
      <StoryViewer
        stories={stories}
        coreUserId={SOMSAK}
        onMediaError={onMediaError}
      />,
    );

    await open();

    await act(async () => {
      screen
        .getByAltText(/สตอรี่ของ สมศักดิ์/)
        .dispatchEvent(new Event('error'));
    });

    expect(onMediaError).toHaveBeenCalledWith(stories[0]);
    expect(screen.getByText(/โหลดสื่อไม่ขึ้น/)).toBeInTheDocument();
  });

  it('ไม่มีสตอรี่ = กดปุ่มไม่ได้', () => {
    render(<StoryViewer stories={[]} coreUserId={SOMSAK} />);

    expect(screen.getByRole('button', { name: /ดูสตอรี่ของ/ })).toBeDisabled();
  });
});
