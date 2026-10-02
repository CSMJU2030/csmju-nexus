'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck, ShieldAlert, Wifi } from 'lucide-react';
import { api, ApiError } from '@/lib/csmju/api';
import {
  checkConnectivity,
  type ConnectivityReport,
} from '@/lib/csmju/connectivity';

/// ปุ่ม "ตรวจว่าเครือข่ายนี้โทรได้ไหม"
///
/// มีเพราะ WebRTC ล้มแบบเงียบที่สุด — ผู้ใช้กดโทร เห็น "กำลังเชื่อมต่อ" ค้าง
/// แล้วไม่มีอะไรเกิดขึ้นอีกเลย ทั้งที่สาเหตุรู้ได้ตั้งแต่ก่อนกดโทร
///
/// ปุ่มนี้ตอบคำถามนั้นล่วงหน้าใน 8 วินาที โดยไม่ต้องขอไมค์และไม่ต้องมีคู่สาย

interface IceServer {
  urls: string[];
  coreUserId?: string | null;
  credential?: string | null;
}

const TONE: Record<
  ConnectivityReport['verdict'],
  { border: string; text: string; ok: boolean }
> = {
  ready: { border: 'border-success/40 bg-success/5', text: 'text-success', ok: true },
  'turn-working': {
    border: 'border-success/40 bg-success/5',
    text: 'text-success',
    ok: true,
  },
  'needs-turn': {
    border: 'border-warning/40 bg-warning/5',
    text: 'text-warning',
    ok: false,
  },
  blocked: {
    border: 'border-destructive/40 bg-destructive/5',
    text: 'text-destructive',
    ok: false,
  },
  unsupported: {
    border: 'border-destructive/40 bg-destructive/5',
    text: 'text-destructive',
    ok: false,
  },
};

export function ConnectivityCheck() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ConnectivityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setReport(null);

    try {
      // ขอรายการเซิร์ฟเวอร์ชุดเดียวกับที่การโทรจริงใช้ ไม่ใช่ชุดที่ hardcode ไว้
      // ไม่งั้นผลตรวจจะไม่ตรงกับของจริงเมื่อผู้ดูแลเปลี่ยนค่า TURN
      const servers = await api.get<IceServer[]>('/voice-sessions/ice-servers');

      setReport(await checkConnectivity(servers));
    } catch (caught) {
      // **เครื่องมือวินิจฉัยต้องบอกสาเหตุ ไม่ใช่บอกว่า "ไม่สำเร็จ"**
      //
      // ปุ่มนี้มีไว้ให้คนหาสาเหตุที่โทรไม่ติด ถ้ามันตอบแค่ "ลองใหม่อีกครั้ง"
      // มันก็ไร้ประโยชน์พอ ๆ กับอาการที่มันควรจะช่วยอธิบาย
      //
      // เคสที่เจอจริง: ผู้ดูแลตั้ง TURN แต่ตั้ง username ไม่ครบ ตัวสร้าง
      // RTCPeerConnection โยน InvalidAccessError ทันที — ข้อความนั้นคือ
      // คำตอบที่ผู้ดูแลต้องการ แต่เดิมถูกกลืนหายไป
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? `ตรวจไม่สำเร็จ: ${caught.message}`
            : 'ตรวจไม่สำเร็จ — ลองใหม่อีกครั้ง',
      );
    } finally {
      setBusy(false);
    }
  }

  const tone = report ? TONE[report.verdict] : null;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Wifi className="size-4" />
        )}
        {busy ? 'กำลังตรวจเครือข่าย…' : 'ตรวจว่าเครือข่ายนี้โทรได้ไหม'}
      </button>

      {error && (
        <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {report && tone && (
        <div
          // role=status ให้โปรแกรมอ่านหน้าจออ่านผลทันทีที่ตรวจเสร็จ
          // โดยไม่ต้องให้ผู้ใช้ไปหาเอง
          role="status"
          className={`mt-2 rounded-lg border px-3 py-2 text-sm ${tone.border}`}
        >
          <p className={`flex items-start gap-2 font-medium ${tone.text}`}>
            {tone.ok ? (
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            ) : (
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            )}
            {report.summary}
          </p>

          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            <li>
              เส้นทางในวงแลน: {report.hasHost ? 'เจอ' : 'ไม่เจอ'}
            </li>
            <li>
              เส้นทางออกอินเทอร์เน็ต (STUN):{' '}
              {report.hasServerReflexive ? 'เจอ' : 'ไม่เจอ'}
            </li>
            <li>
              เส้นทางผ่านตัวกลาง (TURN):{' '}
              {report.hasRelay
                ? 'ใช้ได้'
                : report.turnConfigured
                  ? 'ตั้งไว้แล้วแต่ใช้ไม่ได้'
                  : 'ยังไม่ได้ตั้ง'}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
