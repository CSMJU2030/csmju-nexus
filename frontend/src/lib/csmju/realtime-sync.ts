/// ซิงก์ทั้งเว็บแบบสด — แปลงสัญญาณ `sync:changed` ของหลังบ้านเป็นคีย์แคช react-query ที่ต้องดึงใหม่
///
/// หลังบ้านส่งแค่ "หัวข้อไหนเปลี่ยน" (backend/src/common/realtime/sync.interceptor.ts) ไม่ส่งเนื้อหา
/// หน้าเว็บจึงดึงผ่าน REST ที่ตรวจสิทธิ์ตามปกติ · ดึงใหม่เฉพาะคิวรีที่จอเปิดใช้อยู่ ที่เหลือแค่ทำเครื่องหมายว่าเก่า

export type SyncTopic =
  | 'posts'
  | 'reels'
  | 'stories'
  | 'highlights'
  | 'follows'
  | 'notes'
  | 'profiles'
  | 'reactions'
  | 'meetings'
  | 'inbox'
  | 'bookmarks'
  | 'notifications'
  | 'blocks'
  | 'close-friends';

/// รากของคีย์แคช (ตัวแรกของ queryKey) ที่หัวข้อนั้นกระทบ — ลงท้ายด้วย * = ขึ้นต้นด้วย
export const TOPIC_KEYS: Record<SyncTopic, readonly string[]> = {
  posts: ['feed', 'post', 'post-saved', 'profile-grid', 'activity-*', 'feed-sidebar'],
  reels: ['reels-feed', 'reel', 'reel-comments', 'reel-comment-replies', 'explore-reels', 'profile-grid', 'activity-*'],
  stories: ['stories', 'story-viewers', 'story-viewers-all', 'story-insights', 'highlights', 'highlight'],
  highlights: ['highlights', 'highlight'],
  follows: [
    'follows',
    'following',
    'follow-list',
    'relation',
    'profile',
    'profile-summaries',
    'suggestions-all',
    'feed-sidebar',
    'my-following',
    'my-following-first',
    'feed',
    'stories',
  ],
  notes: ['notes'],
  profiles: ['profile', 'profiles', 'profile-summaries', 'profile-about'],
  reactions: ['feed', 'post', 'reels-feed', 'reel', 'reel-comments', 'reel-comment-replies', 'activity-*'],
  meetings: ['meetings'],
  inbox: ['channels', 'channel-members'],
  bookmarks: ['bookmarks', 'bookmarks-all', 'bookmark-collection-items', 'post-saved', 'reel-bookmarks'],
  notifications: ['notifications'],
  blocks: ['blocks', 'relation', 'profile', 'feed', 'stories'],
  'close-friends': ['close-friends', 'close-friends-candidates', 'stories'],
};

/// คีย์แคชนี้ต้องดึงใหม่ไหม เมื่อหัวข้อในชุดนี้เปลี่ยน
export function keyMatches(queryKey: readonly unknown[], topics: ReadonlySet<SyncTopic>): boolean {
  const root = queryKey[0];

  if (typeof root !== 'string') return false;

  for (const topic of topics) {
    for (const pattern of TOPIC_KEYS[topic] ?? []) {
      if (pattern.endsWith('*') ? root.startsWith(pattern.slice(0, -1)) : root === pattern) return true;
    }
  }

  return false;
}

export function isSyncTopic(value: unknown): value is SyncTopic {
  return typeof value === 'string' && value in TOPIC_KEYS;
}
