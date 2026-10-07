/// อุปกรณ์เสียงและภาพของการโทร — ตรรกะล้วนที่ทดสอบได้โดยไม่ต้องมีเบราว์เซอร์
///
/// **ทำไมแยกออกมา:** รายการจาก `enumerateDevices()` มีกับดักหลายชั้นที่
/// พังแบบเงียบ ๆ ถ้าเขียนปนอยู่ใน component:
///
///   - ก่อนผู้ใช้อนุญาต Chrome คืนอุปกรณ์ที่ `label` ว่างและ `deviceId` ว่าง
///     ถ้าเอาไปใส่ <select> ตรง ๆ จะได้ตัวเลือกว่างเปล่าที่เลือกแล้วใช้ไม่ได้
///   - Chrome ใส่ `default` และ `communications` เป็นรายการ **เสมือน** ที่ชี้ไป
///     อุปกรณ์จริงอีกตัว ถ้านับรวมตอนหาว่ามีอะไรเสียบ/ถอด จะได้แจ้งเตือนซ้ำ
///     สองใบทุกครั้งที่ค่าเริ่มต้นของระบบเปลี่ยน
///   - อุปกรณ์ที่เลือกไว้ถูกถอดออก ต้องมีตัวสำรองที่แน่นอน ไม่ใช่ปล่อยค่าเก่า
///     ค้างไว้แล้ว getUserMedia โยน OverconstrainedError

export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';

export const DEVICE_KINDS: readonly DeviceKind[] = [
  'audioinput',
  'videoinput',
  'audiooutput',
];

export interface DeviceOption {
  deviceId: string;
  kind: DeviceKind;
  label: string;
  groupId: string;
}

export type DeviceMap = Record<DeviceKind, DeviceOption[]>;

/// รูปเท่าที่ต้องใช้จาก `MediaDeviceInfo` — เทสต์สร้างเองได้โดยไม่ต้องมีของจริง
export interface RawDevice {
  deviceId: string;
  kind: string;
  label: string;
  groupId?: string;
}

export type DeviceSelection = Record<DeviceKind, string | null>;

export const EMPTY_SELECTION: DeviceSelection = {
  audioinput: null,
  videoinput: null,
  audiooutput: null,
};

const NOUN: Record<DeviceKind, string> = {
  audioinput: 'ไมโครโฟน',
  videoinput: 'กล้อง',
  audiooutput: 'ลำโพง',
};

/// id เสมือนที่ Chrome ใส่มา — ชี้ไปอุปกรณ์จริงตัวอื่น ไม่ใช่อุปกรณ์ใหม่
const VIRTUAL_IDS = new Set(['default', 'communications']);

function isDeviceKind(kind: string): kind is DeviceKind {
  return (DEVICE_KINDS as readonly string[]).includes(kind);
}

export function emptyDeviceMap(): DeviceMap {
  return { audioinput: [], videoinput: [], audiooutput: [] };
}

/// จัดรายการดิบเป็นกลุ่มตามชนิด พร้อมชื่อที่อ่านได้เสมอ
///
/// `communications` ถูกตัดทิ้ง (Windows เท่านั้น และซ้ำกับตัวจริงเสมอ)
/// ส่วน `default` เก็บไว้ เพราะคือ "ตามค่าของระบบ" ที่ผู้ใช้ส่วนใหญ่ต้องการ
export function groupDevices(devices: readonly RawDevice[]): DeviceMap {
  const map = emptyDeviceMap();

  for (const device of devices) {
    if (!isDeviceKind(device.kind)) continue;
    if (device.deviceId === 'communications') continue;

    const list = map[device.kind];
    const label = device.label.trim()
      ? device.label.replace(/^Default - /, 'ค่าเริ่มต้น - ')
      : `${NOUN[device.kind]} ${list.length + 1}`;

    list.push({
      deviceId: device.deviceId,
      kind: device.kind,
      label,
      groupId: device.groupId ?? '',
    });
  }

  return map;
}

/// ผู้ใช้อนุญาตอุปกรณ์ชนิดนี้แล้วหรือยัง
///
/// เบราว์เซอร์ไม่บอกชื่ออุปกรณ์จนกว่าจะได้สิทธิ์ ชื่อที่ไม่ว่างจึงเป็นหลักฐาน
/// ที่เชื่อถือได้ที่สุดข้ามเบราว์เซอร์ (Permissions API ของ Firefox/Safari
/// ยังถาม "camera" ไม่ได้ทุกรุ่น)
export function permissionGranted(
  devices: readonly RawDevice[],
  kind: DeviceKind,
): boolean {
  return devices.some(
    (device) => device.kind === kind && device.label.trim().length > 0,
  );
}

/// อุปกรณ์ที่จะใช้จริง — ตัวที่เลือกไว้ถ้ายังเสียบอยู่ ไม่งั้นค่าเริ่มต้น
/// ไม่งั้นตัวแรก ไม่มีสักตัวได้ null
export function pickDevice(
  options: readonly DeviceOption[],
  preferredId: string | null,
): string | null {
  const usable = options.filter((option) => option.deviceId !== '');

  if (preferredId && usable.some((option) => option.deviceId === preferredId)) {
    return preferredId;
  }

  return (
    usable.find((option) => option.deviceId === 'default')?.deviceId ??
    usable[0]?.deviceId ??
    null
  );
}

/// กล้องตัวถัดไปสำหรับปุ่ม "สลับกล้องหน้า-หลัง"
///
/// มือถือมีชื่อบอกด้าน (front/back · หน้า/หลัง) → สลับไปด้านตรงข้าม ·
/// ไม่มีชื่อบอกด้าน (เว็บแคมหลายตัว) → วนไปตัวถัดไป · มีกล้องเดียวได้ null
export function nextCamera(options: readonly DeviceOption[], currentId: string | null): string | null {
  const usable = options.filter((option) => option.deviceId !== '' && !VIRTUAL_IDS.has(option.deviceId));

  if (usable.length < 2) return null;

  const side = (label: string): 'front' | 'back' | null =>
    /back|rear|environment|หลัง/i.test(label) ? 'back' : /front|user|facetime|หน้า/i.test(label) ? 'front' : null;
  const index = Math.max(0, usable.findIndex((option) => option.deviceId === currentId));
  const currentSide = side(usable[index]?.label ?? '');

  if (currentSide) {
    const opposite = usable.find((option) => {
      const optionSide = side(option.label);

      return optionSide !== null && optionSide !== currentSide;
    });

    if (opposite) return opposite.deviceId;
  }

  return usable[(index + 1) % usable.length]?.deviceId ?? null;
}

export interface DeviceDiff {
  added: DeviceOption[];
  removed: DeviceOption[];
}

/// อะไรถูกเสียบเพิ่ม อะไรถูกถอดออก ระหว่างสองรอบของ `devicechange`
///
/// ไม่นับรายการเสมือนและรายการที่ยังไม่มี id (ก่อนได้สิทธิ์) — สองแบบนั้น
/// "เปลี่ยน" ได้โดยไม่มีใครเสียบอะไรเลย
///
/// ชนิดที่รอบก่อนยังไม่มี id สักตัว (เพิ่งได้สิทธิ์) ไม่เทียบเลย ไม่งั้นการกด
/// "อนุญาต" ครั้งแรกจะกลายเป็นแจ้งเตือน "เชื่อมต่อแล้ว" ของทุกอุปกรณ์ในเครื่อง
export function diffDevices(previous: DeviceMap, next: DeviceMap): DeviceDiff {
  const comparable = DEVICE_KINDS.filter((kind) =>
    previous[kind].some((device) => device.deviceId !== ''),
  );

  const real = (map: DeviceMap) =>
    comparable.flatMap((kind) => map[kind]).filter(
      (device) => device.deviceId !== '' && !VIRTUAL_IDS.has(device.deviceId),
    );

  const key = (device: DeviceOption) => `${device.kind}:${device.deviceId}`;
  const before = real(previous);
  const after = real(next);
  const beforeKeys = new Set(before.map(key));
  const afterKeys = new Set(after.map(key));

  return {
    added: after.filter((device) => !beforeKeys.has(key(device))),
    removed: before.filter((device) => !afterKeys.has(key(device))),
  };
}

/// ค่าเริ่มต้นของระบบย้ายไปอุปกรณ์อื่นไหม (เช่นเพิ่งเสียบหูฟัง)
///
/// แทร็กที่เปิดไว้ด้วย "ค่าเริ่มต้น" ไม่ย้ายตามเอง — ยังผูกกับอุปกรณ์จริง
/// ตัวเดิม ถ้าไม่ตรวจตรงนี้ ผู้ใช้เสียบหูฟังกลางสายแล้วอีกฝ่ายยังได้ยินจาก
/// ไมค์โน้ตบุ๊กต่อไป ทั้งที่ระบบปฏิบัติการบอกว่าสลับแล้ว
export function defaultMoved(
  previous: DeviceMap,
  next: DeviceMap,
  kind: DeviceKind,
): boolean {
  const before = previous[kind].find((device) => device.deviceId === 'default');
  const after = next[kind].find((device) => device.deviceId === 'default');

  if (!before || !after) return false;

  return before.groupId !== after.groupId || before.label !== after.label;
}

/// ข้อความแจ้งเตือนมุมขวาบนแบบ Instagram
export function deviceNotice(
  change: 'connected' | 'removed',
  kind: DeviceKind,
  label: string,
): string {
  return change === 'connected'
    ? `เชื่อมต่อ${NOUN[kind]}แล้ว: ${label}`
    : `ถอด${NOUN[kind]}แล้ว: ${label}`;
}

export function labelOf(
  options: readonly DeviceOption[],
  deviceId: string | null,
): string | null {
  return options.find((option) => option.deviceId === deviceId)?.label ?? null;
}

/// เลือกลำโพงได้ไหม — Chrome/Edge ได้ · Safari และ Firefox บางรุ่นไม่ได้
///
/// ไม่ได้ = ต้อง **ซ่อน** ตัวเลือก ไม่ใช่แสดงแล้วเลือกไม่มีผล
export function supportsSinkId(): boolean {
  return (
    typeof HTMLMediaElement !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype
  );
}

/// ข้อกำหนดของไมค์ — ระบุอุปกรณ์เฉพาะเมื่อผู้ใช้เลือกตัวที่ไม่ใช่ค่าเริ่มต้น
///
/// ใส่ `exact` กับ `default` ไม่ได้ในบางเบราว์เซอร์ (ไม่มีอุปกรณ์ชื่อนั้นจริง)
/// จึงปล่อยให้เบราว์เซอร์เลือกค่าเริ่มต้นเอง
export function audioConstraints(deviceId: string | null): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    ...(deviceId && !VIRTUAL_IDS.has(deviceId)
      ? { deviceId: { exact: deviceId } }
      : {}),
  };
}

export function videoConstraints(deviceId: string | null): MediaTrackConstraints {
  return {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    ...(deviceId && !VIRTUAL_IDS.has(deviceId)
      ? { deviceId: { exact: deviceId } }
      : {}),
  };
}

const STORAGE_KEY = 'csmju.call.devices';

/// อุปกรณ์ที่เลือกไว้ครั้งก่อน — ความสะดวกเฉพาะเครื่อง อ่านไม่ได้ก็ใช้ค่าเริ่มต้น
export function loadSelection(): DeviceSelection {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<DeviceSelection>) : {};

    return {
      audioinput: typeof parsed.audioinput === 'string' ? parsed.audioinput : null,
      videoinput: typeof parsed.videoinput === 'string' ? parsed.videoinput : null,
      audiooutput:
        typeof parsed.audiooutput === 'string' ? parsed.audiooutput : null,
    };
  } catch {
    return { ...EMPTY_SELECTION };
  }
}

export function saveSelection(selection: DeviceSelection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // โหมดส่วนตัวหรือปิดที่เก็บข้อมูล — ครั้งหน้าก็แค่เริ่มจากค่าเริ่มต้น
  }
}
