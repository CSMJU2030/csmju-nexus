/// แกะ @coreUserId ออกจากข้อความ
///
/// coreUserId ของ CSMJU2030 เป็นรูป "6700001382-somsak" จึงต้องยอมทั้งเลข
/// ขีดกลาง จุด และขีดล่าง — ถ้าใช้ \w เฉย ๆ จะตัดที่ขีดกลางแล้วได้
/// "@6700001382" ซึ่งไม่ตรงกับใครเลย
const MENTION_PATTERN = /@([A-Za-z0-9][A-Za-z0-9._-]{1,63})/g;

/// เพดานการแจ้งเตือนต่อหนึ่งข้อความ
///
/// ถ้าไม่จำกัด คนหนึ่งพิมพ์ @ ห้าร้อยชื่อในข้อความเดียวได้ กลายเป็นเครื่องมือ
/// สแปมที่กระจายด้วยงบของเราเอง — จำกัดที่นี่ ไม่ใช่ที่ UI เพราะ UI เลี่ยงได้
export const MAX_MENTIONS_PER_MESSAGE = 10;

/// คำที่หมายถึง "ทุกคนในห้อง" — สงวนไว้ให้ผู้ดูแลห้องเท่านั้น
export const BROADCAST_MENTIONS = new Set(['everyone', 'channel', 'here']);

export interface ParsedMentions {
  /// ชื่อผู้ใช้ที่ถูกเรียก ตัดชื่อซ้ำและตัดตัวเองออกแล้ว
  coreUserIds: string[];
  /// true เมื่อข้อความมี @everyone / @channel / @here
  broadcast: boolean;
  /// จำนวนที่เกินเพดานแล้วถูกตัดทิ้ง ใช้บอกผู้ส่งได้ว่าไม่ได้แจ้งครบ
  truncated: number;
}

export function parseMentions(
  content: string | null | undefined,
  selfCoreUserId: string,
): ParsedMentions {
  if (!content) {
    return { coreUserIds: [], broadcast: false, truncated: 0 };
  }

  const found = new Set<string>();
  let broadcast = false;

  for (const match of content.matchAll(MENTION_PATTERN)) {
    const name = match[1];

    if (BROADCAST_MENTIONS.has(name.toLowerCase())) {
      broadcast = true;
      continue;
    }

    // ไม่แจ้งเตือนตัวเอง — คนพิมพ์รู้อยู่แล้วว่าตัวเองพิมพ์อะไร
    if (name !== selfCoreUserId) {
      found.add(name);
    }
  }

  const all = [...found];

  return {
    coreUserIds: all.slice(0, MAX_MENTIONS_PER_MESSAGE),
    broadcast,
    truncated: Math.max(0, all.length - MAX_MENTIONS_PER_MESSAGE),
  };
}
