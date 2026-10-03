import { api } from '@/lib/csmju/api';

/// คะแนนคุณภาพสายหลังวางสาย — แบบ Instagram
///
/// ถามเฉพาะสายที่ **ต่อติดจริง** และคุยกันนานพอจะตัดสินได้ สายที่อีกฝ่าย
/// ไม่รับ หรือกดโทรผิดแล้ววางทันที ถ้าถามด้วยจะได้คะแนนที่ไม่ได้วัดอะไรเลย
/// และผู้ใช้จะเริ่มกด "ไม่ใช่ตอนนี้" ทิ้งทุกครั้งจนหมดความหมาย

export type CallKind = 'AUDIO' | 'VIDEO';

export const MIN_RATED_CALL_SEC = 5;

export interface CallFeedbackBody {
  channelId: string;
  /// 1–5
  rating: number;
  durationSec?: number;
  kind: CallKind;
}

/// ระยะเวลาที่คุยกันจริง (วินาที) นับจากตอนต่อสายติด ไม่ใช่ตอนกดโทร
///
/// ไม่เคยต่อติด = null ไม่ใช่ 0 — สองอย่างนี้ต่างกัน: 0 คือ "ติดแล้ววางทันที"
export function talkSeconds(
  connectedAt: number | null,
  endedAt: number,
): number | null {
  if (connectedAt === null) return null;

  return Math.max(0, Math.round((endedAt - connectedAt) / 1000));
}

export function shouldAskRating(
  connectedAt: number | null,
  endedAt: number,
): boolean {
  const seconds = talkSeconds(connectedAt, endedAt);

  return seconds !== null && seconds >= MIN_RATED_CALL_SEC;
}

export function feedbackBody(input: {
  channelId: string;
  rating: number;
  connectedAt: number | null;
  endedAt: number;
  kind: CallKind;
}): CallFeedbackBody {
  const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
  const seconds = talkSeconds(input.connectedAt, input.endedAt);

  return {
    channelId: input.channelId,
    rating,
    ...(seconds === null ? {} : { durationSec: seconds }),
    kind: input.kind,
  };
}

export function sendCallFeedback(body: CallFeedbackBody): Promise<unknown> {
  return api.post('/calls/feedback', body);
}
