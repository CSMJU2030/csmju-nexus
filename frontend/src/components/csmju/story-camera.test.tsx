import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraSwipe } from './camera-swipe';
import { StoryCamera } from './story-camera';

/// กล้องแบบ Instagram — สลับกล้องหน้า-หลัง · ฟิลเตอร์ · ไม่มีกล้องแล้วเลือกจากคลังได้ · ปัดขวาเปิดกล้อง

vi.mock('@/lib/csmju/api', () => ({
  api: { post: vi.fn().mockResolvedValue({}) },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/csmju/upload', () => ({ uploadFile: vi.fn() }));

const getUserMedia = vi.fn();
const enumerateDevices = vi.fn();

function fakeStream() {
  const track = { stop: vi.fn(), kind: 'video' };

  return { getTracks: () => [track], getVideoTracks: () => [track], track };
}

function renderCamera() {
  const client = new QueryClient();

  return render(
    <QueryClientProvider client={client}>
      <StoryCamera open onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  getUserMedia.mockReset();
  enumerateDevices.mockReset();
  vi.restoreAllMocks();
});

describe('StoryCamera', () => {
  it('มีสองกล้อง: เริ่มกล้องหน้า · กดสลับแล้วขอกล้องหลังและปิดกล้องเดิม', async () => {
    const front = fakeStream();
    const back = fakeStream();

    getUserMedia.mockResolvedValueOnce(front).mockResolvedValueOnce(back);
    enumerateDevices.mockResolvedValue([
      { kind: 'videoinput', deviceId: 'f', label: 'front' },
      { kind: 'videoinput', deviceId: 'b', label: 'back' },
    ]);

    renderCamera();

    const flip = await screen.findByRole('button', { name: 'สลับเป็นกล้องหลัง' });

    expect(getUserMedia.mock.calls[0]?.[0].video.facingMode).toEqual({ ideal: 'user' });

    await userEvent.click(flip);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(getUserMedia.mock.calls[1]?.[0].video.facingMode).toEqual({ ideal: 'environment' });
    expect(front.track.stop).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'สลับเป็นกล้องหน้า' })).toBeInTheDocument();
  });

  it('กล้องเดียวไม่มีปุ่มสลับ · เลือกฟิลเตอร์แล้วพรีวิวได้ CSS filter ทันที', async () => {
    getUserMedia.mockResolvedValue(fakeStream());
    enumerateDevices.mockResolvedValue([{ kind: 'videoinput', deviceId: 'a', label: 'HD Webcam' }]);

    renderCamera();

    await screen.findByRole('button', { name: 'ถ่ายภาพ' });
    await waitFor(() => expect(enumerateDevices).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /สลับเป็นกล้อง/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'ขาวดำ' }));

    expect(screen.getByRole('radio', { name: 'ขาวดำ' })).toBeChecked();
    expect(screen.getByLabelText('ภาพจากกล้อง').style.filter).toContain('grayscale(1)');
  });

  it('ไม่ได้อนุญาตกล้อง → บอกวิธีแก้และมีปุ่มเลือกรูปจากคลัง', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));

    renderCamera();

    expect(await screen.findByText(/ยังไม่ได้อนุญาตให้ใช้กล้อง/)).toBeInTheDocument();
    // ปุ่มในข้อความแจ้ง + ปุ่มคลังรูปที่แถบล่าง
    expect(screen.getAllByRole('button', { name: 'เลือกรูปจากคลัง' })).toHaveLength(2);
  });
});

describe('CameraSwipe', () => {
  function swipe(target: Element, dx: number) {
    fireEvent.touchStart(target, { touches: [{ clientX: 20, clientY: 300 }] });
    fireEvent.touchMove(target, { touches: [{ clientX: 20 + dx / 2, clientY: 302 }] });
    fireEvent.touchMove(target, { touches: [{ clientX: 20 + dx, clientY: 304 }] });
    fireEvent.touchEnd(target, { touches: [] });
  }

  it('ปัดขวาเกินระยะ = เปิดกล้อง · ปัดสั้นหรือเริ่มในช่องพิมพ์ = ไม่เปิด', () => {
    const onOpen = vi.fn();

    render(
      <CameraSwipe onOpen={onOpen}>
        <p>ฟีด</p>
        <input aria-label="ช่องพิมพ์" />
      </CameraSwipe>,
    );

    swipe(screen.getByText('ฟีด'), 40);
    expect(onOpen).not.toHaveBeenCalled();

    swipe(screen.getByLabelText('ช่องพิมพ์'), 200);
    expect(onOpen).not.toHaveBeenCalled();

    swipe(screen.getByText('ฟีด'), 200);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
