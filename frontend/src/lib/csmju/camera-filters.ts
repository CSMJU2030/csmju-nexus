/// ฟิลเตอร์ของกล้องแบบ Instagram — ค่าเดียวกันใช้สองที่
///
///   พรีวิวสด   ใส่เป็น CSS `filter` บน <video> (เบราว์เซอร์คำนวณบน GPU)
///   ภาพที่ถ่าย  คำนวณทีละพิกเซลด้วย `applyFilter` (สูตรเมทริกซ์ของ Filter Effects spec)
///
/// ไม่ใช้ `ctx.filter` ของ canvas ตอนถ่าย เพราะ Safari (iPhone) ยังไม่รองรับ —
/// ถ้าใช้ ภาพที่ได้บน iPhone จะไม่มีฟิลเตอร์ทั้งที่พรีวิวมี

export type FilterStep =
  | { op: 'brightness'; amount: number }
  | { op: 'contrast'; amount: number }
  | { op: 'saturate'; amount: number }
  | { op: 'grayscale'; amount: number }
  | { op: 'sepia'; amount: number }
  | { op: 'hue-rotate'; degrees: number };

export interface CameraFilter {
  id: string;
  label: string;
  steps: readonly FilterStep[];
}

export const CAMERA_FILTERS: readonly CameraFilter[] = [
  { id: 'normal', label: 'ปกติ', steps: [] },
  {
    id: 'vivid',
    label: 'สดใส',
    steps: [
      { op: 'contrast', amount: 1.2 },
      { op: 'saturate', amount: 1.35 },
    ],
  },
  {
    id: 'soft',
    label: 'นุ่มนวล',
    steps: [
      { op: 'contrast', amount: 0.9 },
      { op: 'brightness', amount: 1.1 },
      { op: 'saturate', amount: 1.1 },
    ],
  },
  {
    id: 'warm',
    label: 'อบอุ่น',
    steps: [
      { op: 'sepia', amount: 0.22 },
      { op: 'brightness', amount: 1.1 },
      { op: 'contrast', amount: 0.85 },
      { op: 'saturate', amount: 1.2 },
    ],
  },
  {
    id: 'cool',
    label: 'เย็นตา',
    steps: [
      { op: 'hue-rotate', degrees: -12 },
      { op: 'contrast', amount: 1.05 },
      { op: 'saturate', amount: 0.9 },
      { op: 'brightness', amount: 1.05 },
    ],
  },
  {
    id: 'film',
    label: 'ฟิล์ม',
    steps: [
      { op: 'sepia', amount: 0.25 },
      { op: 'contrast', amount: 0.95 },
      { op: 'brightness', amount: 1.05 },
      { op: 'saturate', amount: 0.9 },
    ],
  },
  {
    id: 'pastel',
    label: 'พาสเทล',
    steps: [
      { op: 'hue-rotate', degrees: -20 },
      { op: 'contrast', amount: 0.9 },
      { op: 'saturate', amount: 0.85 },
      { op: 'brightness', amount: 1.2 },
    ],
  },
  {
    id: 'sharp',
    label: 'คมชัด',
    steps: [
      { op: 'contrast', amount: 1.15 },
      { op: 'saturate', amount: 1.8 },
      { op: 'sepia', amount: 0.12 },
    ],
  },
  {
    id: 'mono',
    label: 'ขาวดำ',
    steps: [
      { op: 'grayscale', amount: 1 },
      { op: 'contrast', amount: 1.1 },
      { op: 'brightness', amount: 1.1 },
    ],
  },
  {
    id: 'classic',
    label: 'คลาสสิก',
    steps: [
      { op: 'sepia', amount: 0.3 },
      { op: 'contrast', amount: 1.1 },
      { op: 'brightness', amount: 1.1 },
      { op: 'grayscale', amount: 1 },
    ],
  },
  {
    id: 'faded',
    label: 'ซีดจาง',
    steps: [
      { op: 'grayscale', amount: 0.5 },
      { op: 'contrast', amount: 0.95 },
      { op: 'brightness', amount: 0.9 },
    ],
  },
];

/// ข้อความ CSS `filter` ของฟิลเตอร์ — ให้พรีวิวสดตรงกับภาพที่ถ่าย
export function filterCss(filter: CameraFilter): string {
  if (filter.steps.length === 0) return 'none';

  return filter.steps
    .map((step) => (step.op === 'hue-rotate' ? `hue-rotate(${step.degrees}deg)` : `${step.op}(${step.amount})`))
    .join(' ');
}

type Matrix = readonly [number, number, number, number, number, number, number, number, number];

/// เมทริกซ์สี 3×3 ตาม Filter Effects Module Level 1 (feColorMatrix) — สูตรเดียวกับที่เบราว์เซอร์ใช้กับ CSS filter
function colorMatrix(step: FilterStep): Matrix | null {
  switch (step.op) {
    case 'saturate': {
      const s = step.amount;

      return [
        0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
        0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
        0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
      ];
    }
    case 'grayscale': {
      const g = 1 - Math.min(1, Math.max(0, step.amount));

      return [
        0.2126 + 0.7874 * g, 0.7152 - 0.7152 * g, 0.0722 - 0.0722 * g,
        0.2126 - 0.2126 * g, 0.7152 + 0.2848 * g, 0.0722 - 0.0722 * g,
        0.2126 - 0.2126 * g, 0.7152 - 0.7152 * g, 0.0722 + 0.9278 * g,
      ];
    }
    case 'sepia': {
      const p = 1 - Math.min(1, Math.max(0, step.amount));

      return [
        0.393 + 0.607 * p, 0.769 - 0.769 * p, 0.189 - 0.189 * p,
        0.349 - 0.349 * p, 0.686 + 0.314 * p, 0.168 - 0.168 * p,
        0.272 - 0.272 * p, 0.534 - 0.534 * p, 0.131 + 0.869 * p,
      ];
    }
    case 'hue-rotate': {
      const rad = (step.degrees * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);

      return [
        0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
        0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
        0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
      ];
    }
    default:
      return null;
  }
}

/// ใส่ฟิลเตอร์ลงพิกเซล RGBA ตรง ๆ (แก้ในตัว) — ลำดับขั้นเหมือน CSS (ซ้ายไปขวา) · ไม่แตะช่อง alpha
export function applyFilter(data: Uint8ClampedArray, filter: CameraFilter): void {
  if (filter.steps.length === 0) return;

  for (const step of filter.steps) {
    const matrix = colorMatrix(step);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;

      if (matrix) {
        data[i] = matrix[0] * r + matrix[1] * g + matrix[2] * b;
        data[i + 1] = matrix[3] * r + matrix[4] * g + matrix[5] * b;
        data[i + 2] = matrix[6] * r + matrix[7] * g + matrix[8] * b;
      } else if (step.op === 'brightness') {
        data[i] = r * step.amount;
        data[i + 1] = g * step.amount;
        data[i + 2] = b * step.amount;
      } else if (step.op === 'contrast') {
        // feComponentTransfer linear: slope = amount · intercept = 0.5 − 0.5·amount (หน่วย 0–1)
        const intercept = 127.5 * (1 - step.amount);

        data[i] = r * step.amount + intercept;
        data[i + 1] = g * step.amount + intercept;
        data[i + 2] = b * step.amount + intercept;
      }
    }
  }
}

/// กรอบตัดภาพแบบ object-fit: cover — กล้องหลังมือถือส่งภาพแนวนอนมาแม้ถือแนวตั้ง
export function coverCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetAspect: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sourceAspect = sourceWidth / sourceHeight;

  if (sourceAspect > targetAspect) {
    const sw = sourceHeight * targetAspect;

    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }

  const sh = sourceWidth / targetAspect;

  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}
