'use client';

/// ตรวจว่าเครือข่ายที่ผู้ใช้อยู่ตอนนี้ โทรด้วยเสียงได้จริงไหม
///
/// **ทำไมต้องมี:** WebRTC ล้มแบบเงียบที่สุดในบรรดาเทคโนโลยีเว็บ ผู้ใช้กดโทร
/// เห็นคำว่า "กำลังเชื่อมต่อ" ค้างอยู่ แล้วก็ไม่มีอะไรเกิดขึ้นอีกเลย ไม่มี
/// error ไม่มีคำอธิบาย ทั้งที่สาเหตุรู้ได้ล่วงหน้าตั้งแต่ก่อนกดโทร
///
/// วิธีตรวจ: เปิด RTCPeerConnection เปล่า ๆ หนึ่งเส้นแล้วดูว่าเบราว์เซอร์
/// หา "เส้นทาง" อะไรได้บ้าง (ICE candidate) โดยไม่ต้องมีคู่สนทนา ไม่ต้องขอไมค์
/// และไม่ส่งอะไรออกไปนอกเครื่องนอกจากคำถามสั้น ๆ ไปที่ STUN
///
/// ความหมายของแต่ละชนิด:
///   host  = เส้นทางในวงแลนตัวเอง — มีเสมอ ไม่ได้บอกอะไรเรื่องอินเทอร์เน็ต
///   srflx = STUN ตอบกลับมาว่าเห็นเราเป็นไอพีอะไร → คุยข้ามอินเทอร์เน็ตได้
///   relay = ต้องวิ่งผ่าน TURN → ใช้ได้ แต่ต้องมี TURN จริงเท่านั้น
///
/// ถ้าได้แต่ host อย่างเดียว แปลว่าไฟร์วอลล์บล็อก UDP ขาออก ซึ่งพบได้จริง
/// ในเน็ตองค์กรและหอพัก — กรณีนั้นต้องมี TURN ที่วิ่งบน TCP/443 ถึงจะรอด

export type ConnectivityVerdict =
  | 'ready'
  | 'needs-turn'
  | 'turn-working'
  | 'blocked'
  | 'unsupported';

export interface ConnectivityReport {
  verdict: ConnectivityVerdict;
  /// ข้อความที่เอาไปแสดงให้ผู้ใช้อ่านได้เลย
  summary: string;
  hasHost: boolean;
  hasServerReflexive: boolean;
  hasRelay: boolean;
  /// TURN ถูกตั้งค่าไว้ไหม (มาจากหลังบ้าน)
  turnConfigured: boolean;
}

interface IceServerLike {
  urls: string[];
  /// **ฟิลด์ของมาตรฐาน WebRTC (`RTCIceServer.username`) ไม่ใช่ตัวตนผู้ใช้**
  /// รหัสที่ใช้ยืนยันกับเซิร์ฟเวอร์ TURN
  username?: string | null;
  credential?: string | null;
}

const GATHER_TIMEOUT_MS = 8000;

function verdictOf(
  hasServerReflexive: boolean,
  hasRelay: boolean,
  turnConfigured: boolean,
): ConnectivityVerdict {
  if (hasRelay) return 'turn-working';
  if (hasServerReflexive) return 'ready';
  if (turnConfigured) return 'blocked';

  return 'needs-turn';
}

const SUMMARY: Record<ConnectivityVerdict, string> = {
  ready:
    'เครือข่ายนี้โทรได้ — เบราว์เซอร์หาเส้นทางออกอินเทอร์เน็ตเจอแล้ว',
  'turn-working':
    'เครือข่ายนี้โทรได้ผ่านเซิร์ฟเวอร์ตัวกลาง (TURN) — เสียงจะวิ่งอ้อม ' +
    'แต่ใช้งานได้ปกติ',
  'needs-turn':
    'เครือข่ายนี้ออกอินเทอร์เน็ตตรง ๆ ไม่ได้ และระบบยังไม่ได้ตั้ง TURN server ' +
    '— การโทรจะไม่ติด ให้ลองเปลี่ยนไปใช้เน็ตอื่น (เช่น แชร์เน็ตจากมือถือ) ' +
    'หรือแจ้งผู้ดูแลให้ตั้ง TURN',
  blocked:
    'ตั้ง TURN ไว้แล้วแต่ยังหาเส้นทางไม่เจอ — อาจถูกไฟร์วอลล์บล็อกอยู่ ' +
    'หรือค่า TURN ที่ตั้งไว้ไม่ถูกต้อง',
  unsupported: 'เบราว์เซอร์นี้ไม่รองรับการโทรด้วยเสียง',
};

/// เก็บ ICE candidate ที่เบราว์เซอร์หาได้ แล้วสรุปว่าโทรได้ไหม
///
/// ไม่ขอสิทธิ์ไมค์ ไม่ต่อหาใคร และหยุดเองเมื่อเก็บครบหรือหมดเวลา
export async function checkConnectivity(
  iceServers: IceServerLike[],
): Promise<ConnectivityReport> {
  const turnConfigured = iceServers.some((server) =>
    server.urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:')),
  );

  if (typeof RTCPeerConnection === 'undefined') {
    return {
      verdict: 'unsupported',
      summary: SUMMARY.unsupported,
      hasHost: false,
      hasServerReflexive: false,
      hasRelay: false,
      turnConfigured,
    };
  }

  // **ชื่อฟิลด์ต้องเป็น `username` เป๊ะ ๆ** ไม่ใช่แค่เรื่องความถูกต้อง:
  // สเปกบังคับว่า URL ที่ขึ้นต้นด้วย turn:/turns: ต้องมาคู่กับ username และ
  // credential ถ้าขาดตัวใดตัวหนึ่ง ตัวสร้าง RTCPeerConnection จะ **โยน
  // InvalidAccessError ทันที** — ซึ่งเป็นอาการที่เกิดขึ้นจริง: ตอนผู้ดูแล
  // ตั้ง TURN ปุ่ม "ตรวจว่าเครือข่ายนี้โทรได้ไหม" พังทันทีโดยไม่บอกสาเหตุ
  const peer = new RTCPeerConnection({
    iceServers: iceServers.map((server) => ({
      urls: server.urls,
      username: server.username ?? undefined,
      credential: server.credential ?? undefined,
    })),
  });

  const found = new Set<string>();

  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);

      const finish = () => {
        clearTimeout(timer);
        resolve();
      };

      peer.onicecandidate = (event) => {
        if (!event.candidate) {
          // candidate เป็น null = เบราว์เซอร์หาครบแล้ว
          finish();

          return;
        }

        const type = event.candidate.type;

        if (type) {
          found.add(type);
        }

        // เจอ relay แล้วก็พอ — แปลว่าเส้นทางที่แน่นอนที่สุดใช้ได้
        if (type === 'relay') {
          finish();
        }
      };

      // ต้องมีอะไรให้เจรจาสักอย่าง ไม่งั้นเบราว์เซอร์ไม่เริ่มหาเส้นทาง
      // ใช้ data channel เพราะไม่ต้องขอสิทธิ์ไมค์หรือกล้องจากผู้ใช้
      peer.createDataChannel('probe');

      void peer
        .createOffer()
        .then((offer) => peer.setLocalDescription(offer))
        .catch(finish);
    });
  } finally {
    peer.onicecandidate = null;
    peer.close();
  }

  const hasHost = found.has('host');
  const hasServerReflexive = found.has('srflx');
  const hasRelay = found.has('relay');
  const verdict = verdictOf(hasServerReflexive, hasRelay, turnConfigured);

  return {
    verdict,
    summary: SUMMARY[verdict],
    hasHost,
    hasServerReflexive,
    hasRelay,
    turnConfigured,
  };
}
