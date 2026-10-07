import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { RealtimeBus, type SyncPush } from './realtime-bus.js';
import { RealtimeSyncInterceptor, syncTopicOf } from './sync.interceptor.js';

/// ซิงก์ทั้งเว็บ — เขียนสำเร็จแล้วส่ง `sync:changed` ถูกหัวข้อ ถูกผู้รับ · อ่านหรือเขียนไม่สำเร็จไม่ส่ง

function context(method: string, path: string, coreUserId?: string) {
  const request = { method, path, coreUser: coreUserId ? { coreUserId } : undefined };

  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

async function run(method: string, path: string, coreUserId?: string, fail = false): Promise<SyncPush[]> {
  const bus = new RealtimeBus();
  const pushes: SyncPush[] = [];

  bus.syncEvents.subscribe((push) => pushes.push(push));

  const interceptor = new RealtimeSyncInterceptor(bus);
  const handled = interceptor.intercept(context(method, path, coreUserId), {
    handle: () => (fail ? throwError(() => new Error('boom')) : of({ ok: true })),
  });

  await lastValueFrom(handled).catch(() => undefined);

  return pushes;
}

describe('syncTopicOf', () => {
  it('หมวดสาธารณะ · ส่วนตัว · ไม่ส่ง', () => {
    expect(syncTopicOf('POST', '/api/v1/posts')).toEqual({ topic: 'posts', personal: false });
    expect(syncTopicOf('DELETE', '/api/v1/posts/2b0c6f0e-0000-4000-8000-000000000000/comments/x')).toEqual({ topic: 'posts', personal: false });
    expect(syncTopicOf('PATCH', '/api/v1/subsystem-members/me')).toEqual({ topic: 'profiles', personal: false });
    expect(syncTopicOf('POST', '/api/v1/bookmarks')).toEqual({ topic: 'bookmarks', personal: true });
    expect(syncTopicOf('POST', '/api/v1/direct-channels')).toEqual({ topic: 'inbox', personal: true });
    expect(syncTopicOf('GET', '/api/v1/posts')).toBeNull();
    expect(syncTopicOf('POST', '/api/v1/assets/upload-intents')).toBeNull();
    expect(syncTopicOf('POST', '/api/v1/realtime-tickets')).toBeNull();
  });
});

describe('RealtimeSyncInterceptor', () => {
  it('โพสต์สำเร็จ → ถึงทุกคน · บันทึกโพสต์ → ถึงเฉพาะเครื่องของคนทำ', async () => {
    expect(await run('POST', '/api/v1/posts', 'user-1')).toEqual([{ topic: 'posts', coreUserId: null }]);
    expect(await run('POST', '/api/v1/bookmarks', 'user-1')).toEqual([{ topic: 'bookmarks', coreUserId: 'user-1' }]);
  });

  it('เขียนไม่สำเร็จ หรือแค่อ่าน → ไม่ส่งอะไร', async () => {
    expect(await run('POST', '/api/v1/posts', 'user-1', true)).toEqual([]);
    expect(await run('GET', '/api/v1/posts', 'user-1')).toEqual([]);
  });
});
