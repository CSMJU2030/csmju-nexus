import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, qs } from './api';

/// เทสต์ของชั้นเรียก API
///
/// ชั้นนี้เป็นจุดเดียวที่หน้าบ้านคุยกับข้อมูล ทุกหน้าจอพึ่งพฤติกรรมของมัน
/// ถ้าการแกะ envelope หรือการแปลง error เพี้ยน จะพังพร้อมกันทั้งแอป
/// โดยที่แต่ละหน้าจอดูเหมือนไม่มีอะไรผิด

/// สร้าง fetch ปลอมที่คืน envelope ตามที่ระบุ
///
/// ไม่ใช้ `Partial<Response>` เป็นชนิดพารามิเตอร์ เพราะ `json` ของ Response
/// เป็นเมธอด ไม่ใช่ข้อมูล — ประกาศชนิดของเราเองให้ตรงกับที่ใช้จริง
interface FakeResponse {
  ok?: boolean;
  status?: number;
  json?: unknown;
}

function mockFetch({ ok = true, status = 200, json }: FakeResponse) {
  const body = json === undefined ? '' : JSON.stringify(json);

  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => body,
  } as Response);
}

describe('qs', () => {
  it('ตัด undefined และสตริงว่างออก', () => {
    // ValidationPipe ของหลังบ้านตั้ง forbidNonWhitelisted ไว้
    // ถ้าส่ง ?courseTag=undefined ไปจะได้ 400 ไม่ใช่ถูกมองข้าม
    expect(qs({ a: 1, b: undefined, c: '', d: 'x' })).toBe('?a=1&d=x');
  });

  it('ไม่มี key ที่ใช้ได้เลย = ไม่มี query string', () => {
    expect(qs({ a: undefined, b: '' })).toBe('');
  });

  it('เข้ารหัสอักขระพิเศษให้', () => {
    expect(qs({ emoji: '👍' })).toContain('emoji=%F0%9F%91%8D');
  });
});

describe('api', () => {
  const original = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = original;
  });

  it('แกะ data ออกจาก envelope', async () => {
    globalThis.fetch = mockFetch({
      json: { success: true, data: { id: 'p1', title: 'สวัสดี' } },
    });

    await expect(api.get('/posts/p1')).resolves.toEqual({
      id: 'p1',
      title: 'สวัสดี',
    });
  });

  it('list คืนทั้ง items และ meta', async () => {
    globalThis.fetch = mockFetch({
      json: {
        success: true,
        data: [{ id: 'a' }, { id: 'b' }],
        meta: {
          page: 2,
          limit: 20,
          totalPages: 5,
          total: 91,
        },
      },
    });

    const page = await api.list('/posts');

    expect(page.items).toHaveLength(2);
    expect(page.meta.total).toBe(91);
  });

  it('list ที่ไม่มี meta ยังใช้ได้ (endpoint ที่คืนอาเรย์เปล่า ๆ)', async () => {
    globalThis.fetch = mockFetch({
      json: { success: true, data: [{ id: 'a' }] },
    });

    const page = await api.list('/profiles');

    expect(page.items).toHaveLength(1);
    expect(page.meta.total).toBe(1);
  });

  it('204 No Content ไม่พยายาม parse body', async () => {
    globalThis.fetch = mockFetch({ status: 204 });

    await expect(api.del('/bookmarks')).resolves.toBeUndefined();
  });

  it('แปลง error ของหลังบ้านเป็น ApiError พร้อมข้อความเดิม', async () => {
    globalThis.fetch = mockFetch({
      ok: false,
      status: 409,
      json: {
        success: false,
        error: { code: 'conflict', message: 'ห้องเต็มแล้ว (8/8 คน)' },
      },
    });

    // ข้อความจากหลังบ้านต้องถึงผู้ใช้แบบไม่แปลใหม่ ไม่งั้นมันจะเพี้ยน
    // จากของจริงทันทีที่กฎหลังบ้านเปลี่ยน
    await expect(api.post('/voice-sessions')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'conflict',
      message: 'ห้องเต็มแล้ว (8/8 คน)',
    });
  });

  it('success: false ที่มาพร้อม HTTP 200 ก็ต้องถือว่าพลาด', async () => {
    globalThis.fetch = mockFetch({
      ok: true,
      status: 200,
      json: {
        success: false,
        error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์' },
      },
    });

    await expect(api.get('/audit-logs')).rejects.toBeInstanceOf(ApiError);
  });

  it('ตอบไม่ใช่ JSON = บอกว่าหลังบ้านตอบผิดรูป', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>Internal Server Error</html>',
    } as Response);

    await expect(api.get('/posts')).rejects.toMatchObject({
      code: 'bad_response',
    });
  });

  it('เชื่อมต่อไม่ได้ = ข้อความบอกวิธีแก้ ไม่ใช่ "Failed to fetch"', async () => {
    // fetch โยน TypeError เหมือนกันหมดทั้งกรณีเซิร์ฟเวอร์ไม่ได้รัน เน็ตหลุด
    // และถูก CORS บล็อก — ข้อความดิบนั้นไม่ช่วยอะไรใครเลย
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));

    const error: unknown = await api.get('/posts').catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);

    const apiError = error as ApiError;

    expect(apiError.code).toBe('network_error');
    expect(apiError.message).toContain('start:dev');
    expect(apiError.message).not.toContain('Failed to fetch');
  });

  it('ส่งคุกกี้ไปด้วยทุกคำขอ และไม่แนบ header ตัวตนเอง', async () => {
    const spy = mockFetch({ json: { success: true, data: null } });

    globalThis.fetch = spy;

    await api.get('/posts');

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];

    // same-origin — หน้าบ้าน rewrite /api/* ไปหลังบ้าน (connect-core-hub.md ข้อ 1)
    expect(url).toBe('/api/v1/posts');
    const headers = init.headers as Record<string, string>;

    // token อยู่ในคุกกี้ httpOnly ที่ JavaScript อ่านไม่ได้ — ไม่ใส่บรรทัดนี้
    // เบราว์เซอร์จะไม่ส่งคุกกี้ข้ามพอร์ตให้ แล้วทุกคำขอจะได้ 401
    // ทั้งที่ผู้ใช้ล็อกอินอยู่
    expect(init.credentials).toBe('include');
    expect(headers['content-type']).toBe('application/json');

    // header ตัวตนที่หน้าบ้านเขียนเองต้องไม่มีอีกแล้ว — ถ้ากลับมาเมื่อไหร่
    // แปลว่ามีคนรื้อ API Gateway ที่ไม่มีอยู่จริงกลับเข้ามา
    expect(headers['x-user-id']).toBeUndefined();
    expect(headers['x-core-role']).toBeUndefined();
  });

  it('isUserFixable แยก 4xx ออกจาก 5xx', () => {
    expect(new ApiError(400, 'VALIDATION_ERROR', 'x').isUserFixable).toBe(true);
    expect(new ApiError(403, 'FORBIDDEN', 'x').isUserFixable).toBe(true);
    expect(new ApiError(500, 'internal', 'x').isUserFixable).toBe(false);
    // network_error เป็น status 0 — ไม่ใช่เรื่องที่ผู้ใช้กรอกผิด
    expect(new ApiError(0, 'network_error', 'x').isUserFixable).toBe(false);
  });
});
