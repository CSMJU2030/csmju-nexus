import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRecordVoice, formatDuration, RecordingBar, uploadVoice, VoiceMessage } from './direct-voice';

/// เทสต์ข้อความเสียง
///
/// กฎที่ต้องคงไว้:
///   - อัปโหลดต้องส่ง `contentType: audio/*` ไม่งั้นหลังบ้านนับ webm เป็นวิดีโอ
///   - เบราว์เซอร์ที่ไม่มี MediaRecorder = ไม่มีปุ่มไมค์ (canRecordVoice = false)

const api = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('@/lib/csmju/api', () => ({ api }));
vi.mock('@/lib/csmju/asset-url', () => ({
  useAssetUrl: () => ({ url: null, error: null }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ข้อความเสียง', () => {
  it('formatDuration เป็น นาที:วินาที', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9_400)).toBe('0:09');
    expect(formatDuration(60_000)).toBe('1:00');
  });

  it('jsdom ไม่มี MediaRecorder → อัดไม่ได้', () => {
    expect(canRecordVoice()).toBe(false);
  });

  it('**อัปโหลดส่ง contentType ของเสียงไปด้วย** แล้ว commit', async () => {
    api.post
      .mockResolvedValueOnce({ assetId: 'a-1', uploadUrl: 'https://storage/x', uploadMethod: 'PUT', uploadHeaders: {} })
      .mockResolvedValueOnce({ id: 'a-1', fileName: 'voice.webm', kind: 'AUDIO', mimeType: 'audio/webm', sizeBytes: '5' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const asset = await uploadVoice(new Blob(['12345']), 'voice.webm', 'audio/webm;codecs=opus');

    expect(api.post).toHaveBeenNthCalledWith(1, '/assets/upload-intents', {
      fileName: 'voice.webm',
      sizeBytes: 5,
      bucket: 'attachments',
      contentType: 'audio/webm;codecs=opus',
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/assets/a-1/commit');
    expect(asset).toMatchObject({ assetId: 'a-1', kind: 'AUDIO' });
  });

  it('แถบระหว่างอัดบอกเวลา มีปุ่มยกเลิกและส่ง', () => {
    render(<RecordingBar elapsed={12_000} levels={[0.2, 0.8]} onCancel={() => {}} onSend={() => {}} />);

    expect(screen.getByRole('group', { name: 'กำลังอัดข้อความเสียง' })).toHaveTextContent('0:12');
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ส่ง' })).toBeInTheDocument();
  });

  it('ฟองเสียงมีปุ่มเล่น และแถบความคืบหน้า', () => {
    render(
      <VoiceMessage
        mine
        attachment={{ id: 'a-1', fileName: 'voice.webm', kind: 'AUDIO', mimeType: 'audio/webm', sizeBytes: '5' }}
      />,
    );

    expect(screen.getByRole('button', { name: 'เล่นข้อความเสียง' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'ความคืบหน้าของข้อความเสียง' })).toHaveAttribute('aria-valuenow', '0');
  });
});
