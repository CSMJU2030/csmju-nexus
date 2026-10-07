/// "แชร์ภาพ" ระหว่างสาย — ทางเลือกของการแชร์หน้าจอบนมือถือ
///
/// เบราว์เซอร์บนมือถือ (Safari บน iPhone · Chrome บน Android) ไม่มี `getDisplayMedia`
/// เว็บจึงแชร์จอสดไม่ได้เลย ไม่ว่าเว็บไหน (เป็นข้อจำกัดของเบราว์เซอร์ ไม่ใช่ของระบบนี้)
/// ทางที่ใช้ได้จริง: แคปหน้าจอ/เลือกรูปแล้วแชร์เป็นสไลด์ — วาดรูปลง canvas แล้วส่ง
/// `canvas.captureStream()` เข้าช่องเดียวกับการแชร์หน้าจอ อีกฝ่ายจึงเห็นเหมือนแชร์จอทุกอย่าง

/// เบราว์เซอร์นี้แชร์จอสดได้ไหม
export function canShareScreen(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/// แชร์ภาพเป็นสไลด์ได้ไหม (ใช้เมื่อแชร์จอสดไม่ได้)
export function canShareImages(): boolean {
  return typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

const LONG_EDGE = 1280;
/// วาดซ้ำเป็นระยะ — ภาพนิ่งที่ไม่มีเฟรมใหม่ ฝั่งรับบางเบราว์เซอร์จะค้างจอดำ
const REDRAW_MS = 1000;

export class ImageShare {
  readonly stream: MediaStream;
  private index = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly images: ImageBitmap[],
  ) {
    this.draw();
    this.stream = canvas.captureStream(5);
    this.timer = setInterval(() => this.draw(), REDRAW_MS);
  }

  /// เปิดรูปทั้งหมด (รูปที่เปิดไม่ได้ข้ามไป) · ไม่มีรูปที่ใช้ได้เลย = throw
  static async create(files: readonly File[]): Promise<ImageShare> {
    const images: ImageBitmap[] = [];

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        images.push(await createImageBitmap(file));
      } catch {
        // ไฟล์เสีย/ชนิดที่เบราว์เซอร์ถอดไม่ได้ — ข้ามไปรูปถัดไป
      }
    }

    const [first] = images;

    if (!first) throw new Error('เปิดรูปที่เลือกไม่ได้ — ลองไฟล์ PNG หรือ JPG');

    // แนวของผืนตามรูปแรก (แคปจอมือถือส่วนใหญ่เป็นแนวตั้ง)
    const portrait = first.height > first.width;
    const canvas = document.createElement('canvas');

    canvas.width = portrait ? Math.round((LONG_EDGE * 9) / 16) : LONG_EDGE;
    canvas.height = portrait ? LONG_EDGE : Math.round((LONG_EDGE * 9) / 16);

    return new ImageShare(canvas, images);
  }

  get position(): { index: number; total: number } {
    return { index: this.index, total: this.images.length };
  }

  go(delta: number): void {
    this.index = Math.min(this.images.length - 1, Math.max(0, this.index + delta));
    this.draw();
  }

  stop(): void {
    clearInterval(this.timer);
    for (const track of this.stream.getTracks()) track.stop();
    for (const image of this.images) image.close();
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    const image = this.images[this.index];

    if (!ctx || !image) return;

    const { width, height } = this.canvas;
    const scale = Math.min(width / image.width, height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;

    ctx.fillStyle = 'rgb(0 0 0)';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  }
}
