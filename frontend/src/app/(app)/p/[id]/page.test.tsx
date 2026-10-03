import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Post } from '@/lib/csmju/types';
import PostPage from './page';

/// เทสต์หน้าโพสต์ /p/:id — ภาพหมุนของสื่อจริง · คำบรรยาย · ปิดความคิดเห็น · ลิงก์เสีย

const FakeApiError = vi.hoisted(
  () =>
    class FakeApiError extends Error {
      constructor(
        public status: number,
        message: string,
      ) {
        super(message);
      }
    },
);

const apiGet = vi.hoisted(() => vi.fn());
const apiList = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'post-1' }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/csmju/api', () => ({
  api: { get: apiGet, list: apiList, post: vi.fn(), del: vi.fn() },
  ApiError: FakeApiError,
  qs: () => '',
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 'x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span aria-hidden />,
  UserName: ({ coreUserId }: { coreUserId: string }) => <span>ชื่อ {coreUserId}</span>,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: `ชื่อ ${coreUserId}` }),
}));
vi.mock('@/components/csmju/reaction-bar', () => ({ ReactionBar: () => <span>รีแอ็กชัน</span> }));

const post: Post = {
  id: 'post-1',
  title: '',
  content: 'สรุปบทที่ 3 แบบภาพ',
  courseTag: null,
  authorCoreUserId: 'user-003',
  commentCount: 0,
  reactions: null,
  createdAt: '2026-09-29T10:00:00+07:00',
  media: [
    { assetId: 'a1', kind: 'IMAGE', url: 'http://files.local/a1.jpg', mimeType: 'image/jpeg' },
    { assetId: 'a2', kind: 'IMAGE', url: 'http://files.local/a2.jpg', mimeType: 'image/jpeg' },
  ],
  canComment: true,
};

beforeEach(() => {
  apiGet.mockReset();
  apiList.mockReset();
  apiList.mockResolvedValue({ items: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } });
  Element.prototype.scrollTo = vi.fn();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <PostPage />
    </QueryClientProvider>,
  );
}

describe('หน้าโพสต์', () => {
  it('ภาพหมุนของสื่อจริง (1/2 · ถัดไป) + คำบรรยาย + ช่องความคิดเห็น', async () => {
    apiGet.mockResolvedValue(post);
    renderPage();

    expect(await screen.findByRole('img', { name: 'สื่อชิ้นที่ 1 จาก 2' })).toHaveAttribute('src', 'http://files.local/a1.jpg');
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'สื่อถัดไป' })).toBeInTheDocument();
    expect(screen.getByText('สรุปบทที่ 3 แบบภาพ')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'เพิ่มความคิดเห็น' })).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/posts/post-1');
  });

  it('**เจ้าของปิดความคิดเห็น → ไม่มีช่องพิมพ์ ขึ้น "ปิดการแสดงความคิดเห็น"**', async () => {
    apiGet.mockResolvedValue({ ...post, canComment: false });
    renderPage();

    expect(await screen.findByText('ปิดการแสดงความคิดเห็น')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'เพิ่มความคิดเห็น' })).not.toBeInTheDocument();
  });

  it('⋯ เปิดเมนูโพสต์ (ไม่มี "ไปยังโพสต์" เพราะอยู่ที่โพสต์แล้ว)', async () => {
    const user = userEvent.setup();

    apiGet.mockResolvedValue(post);
    renderPage();

    const [menu] = await screen.findAllByRole('button', { name: 'ตัวเลือกของโพสต์' });

    await user.click(menu);

    expect(screen.getByRole('button', { name: 'รายงาน' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ไปยังโพสต์' })).not.toBeInTheDocument();
  });

  it('ลิงก์เสีย (404) → "ไม่พบโพสต์นี้" + กลับไปที่ฟีด', async () => {
    apiGet.mockRejectedValue(new FakeApiError(404, 'ไม่พบโพสต์'));
    renderPage();

    expect(await screen.findByText('ไม่พบโพสต์นี้')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'กลับไปที่ฟีด' })).toHaveAttribute('href', '/feed');
  });
});
