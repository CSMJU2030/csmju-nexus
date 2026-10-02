import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectConsoleError } from '../../vitest.setup';
import AppError from './error';
import NotFound from './not-found';

/// เทสต์ตาข่ายรับข้อผิดพลาดและหน้า 404
///
/// **จุดที่พังเงียบที่สุด:** Next รุ่นนี้ส่ง prop ชื่อ `retry` ไม่ใช่ `reset`
/// แบบรุ่นก่อน ถ้าเขียนจากความจำเป็น `reset` โค้ดจะคอมไพล์ผ่าน (เพราะ
/// destructure ชื่อที่ไม่มีได้ ได้ undefined) แล้วปุ่ม "ลองใหม่" จะโยน
/// TypeError ตอนผู้ใช้กด — ซึ่งแย่กว่าไม่มีปุ่มเลย
///
/// เทสต์ "กดลองใหม่แล้วเรียก retry" คือตัวที่กันข้อนี้

describe('หน้าข้อผิดพลาด', () => {
  it('กดลองใหม่แล้วเรียกฟังก์ชันกู้คืนของ Next จริง', async () => {
    expectConsoleError(/หน้าจอพังเพราะ/);

    const retry = vi.fn();

    render(<AppError error={new Error('พัง')} retry={retry} />);

    await userEvent.click(screen.getByRole('button', { name: /ลองใหม่/ }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('มีทางกลับเสมอ ไม่ใช่ทางตัน', async () => {
    // หน้าพังที่ไม่มีทางออก = ผู้ใช้ต้องปิดแท็บทิ้ง
    expectConsoleError(/หน้าจอพังเพราะ/);

    render(<AppError error={new Error('พัง')} retry={vi.fn()} />);

    expect(screen.getByRole('link', { name: /กลับไปที่ฟีด/ })).toHaveAttribute(
      'href',
      '/feed',
    );
  });

  it('แสดงรหัสอ้างอิงเมื่อมี เพื่อให้ตามรอยกับ log ได้', async () => {
    expectConsoleError(/หน้าจอพังเพราะ/);

    const error = Object.assign(new Error('พัง'), { digest: 'abc123' });

    render(<AppError error={error} retry={vi.fn()} />);

    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it('ไม่มีรหัสอ้างอิงก็ไม่แสดงบรรทัดเปล่า', async () => {
    expectConsoleError(/หน้าจอพังเพราะ/);

    render(<AppError error={new Error('พัง')} retry={vi.fn()} />);

    expect(screen.queryByText(/รหัสอ้างอิง/)).toBeNull();
  });

  it('บันทึก error ลง console เพื่อให้ไล่ต้นเหตุได้', async () => {
    // ไม่บันทึก = รู้แค่ว่า "ผู้ใช้บอกว่ามันพัง" ไล่ต่อไม่ได้
    expectConsoleError(/หน้าจอพังเพราะ/);

    const spy = vi.spyOn(console, 'error');

    render(<AppError error={new Error('พังเพราะอะไรสักอย่าง')} retry={vi.fn()} />);

    expect(spy).toHaveBeenCalled();
  });
});

describe('หน้า 404', () => {
  it('เป็นภาษาไทยและมีทางกลับสองทาง', () => {
    // ของเดิมเป็นหน้าอังกฤษของ Next ที่ไม่มีลิงก์ไปไหนเลย
    render(<NotFound />);

    expect(screen.getByText('ไม่พบหน้าที่ต้องการ')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ฟีดชุมชน/ })).toHaveAttribute(
      'href',
      '/feed',
    );
    expect(screen.getByRole('link', { name: /ค้นหา/ })).toHaveAttribute(
      'href',
      '/search',
    );
  });
});
