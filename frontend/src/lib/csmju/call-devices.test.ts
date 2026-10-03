import { describe, expect, it } from 'vitest';
import {
  audioConstraints,
  defaultMoved,
  deviceNotice,
  diffDevices,
  groupDevices,
  permissionGranted,
  pickDevice,
  videoConstraints,
  type RawDevice,
} from './call-devices';

/// ตรรกะเลือกอุปกรณ์ของการโทร — กับดักของ enumerateDevices ทั้งหมดอยู่ที่นี่

const before: RawDevice[] = [
  { deviceId: 'default', kind: 'audioinput', label: 'Default - Laptop Mic', groupId: 'g-laptop' },
  { deviceId: 'communications', kind: 'audioinput', label: 'Communications - Laptop Mic', groupId: 'g-laptop' },
  { deviceId: 'mic-laptop', kind: 'audioinput', label: 'Laptop Mic', groupId: 'g-laptop' },
  { deviceId: 'cam-1', kind: 'videoinput', label: 'HD Webcam', groupId: 'g-cam' },
  { deviceId: 'default', kind: 'audiooutput', label: 'Default - Speakers', groupId: 'g-spk' },
  { deviceId: 'spk-1', kind: 'audiooutput', label: 'Speakers', groupId: 'g-spk' },
];

describe('groupDevices', () => {
  it('แยกตามชนิด ตัด communications ทิ้ง และแปลคำว่า Default', () => {
    const map = groupDevices(before);

    expect(map.audioinput.map((device) => device.deviceId)).toEqual(['default', 'mic-laptop']);
    expect(map.audioinput[0].label).toBe('ค่าเริ่มต้น - Laptop Mic');
    expect(map.videoinput).toHaveLength(1);
    expect(map.audiooutput).toHaveLength(2);
  });

  it('ก่อนได้สิทธิ์ (ชื่อว่าง) ตั้งชื่อให้อ่านได้ ไม่ใช่ตัวเลือกว่างเปล่า', () => {
    const map = groupDevices([
      { deviceId: '', kind: 'videoinput', label: '' },
      { deviceId: '', kind: 'videoinput', label: '' },
    ]);

    expect(map.videoinput.map((device) => device.label)).toEqual(['กล้อง 1', 'กล้อง 2']);
  });

  it('ไม่สนชนิดที่ไม่รู้จัก', () => {
    expect(groupDevices([{ deviceId: 'x', kind: 'midi', label: 'Keys' }]).audioinput).toEqual([]);
  });
});

describe('permissionGranted', () => {
  it('ชื่อว่าง = ยังไม่ได้สิทธิ์ · มีชื่อ = ได้แล้ว', () => {
    expect(permissionGranted([{ deviceId: '', kind: 'videoinput', label: '' }], 'videoinput')).toBe(false);
    expect(permissionGranted(before, 'videoinput')).toBe(true);
    expect(permissionGranted(before.filter((d) => d.kind !== 'videoinput'), 'videoinput')).toBe(false);
  });
});

describe('pickDevice', () => {
  const options = groupDevices(before).audioinput;

  it('ใช้ตัวที่เลือกไว้ถ้ายังเสียบอยู่', () => {
    expect(pickDevice(options, 'mic-laptop')).toBe('mic-laptop');
  });

  it('ตัวที่เลือกถูกถอดไปแล้ว → ถอยไปค่าเริ่มต้น', () => {
    expect(pickDevice(options, 'mic-headset-ถอดแล้ว')).toBe('default');
  });

  it('ไม่มีค่าเริ่มต้น → ตัวแรก · ไม่มีอะไรเลย → null', () => {
    expect(pickDevice(options.filter((o) => o.deviceId !== 'default'), null)).toBe('mic-laptop');
    expect(pickDevice([], 'อะไรก็ได้')).toBeNull();
  });

  it('ไม่เลือกรายการที่ยังไม่มี id (ก่อนได้สิทธิ์)', () => {
    expect(pickDevice(groupDevices([{ deviceId: '', kind: 'audioinput', label: '' }]).audioinput, null)).toBeNull();
  });
});

describe('diffDevices', () => {
  it('เสียบหูฟังเพิ่ม = ได้ "เชื่อมต่อแล้ว" ใบเดียว ไม่ซ้ำเพราะ default เปลี่ยน', () => {
    const after = [
      ...before.map((d) =>
        d.deviceId === 'default' && d.kind === 'audioinput'
          ? { ...d, label: 'Default - Headset', groupId: 'g-headset' }
          : d,
      ),
      { deviceId: 'mic-headset', kind: 'audioinput', label: 'Headset', groupId: 'g-headset' },
    ];

    const diff = diffDevices(groupDevices(before), groupDevices(after));

    expect(diff.added.map((d) => d.deviceId)).toEqual(['mic-headset']);
    expect(diff.removed).toEqual([]);
  });

  it('ถอดกล้องออก = ได้ "ถอดแล้ว"', () => {
    const diff = diffDevices(
      groupDevices(before),
      groupDevices(before.filter((d) => d.deviceId !== 'cam-1')),
    );

    expect(diff.removed.map((d) => d.deviceId)).toEqual(['cam-1']);
    expect(deviceNotice('removed', 'videoinput', diff.removed[0].label)).toBe('ถอดกล้องแล้ว: HD Webcam');
  });

  it('เพิ่งกดอนุญาต (รอบก่อนไม่มี id) ไม่นับว่าเสียบอุปกรณ์ใหม่ทั้งเครื่อง', () => {
    const locked = groupDevices([
      { deviceId: '', kind: 'audioinput', label: '' },
      { deviceId: '', kind: 'videoinput', label: '' },
    ]);

    expect(diffDevices(locked, groupDevices(before)).added).toEqual([]);
  });
});

describe('defaultMoved', () => {
  it('ค่าเริ่มต้นย้ายไปอุปกรณ์อื่น = true · ไม่ย้าย = false', () => {
    const moved = before.map((d) =>
      d.deviceId === 'default' && d.kind === 'audioinput'
        ? { ...d, label: 'Default - Headset', groupId: 'g-headset' }
        : d,
    );

    expect(defaultMoved(groupDevices(before), groupDevices(moved), 'audioinput')).toBe(true);
    expect(defaultMoved(groupDevices(before), groupDevices(before), 'audioinput')).toBe(false);
  });
});

describe('ข้อกำหนดของ getUserMedia', () => {
  it('ระบุอุปกรณ์แบบ exact เฉพาะตัวจริง ไม่ใช่ default', () => {
    expect(audioConstraints('mic-laptop')).toMatchObject({ deviceId: { exact: 'mic-laptop' } });
    expect(audioConstraints('default')).not.toHaveProperty('deviceId');
    expect(audioConstraints(null)).toMatchObject({ echoCancellation: true });
    expect(videoConstraints('cam-1')).toMatchObject({ deviceId: { exact: 'cam-1' } });
  });

  it('ข้อความแจ้งเตือนตรงกับ Instagram', () => {
    expect(deviceNotice('connected', 'audioinput', 'Laptop Mic')).toBe('เชื่อมต่อไมโครโฟนแล้ว: Laptop Mic');
    expect(deviceNotice('connected', 'audiooutput', 'Speakers')).toBe('เชื่อมต่อลำโพงแล้ว: Speakers');
  });
});
