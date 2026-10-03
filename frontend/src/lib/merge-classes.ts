/// ตัดคลาส Tailwind ที่ถูกทับทิ้ง ให้ "ตัวที่มาทีหลังชนะ"
///
/// เขียนเองแทนแพ็กเกจ `tailwind-merge` ซึ่งอยู่นอกรายชื่อ dependency ที่มาตรฐาน
/// อนุญาต (ARC-02) — **ผลลัพธ์ตั้งใจให้ตรงกับ tailwind-merge 3.x ทุกตัวอักษร**
/// สำหรับคลาสที่โปรเจกต์นี้ใช้ ไม่ใช่ "ใกล้เคียง" เพราะ component กว่า 60 จุด
/// พึ่งการทับนี้อยู่ เช่น `<DialogContent className="max-w-[400px]">` ต้องลบ
/// `max-w-lg` ตั้งต้นทิ้ง ถ้าปล่อยไว้ทั้งคู่ ผลจะขึ้นกับลำดับใน CSS แทน
///
/// วิธีคิดเหมือนต้นฉบับ:
///   1. แยกคลาสเป็น variant (`hover:` `md:`) + `!` + ตัวคลาส
///   2. จัดตัวคลาสเข้า "กลุ่ม" ตามคุณสมบัติ CSS ที่มันตั้ง (`px-2` → `px`)
///   3. ไล่จากท้ายมาหน้า คลาสไหนกลุ่มซ้ำกับตัวที่อยู่หลังกว่า (variant เดียวกัน)
///      ถูกตัดทิ้ง และบางกลุ่มกินกลุ่มอื่นด้วย (`p-4` กิน `px-2` ที่อยู่ก่อนหน้า)
///
/// คลาสที่ไม่รู้จัก (`csmju-surface`, `group`, `animate-in` ของเราเอง ฯลฯ)
/// ปล่อยผ่านเสมอ ไม่ถูกตัด
///
/// **ข้อสังเกตที่สืบทอดมาจากต้นฉบับโดยตั้งใจ:** `text-<ชื่อที่ไม่ใช่ขนาดมาตรฐาน>`
/// ถูกนับเป็น "สีตัวอักษร" — `text-csmju-label` จึงชนกับ `text-foreground`
/// แล้วถูกตัดทิ้งถ้ามาก่อน (ทั้งที่จริงมันคือขนาดตัวอักษร) หน้าจอปัจจุบันถูกจัด
/// ตามพฤติกรรมนี้มาตลอด การ "แก้ให้ถูก" ตรงนี้จะทำให้ตัวอักษรหลายจุดเปลี่ยนขนาด
/// จึงคงไว้ และควรแก้เป็นงานแยกที่ตั้งใจเปลี่ยนหน้าตา

// ── ตัวตรวจค่า (ยกมาจาก validators ของต้นฉบับเฉพาะที่ใช้) ──────────────────

const ARBITRARY_VALUE = /^\[(?:(\w[\w-]*):)?(.+)\]$/i;
const ARBITRARY_VARIABLE = /^\((?:(\w[\w-]*):)?(.+)\)$/i;
const TSHIRT = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/;
const LENGTH_UNIT =
  /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/;
const COLOR_FUNCTION =
  /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix|color|light-dark)\(.+\)$/;
const SHADOW = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/;
const IMAGE =
  /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/;

const isNumber = (v: string) => !!v && !Number.isNaN(Number(v));
const isLength = (v: string) => LENGTH_UNIT.test(v) && !COLOR_FUNCTION.test(v);

/// ค่าในวงเล็บเหลี่ยม `[...]` — ถ้ามีป้าย (`[length:..]`) ตัดสินจากป้าย ไม่งั้นจากเนื้อค่า
function arbitrary(
  v: string,
  label: (l: string) => boolean,
  value: (x: string) => boolean,
): boolean {
  const m = ARBITRARY_VALUE.exec(v);
  if (!m) return false;
  return m[1] ? label(m[1]) : value(m[2]);
}

/// ค่าตัวแปร `(--x)` / `(length:--x)` — ไม่มีป้ายนับว่าไม่ใช่ ยกเว้นบอกไว้
function variable(v: string, label: (l: string) => boolean, noLabel = false): boolean {
  const m = ARBITRARY_VARIABLE.exec(v);
  if (!m) return false;
  return m[1] ? label(m[1]) : noLabel;
}

const isArb = (v: string) => ARBITRARY_VALUE.test(v);
const isVar = (v: string) => ARBITRARY_VARIABLE.test(v);
const never = () => false;
const is = (...names: string[]) => (l: string) => names.includes(l);

const arbLength = (v: string) => arbitrary(v, is('length'), isLength);
const varLength = (v: string) => variable(v, is('length'));
const arbNumber = (v: string) => arbitrary(v, is('number'), isNumber);
const arbShadow = (v: string) => arbitrary(v, is('shadow'), (x) => SHADOW.test(x));
const varShadow = (v: string) => variable(v, is('shadow'), true);
const arbImage = (v: string) => arbitrary(v, is('image', 'url'), (x) => IMAGE.test(x));
const varImage = (v: string) => variable(v, is('image', 'url'));
const arbPosition = (v: string) => arbitrary(v, is('position', 'percentage'), never);
const varPosition = (v: string) => variable(v, is('position', 'percentage'));
const arbSize = (v: string) => arbitrary(v, is('length', 'size', 'bg-size'), never);
const varSize = (v: string) => variable(v, is('length', 'size', 'bg-size'));

const set = (...values: string[]) => new Set(values);

// ── จัดกลุ่ม ──────────────────────────────────────────────────────────────

/// คลาสที่เป็นคำเดี่ยว ไม่มีค่าต่อท้าย
const KEYWORD: Record<string, string> = {
  block: 'display', 'inline-block': 'display', inline: 'display', flex: 'display',
  'inline-flex': 'display', table: 'display', 'inline-table': 'display',
  'flow-root': 'display', grid: 'display', 'inline-grid': 'display',
  contents: 'display', 'list-item': 'display', hidden: 'display',
  static: 'position', fixed: 'position', absolute: 'position',
  relative: 'position', sticky: 'position',
  visible: 'visibility', invisible: 'visibility', collapse: 'visibility',
  'sr-only': 'sr', 'not-sr-only': 'sr',
  italic: 'font-style', 'not-italic': 'font-style',
  antialiased: 'font-smoothing', 'subpixel-antialiased': 'font-smoothing',
  underline: 'text-decoration', overline: 'text-decoration',
  'line-through': 'text-decoration', 'no-underline': 'text-decoration',
  uppercase: 'text-transform', lowercase: 'text-transform',
  capitalize: 'text-transform', 'normal-case': 'text-transform',
  truncate: 'text-overflow',
  'tabular-nums': 'fvn-spacing', 'proportional-nums': 'fvn-spacing',
  border: 'border-w', ring: 'ring-w', outline: 'outline-w', shadow: 'shadow',
  rounded: 'rounded', transition: 'transition', resize: 'resize',
  grow: 'grow', shrink: 'shrink', 'divide-x': 'divide-x', 'divide-y': 'divide-y',
};

type Rule = string | ((value: string) => string | undefined);

const TEXT_ALIGN = set('left', 'center', 'right', 'justify', 'start', 'end');
const TEXT_WRAP = set('wrap', 'nowrap', 'balance', 'pretty');
const BORDER_STYLE = set('solid', 'dashed', 'dotted', 'double', 'hidden', 'none');
const SIDES = ['x', 'y', 's', 'e', 'bs', 'be', 't', 'r', 'b', 'l'];
const ALIGN_CONTENT = set('normal', 'start', 'end', 'center', 'between', 'around', 'evenly', 'baseline', 'stretch');
const FONT_WEIGHT = set('thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black');

/// ความกว้างเส้น: ว่าง (= 1px) ตัวเลข หรือความยาว
const isBorderWidth = (v: string) => isNumber(v) || arbLength(v) || varLength(v);

function borderGroup(v: string, side = ''): string | undefined {
  const s = side ? `-${side}` : '';
  if (isBorderWidth(v)) return `border-w${s}`;
  if (!side && BORDER_STYLE.has(v)) return 'border-style';
  if (!side && (v === 'collapse' || v === 'separate')) return 'border-collapse';
  return `border-color${s}`;
}

const RULES: Record<string, Rule> = {
  text: (v) =>
    TEXT_ALIGN.has(v) ? 'text-alignment'
    : TEXT_WRAP.has(v) ? 'text-wrap'
    : v === 'ellipsis' || v === 'clip' ? 'text-overflow'
    : v === 'base' || TSHIRT.test(v) || arbLength(v) || varLength(v) ? 'font-size'
    : 'text-color',
  bg: (v) =>
    set('bottom', 'center', 'left', 'left-bottom', 'left-top', 'right', 'right-bottom', 'right-top', 'top').has(v) || arbPosition(v) || varPosition(v) ? 'bg-position'
    : set('auto', 'cover', 'contain').has(v) || arbSize(v) || varSize(v) ? 'bg-size'
    : set('fixed', 'local', 'scroll').has(v) ? 'bg-attachment'
    : v === 'none' || /^(linear|radial|conic)(-|$)/.test(v) || arbImage(v) || varImage(v) ? 'bg-image'
    : v.startsWith('repeat') || v === 'no-repeat' ? 'bg-repeat'
    : 'bg-color',
  border: (v) => borderGroup(v),
  ...Object.fromEntries(
    SIDES.map((side) => [`border-${side}`, (v: string) => borderGroup(v, side)]),
  ),
  ring: (v) => (isNumber(v) || arbLength(v) || varLength(v) ? 'ring-w' : v === 'inset' ? 'ring-w-inset' : 'ring-color'),
  'ring-offset': (v) => (isNumber(v) || arbLength(v) ? 'ring-offset-w' : 'ring-offset-color'),
  shadow: (v) => (v === 'none' || TSHIRT.test(v) || arbShadow(v) || varShadow(v) ? 'shadow' : 'shadow-color'),
  'drop-shadow': (v) => (v === 'none' || TSHIRT.test(v) || arbShadow(v) || varShadow(v) ? 'drop-shadow' : 'drop-shadow-color'),
  font: (v) =>
    FONT_WEIGHT.has(v) || arbitrary(v, is('number', 'weight'), () => true) || variable(v, is('number', 'weight'), true)
      ? 'font-weight'
      : 'font-family',
  flex: (v) =>
    set('row', 'row-reverse', 'col', 'col-reverse').has(v) ? 'flex-direction'
    : set('wrap', 'wrap-reverse', 'nowrap').has(v) ? 'flex-wrap'
    : 'flex',
  outline: (v) =>
    BORDER_STYLE.has(v) ? 'outline-style'
    : isNumber(v) || arbLength(v) || varLength(v) ? 'outline-w'
    : 'outline-color',
  'outline-offset': 'outline-offset',
  divide: (v) => (BORDER_STYLE.has(v) ? 'divide-style' : 'divide-color'),
  'divide-x': (v) => (v === 'reverse' ? 'divide-x-reverse' : 'divide-x'),
  'divide-y': (v) => (v === 'reverse' ? 'divide-y-reverse' : 'divide-y'),
  object: (v) => (set('contain', 'cover', 'fill', 'none', 'scale-down').has(v) ? 'object-fit' : 'object-position'),
  snap: (v) =>
    set('start', 'end', 'center', 'align-none').has(v) ? 'snap-align'
    : set('normal', 'always').has(v) ? 'snap-stop'
    : set('none', 'x', 'y', 'both').has(v) ? 'snap-type'
    : set('mandatory', 'proximity').has(v) ? 'snap-strictness'
    : undefined,
  content: (v) => (ALIGN_CONTENT.has(v) ? 'align-content' : isArb(v) || isVar(v) ? 'content' : undefined),
  // `animate-in`/`animate-out` (แอนิเมชันป๊อปอัปใน globals.css) ไม่ใช่กลุ่มนี้
  // จึงอยู่ร่วมกับ `animate-spin` ได้ เหมือนต้นฉบับ
  animate: (v) => (set('none', 'spin', 'ping', 'pulse', 'bounce').has(v) || isArb(v) || isVar(v) ? 'animate' : undefined),
  ease: (v) => (set('linear', 'initial', 'in', 'out', 'in-out').has(v) || isArb(v) || isVar(v) ? 'ease' : undefined),
  stroke: (v) => (isNumber(v) || arbLength(v) || arbNumber(v) ? 'stroke-w' : 'stroke'),
  scrollbar: (v) => (set('auto', 'thin', 'none').has(v) ? 'scrollbar-w' : undefined),
  break: (v) => (set('normal', 'words', 'all', 'keep').has(v) ? 'break' : undefined),
  wrap: (v) => (set('break-word', 'anywhere', 'normal').has(v) ? 'wrap' : undefined),
  from: (v) => (v.endsWith('%') ? 'gradient-from-pos' : 'gradient-from'),
  via: (v) => (v.endsWith('%') ? 'gradient-via-pos' : 'gradient-via'),
  to: (v) => (v.endsWith('%') ? 'gradient-to-pos' : 'gradient-to'),
  resize: (v) => (set('none', 'x', 'y').has(v) ? 'resize' : undefined),
  // กลุ่มที่ชื่อคำนำหน้าไม่ตรงกับชื่อกลุ่ม
  items: 'align-items',
  self: 'align-self',
  justify: 'justify-content',
  align: 'vertical-align',
  origin: 'transform-origin',
  'col-span': 'col-start-end',
  'row-span': 'row-start-end',
  'pointer-events': 'pointer-events',
};

/// ค่าที่ "ดูเป็นขนาด" — กันชื่อทั่วไปอย่าง `my-following` (คีย์ของ query)
/// ไม่ให้ถูกนับเป็น margin แล้วไปตัดคลาสจริงทิ้ง
const SIZE_WORD = /^(auto|px|full|screen|min|max|fit|none|prose|[sdl]?v[hw]|lh|(\d+(\.\d+)?)?(xs|sm|md|lg|xl))$/;
const FRACTION = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/;
const isSize = (v: string) => isNumber(v) || FRACTION.test(v) || SIZE_WORD.test(v) || isArb(v) || isVar(v);

/// ระยะห่าง ขนาด และตำแหน่ง — ชื่อกลุ่มคือคำนำหน้าเอง เมื่อค่าดูเป็นขนาด
for (const prefix of [
  'p', 'px', 'py', 'ps', 'pe', 'pt', 'pr', 'pb', 'pl',
  'm', 'mx', 'my', 'ms', 'me', 'mt', 'mr', 'mb', 'ml',
  'space-x', 'space-y', 'gap', 'gap-x', 'gap-y',
  'w', 'h', 'size', 'min-w', 'max-w', 'min-h', 'max-h',
  'inset', 'inset-x', 'inset-y', 'start', 'end', 'top', 'right', 'bottom', 'left',
]) {
  RULES[prefix] = (v) => (isSize(v) ? prefix : undefined);
}

/// คำนำหน้าที่ชื่อกลุ่มคือตัวมันเอง — `z-10` อยู่กลุ่ม `z`
for (const prefix of [
  'z', 'order', 'opacity', 'aspect', 'cursor', 'select', 'whitespace',
  'leading', 'tracking', 'line-clamp', 'float', 'clear', 'basis', 'grow', 'shrink',
  'grid-cols', 'grid-rows', 'grid-flow', 'auto-cols', 'auto-rows',
  'col-start', 'col-end', 'row-start', 'row-end',
  'justify-items', 'justify-self', 'place-items', 'place-content', 'place-self',
  'overflow', 'overflow-x', 'overflow-y', 'overscroll', 'overscroll-x', 'overscroll-y',
  'transition', 'duration', 'delay', 'animate',
  'scale', 'scale-x', 'scale-y', 'rotate', 'translate', 'translate-x', 'translate-y',
  'skew-x', 'skew-y', 'blur', 'backdrop-blur',
  'fill', 'accent', 'underline-offset', 'field-sizing',
  'rounded', 'rounded-s', 'rounded-e', 'rounded-t', 'rounded-r', 'rounded-b', 'rounded-l',
  'rounded-ss', 'rounded-se', 'rounded-ee', 'rounded-es',
  'rounded-tl', 'rounded-tr', 'rounded-br', 'rounded-bl',
]) {
  RULES[prefix] ??= prefix;
}

/// คลาสด้านเดียวที่ไม่มีค่าต่อท้าย เช่น `border-t` `rounded-l`
for (const side of SIDES) KEYWORD[`border-${side}`] = `border-w-${side}`;
for (const corner of ['s', 'e', 't', 'r', 'b', 'l', 'ss', 'se', 'ee', 'es', 'tl', 'tr', 'br', 'bl']) {
  KEYWORD[`rounded-${corner}`] = `rounded-${corner}`;
}

function groupOf(base: string): string | undefined {
  // [property:value] — คุณสมบัติ CSS ที่เขียนเอง
  if (base.startsWith('[') && base.endsWith(']')) {
    const content = base.slice(1, -1);
    const colon = content.indexOf(':');
    return colon > 0 ? `arbitrary..${content.slice(0, colon)}` : undefined;
  }

  // ค่าติดลบ (`-mt-1`) อยู่กลุ่มเดียวกับค่าบวก
  const name = base.startsWith('-') && base.length > 1 ? base.slice(1) : base;

  if (KEYWORD[name]) return KEYWORD[name];

  // หาคำนำหน้าที่ยาวที่สุดที่ตรง: `gap-x-2` ต้องได้ `gap-x` ไม่ใช่ `gap`
  for (let cut = name.lastIndexOf('-'); cut > 0; cut = name.lastIndexOf('-', cut - 1)) {
    const rule = RULES[name.slice(0, cut)];
    const value = name.slice(cut + 1);
    if (rule && value) return typeof rule === 'string' ? rule : rule(value);
  }

  return undefined;
}

/// กลุ่มที่ "กิน" กลุ่มอื่นด้วย เมื่อมาทีหลัง
const CONFLICTS: Record<string, string[]> = {
  p: ['px', 'py', 'ps', 'pe', 'pbs', 'pbe', 'pt', 'pr', 'pb', 'pl'],
  px: ['ps', 'pe', 'pr', 'pl'],
  py: ['pbs', 'pbe', 'pt', 'pb'],
  m: ['mx', 'my', 'ms', 'me', 'mbs', 'mbe', 'mt', 'mr', 'mb', 'ml'],
  mx: ['ms', 'me', 'mr', 'ml'],
  my: ['mbs', 'mbe', 'mt', 'mb'],
  size: ['w', 'h'],
  gap: ['gap-x', 'gap-y'],
  inset: ['inset-x', 'inset-y', 'inset-bs', 'inset-be', 'start', 'end', 'top', 'right', 'bottom', 'left'],
  'inset-x': ['start', 'end', 'right', 'left'],
  'inset-y': ['inset-bs', 'inset-be', 'top', 'bottom'],
  flex: ['basis', 'grow', 'shrink'],
  // text-lg ตั้ง line-height มาด้วย จึงกิน leading-* ที่อยู่ก่อนหน้า
  'font-size': ['leading'],
  'line-clamp': ['display', 'overflow'],
  overflow: ['overflow-x', 'overflow-y'],
  overscroll: ['overscroll-x', 'overscroll-y'],
  'fvn-spacing': ['fvn-normal'],
  'border-w': SIDES.map((s) => `border-w-${s}`),
  'border-w-x': ['border-w-r', 'border-w-l'],
  'border-w-y': ['border-w-t', 'border-w-b'],
  'border-color': SIDES.map((s) => `border-color-${s}`),
  'border-color-x': ['border-color-r', 'border-color-l'],
  'border-color-y': ['border-color-t', 'border-color-b'],
  rounded: ['rounded-s', 'rounded-e', 'rounded-t', 'rounded-r', 'rounded-b', 'rounded-l', 'rounded-ss', 'rounded-se', 'rounded-ee', 'rounded-es', 'rounded-tl', 'rounded-tr', 'rounded-br', 'rounded-bl'],
  'rounded-s': ['rounded-ss', 'rounded-es'],
  'rounded-e': ['rounded-se', 'rounded-ee'],
  'rounded-t': ['rounded-tl', 'rounded-tr'],
  'rounded-r': ['rounded-tr', 'rounded-br'],
  'rounded-b': ['rounded-br', 'rounded-bl'],
  'rounded-l': ['rounded-tl', 'rounded-bl'],
};

// ── แยกคลาสและรวม ─────────────────────────────────────────────────────────

/// variant ที่ลำดับมีความหมาย (`before:hover:` ≠ `hover:before:`) ห้ามเรียงใหม่
const ORDER_SENSITIVE = set('*', '**', 'after', 'backdrop', 'before', 'details-content', 'file', 'first-letter', 'first-line', 'marker', 'placeholder', 'selection');

/// `hover:focus:x` กับ `focus:hover:x` คือคลาสเดียวกัน — เรียงก่อนเทียบ
/// แต่ไม่ข้าม variant แบบ `[&>span]` หรือ `before` ที่ลำดับมีผล
function sortVariants(variants: string[]): string {
  const out: string[] = [];
  let run: string[] = [];
  for (const v of variants) {
    if (v.startsWith('[') || ORDER_SENSITIVE.has(v)) {
      out.push(...run.sort(), v);
      run = [];
    } else {
      run.push(v);
    }
  }
  return [...out, ...run.sort()].join(':');
}

/// แยก `md:hover:!px-4/50` → variant, !, ตัวคลาส, ตำแหน่ง `/`
/// ข้าม `:` และ `/` ที่อยู่ใน [] หรือ () เพราะเป็นส่วนของค่า
function parse(className: string) {
  const variants: string[] = [];
  let depth = 0;
  let start = 0;
  let slash: number | undefined;

  for (let i = 0; i < className.length; i++) {
    const c = className[i];
    if (depth === 0 && c === ':') {
      variants.push(className.slice(start, i));
      start = i + 1;
    } else if (depth === 0 && c === '/') {
      slash = i;
    } else if (c === '[' || c === '(') {
      depth++;
    } else if (c === ']' || c === ')') {
      depth--;
    }
  }

  let base = className.slice(start);
  let important = false;
  if (base.endsWith('!')) {
    base = base.slice(0, -1);
    important = true;
  } else if (base.startsWith('!')) {
    base = base.slice(1);
    important = true;
  }

  // ตำแหน่ง `/` นับจากต้นตัวคลาส (หลัง variant) — `bg-white/15` → 8
  // นับรวม `!` นำหน้าด้วยเหมือนต้นฉบับ แม้จะเลื่อนไปหนึ่งตัว ผลการจัดกลุ่มก็ไม่ต่าง
  const postfix = slash !== undefined && slash > start ? slash - start : undefined;

  return { variants, important, base, postfix };
}

/// รวมรายการคลาสที่คั่นด้วยช่องว่าง ตัดตัวที่ถูกทับทิ้ง คงลำดับเดิมของตัวที่เหลือ
export function mergeClasses(classList: string): string {
  const taken = new Set<string>();
  const kept: string[] = [];
  const classNames = classList.trim().split(/\s+/);

  for (let i = classNames.length - 1; i >= 0; i--) {
    const original = classNames[i];
    if (!original) continue;

    const { variants, important, base, postfix } = parse(original);

    // `bg-white/15` จัดกลุ่มจาก `bg-white` — ส่วนหลัง `/` คือความทึบ ไม่ใช่ชนิดคลาส
    const group = groupOf(postfix ? base.slice(0, postfix) : base) ?? (postfix ? groupOf(base) : undefined);

    if (!group) {
      kept.push(original);
      continue;
    }

    const modifier = (variants.length > 1 ? sortVariants(variants) : variants.join(':')) + (important ? '!' : '');

    if (taken.has(modifier + group)) continue;

    taken.add(modifier + group);
    for (const other of CONFLICTS[group] ?? []) taken.add(modifier + other);
    kept.push(original);
  }

  return kept.reverse().join(' ');
}
