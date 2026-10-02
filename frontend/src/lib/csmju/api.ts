/// ตัวเรียก API ของหลังบ้าน — จุดเดียวที่หน้าบ้านคุยกับข้อมูล
///
/// **หน้าบ้านห้ามต่อฐานข้อมูลเอง** (Blueprint หน้า 13) ทุกอย่างต้องผ่านที่นี่
/// ถ้าเห็น import ของ Prisma หรือ pg ในโฟลเดอร์ src/ ที่ไม่ใช่ backend/
/// นั่นคือการละเมิดข้อห้าม ไม่ใช่ทางลัด
///
/// แกะ envelope ให้ที่ชั้นนี้ชั้นเดียว เพื่อให้หน้าจอเขียน
///   const posts = await api.get<Post[]>('/posts')
/// แทนที่จะต้องจำ `res.data` ทุกครั้ง แล้วลืมเช็ค success ในบางที่


/// **same-origin เสมอ** — หน้าบ้านเป็นประตูเดียวของระบบ (connect-core-hub.md ข้อ 1)
/// `next.config.ts` rewrite `/api/*` ไปที่หลังบ้าน คุกกี้ session ที่
/// `/auth/callback` ตั้งไว้บน origin นี้จึงติดไปกับทุกคำขอโดยไม่ต้องพึ่ง CORS
const BASE_URL = '/api/v1';

export interface PaginationMeta {
  page: number;
  limit: number;
  totalPages: number;
  total: number;
}

export interface Page<T> {
  items: T[];
  meta: PaginationMeta;
}

/// ข้อผิดพลาดที่ยังถือ code กับข้อความจากหลังบ้านไว้
///
/// หลังบ้านตอบ message เป็นภาษาไทยที่อ่านรู้เรื่องอยู่แล้ว (เช่น
/// "ห้องเต็มแล้ว (8/8 คน)") จึงเอาไปแสดงตรง ๆ ได้ ไม่ต้องแปลใหม่ที่หน้าบ้าน
/// — และไม่ควรแปลใหม่ เพราะข้อความจะเพี้ยนจากของจริงทันทีที่กฎหลังบ้านเปลี่ยน
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /// true เมื่อเป็นเรื่องที่ผู้ใช้แก้เองได้ (กรอกผิด สิทธิ์ไม่พอ ของเต็ม)
  /// ต่างจาก 500 ที่เป็นความผิดของเรา และต้องขึ้นข้อความคนละแบบ
  get isUserFixable(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  meta?: PaginationMeta;
  error?: { code: string; message: string; details?: string[] };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; meta?: PaginationMeta }> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },

      // **ตัวตนอยู่ในคุกกี้ ไม่ใช่ใน header ที่หน้าบ้านเขียนเอง**
      //
      // `csmju_nexus_access_token` เป็นคุกกี้ HttpOnly ที่ /auth/callback
      // ตั้งไว้ — JavaScript ในหน้านี้อ่านไม่ได้ ต้องให้เบราว์เซอร์แนบให้เอง
      // (same-origin แนบให้อยู่แล้ว ใส่ไว้เผื่อทดสอบข้าม origin)
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch โยน TypeError ว่า "Failed to fetch" ทั้งกรณีเซิร์ฟเวอร์ไม่ได้รัน
    // กรณีเน็ตหลุด และกรณีถูก CORS บล็อก — เบราว์เซอร์ตั้งใจไม่บอกว่าอันไหน
    // เพื่อไม่ให้หน้าเว็บสำรวจเครือข่ายของผู้ใช้ได้
    //
    // ข้อความดิบนั้นไม่ช่วยอะไรใครเลย จึงแปลงเป็นคำแนะนำที่ทำตามได้จริง
    throw new ApiError(
      0,
      'network_error',
      'ติดต่อหลังบ้านไม่ได้ — ตรวจว่าเน็ตยังต่ออยู่ และหลังบ้านรันอยู่ ' +
        '(pnpm --filter backend start:dev) กับฐานข้อมูลขึ้นแล้ว (pnpm --filter backend db:up)',
    );
  }

  // 204 No Content ไม่มี body ให้ parse
  if (response.status === 204) {
    return { data: undefined as T };
  }

  const text = await response.text();
  let payload: Envelope<T>;

  try {
    payload = JSON.parse(text) as Envelope<T>;
  } catch {
    // เจอกรณีนี้ตอนหลังบ้านไม่ได้รัน แล้ว fetch ได้หน้า error ของ dev server
    throw new ApiError(
      response.status,
      'bad_response',
      `หลังบ้านตอบไม่ใช่ JSON (HTTP ${response.status}) — เซิร์ฟเวอร์รันอยู่ไหม`,
    );
  }

  if (!response.ok || payload.success === false) {
    // 401 กลางทาง = token หมดอายุ (อายุ 15 นาทีตาม auth-contract.md ข้อ 7)
    //
    // แจ้งจุดเดียว แล้ว `SessionProvider` พาทั้งหน้าไป /auth/login?next=…
    // (silent re-SSO) — ไม่ให้แต่ละหน้าจัดการเองหรือโชว์ข้อความดิบ
    if (response.status === 401) {
      notifyUnauthorized();
    }

    throw new ApiError(
      response.status,
      payload.error?.code ?? 'unknown',
      payload.error?.message ?? `คำขอไม่สำเร็จ (HTTP ${response.status})`,
      payload.error?.details ?? [],
    );
  }

  return { data: payload.data as T, meta: payload.meta };
}

export const api = {
  async get<T>(path: string): Promise<T> {
    return (await request<T>('GET', path)).data;
  },

  /// สำหรับ endpoint แบบ list — คืนทั้งรายการและ meta ของการแบ่งหน้า
  async list<T>(path: string): Promise<Page<T>> {
    const { data, meta } = await request<T[]>('GET', path);

    return {
      items: data ?? [],
      // endpoint ที่ไม่ได้แบ่งหน้าไม่ส่ง meta มา — ประกอบให้เองเพื่อให้
      // หน้าบ้านอ่านรูปเดียวกันได้หมด ไม่ต้องเช็ค undefined ทุกที่
      //
      // ไม่มีข้อมูล = 0 หน้า ตรงกับที่หลังบ้านคิด (api-conventions.md ข้อ 5)
      meta: meta ?? {
        total: data?.length ?? 0,
        page: 1,
        limit: data?.length ?? 0,
        totalPages: data?.length ? 1 : 0,
      },
    };
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>('POST', path, body)).data;
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>('PATCH', path, body)).data;
  },

  async put<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>('PUT', path, body)).data;
  },

  async del<T>(path: string): Promise<T> {
    return (await request<T>('DELETE', path)).data;
  },
};

/// ต่อ query string โดยตัด key ที่เป็น undefined ออก
///
/// จำเป็นเพราะ ValidationPipe ของหลังบ้านตั้ง forbidNonWhitelisted ไว้
/// ถ้าส่ง `?courseTag=undefined` ไปจะได้ 400 ไม่ใช่ถูกมองข้าม
export function qs(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }

  const query = search.toString();

  return query ? `?${query}` : '';
}

/// ────────────────────────────────────────────────────────────────
/// แจ้งว่า session หมดอายุ
///
/// `api.ts` ไม่รู้จัก React และไม่ควรรู้ — มันแค่ประกาศว่า "เกิด 401"
/// แล้วให้ `SessionProvider` เป็นคนตัดสินใจว่าจะพาผู้ใช้ไปไหนต่อ
///
/// ใช้ตัวแปรระดับโมดูลตัวเดียว ไม่ใช่ event emitter เพราะมีผู้ฟังได้แค่
/// คนเดียวอยู่แล้ว (provider ตัวเดียวครอบทั้งแอป) และการมีหลายคนฟังจะทำให้
/// เกิดการพาไป SSO ซ้อนกันหลายรอบ
/// ────────────────────────────────────────────────────────────────
type UnauthorizedHandler = () => void;

let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

function notifyUnauthorized() {
  onUnauthorized?.();
}
