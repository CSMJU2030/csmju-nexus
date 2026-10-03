import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useCharacterLimit } from './use-character-limit';

/// เทสต์ตัวนับตัวอักษร
///
/// เพดานต้องตรงกับหลังบ้าน (`bio String? @db.VarChar(300)`) ไม่งั้นผู้ใช้
/// กดบันทึกแล้วได้ 400 ทั้งที่ตัวนับยังบอกว่าเหลือที่
///
/// และต้องนับให้ตรงกับที่คนเห็น: `"👍".length` เท่ากับ 2 เพราะ JavaScript
/// นับเป็นหน่วย UTF-16 — ผู้ใช้พิมพ์อิโมจิตัวเดียวแล้วเห็นเลขลดสองจะงง

function Harness({ max = 10, initial = '' }: { max?: number; initial?: string }) {
  const { value, characterCount, handleChange, maxLength } = useCharacterLimit({
    maxLength: max,
    initialValue: initial,
  });

  return (
    <div>
      <textarea
        aria-label="ข้อความ"
        value={value}
        onChange={handleChange}
      />
      <span data-testid="count">{characterCount}</span>
      <span data-testid="left">{maxLength - characterCount}</span>
    </div>
  );
}

describe('useCharacterLimit', () => {
  it('เริ่มด้วยค่าตั้งต้นและนับถูก', () => {
    render(<Harness initial="สวัสดี" />);

    expect(screen.getByTestId('count')).toHaveTextContent('6');
  });

  it('พิมพ์แล้วนับเพิ่ม', async () => {
    render(<Harness />);

    await userEvent.type(screen.getByLabelText('ข้อความ'), 'abc');

    expect(screen.getByTestId('count')).toHaveTextContent('3');
    expect(screen.getByTestId('left')).toHaveTextContent('7');
  });

  it('พิมพ์เกินเพดานแล้วไม่รับตัวที่เกิน', async () => {
    render(<Harness max={5} />);

    await userEvent.type(screen.getByLabelText('ข้อความ'), '1234567890');

    expect(screen.getByLabelText('ข้อความ')).toHaveValue('12345');
    expect(screen.getByTestId('left')).toHaveTextContent('0');
  });

  it('อิโมจิหนึ่งตัวนับเป็นหนึ่ง ไม่ใช่สอง', async () => {
    // "👍".length === 2 ใน JavaScript เพราะเป็น surrogate pair
    // ถ้านับด้วย .length ผู้ใช้จะเห็นเลขลดเร็วกว่าที่พิมพ์จริงเท่าตัว
    render(<Harness max={10} />);

    await userEvent.type(screen.getByLabelText('ข้อความ'), '👍👍');

    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('อิโมจิยังพิมพ์ได้จนเต็มเพดานจริง', async () => {
    render(<Harness max={3} />);

    await userEvent.type(screen.getByLabelText('ข้อความ'), '👍👍👍');

    // ถ้านับด้วย .length จะรับได้แค่ตัวเดียวครึ่ง แล้วตัดกลางคู่ surrogate
    expect(screen.getByTestId('count')).toHaveTextContent('3');
    expect(screen.getByLabelText('ข้อความ')).toHaveValue('👍👍👍');
  });

  it('สระไทยที่แยกหน่วยยังนับตามที่ระบบเห็น', async () => {
    render(<Harness max={20} />);

    await userEvent.type(screen.getByLabelText('ข้อความ'), 'กิน');

    // "กิน" มีสามหน่วยรหัส — นับแบบเดียวกับที่หลังบ้านนับ (VarChar นับ
    // ตามอักขระ Unicode) จึงตรงกันทั้งสองฝั่ง
    expect(screen.getByTestId('count')).toHaveTextContent('3');
  });

  it('ลบข้อความแล้วนับลดตาม', async () => {
    render(<Harness initial="abcde" max={10} />);

    await userEvent.clear(screen.getByLabelText('ข้อความ'));

    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });
});
