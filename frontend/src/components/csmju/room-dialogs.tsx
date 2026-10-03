'use client';

import { useId, useState } from 'react';
import { Hash, Loader2, Plus, Settings2, Trash2, Users, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/csmju/api';
import { isStaffLike } from '@/lib/csmju/roles';
import { useMe } from '@/lib/csmju/session';
import type { Channel, ChannelKind } from '@/lib/csmju/types';

/// สร้าง · แก้ไข · ลบห้อง
///
/// **ทุกห้องต้องตอบได้ว่า "ใครสร้าง" และ "สร้างไว้เพื่ออะไร"** — เดิมห้องมีแค่ชื่อ
/// คนที่ถูกเพิ่มเข้ามาทีหลังเห็น "กลุ่ม 3" แล้วไม่รู้ว่าห้องนี้ใช้ทำอะไร เป็นของใคร
/// และจะไปขอใครลบเมื่อเลิกใช้ วัตถุประสงค์จึงบังคับกรอกตั้งแต่ตอนสร้าง
/// (หลังบ้านบังคับเหมือนกัน — ปิดที่หน้าจออย่างเดียวเลี่ยงได้)

const NAME_MAX = 80;
const PURPOSE_MAX = 300;

type CreatableKind = Exclude<ChannelKind, 'DM' | 'GROUP_DM'>;

const KINDS: {
  kind: CreatableKind;
  label: string;
  hint: string;
  Icon: typeof Hash;
}[] = [
  {
    kind: 'GROUP',
    label: 'ห้องกลุ่ม',
    hint: 'คุยงานกลุ่ม ติวกับเพื่อน ชมรม',
    Icon: Users,
  },
  {
    kind: 'COURSE',
    label: 'ห้องประจำวิชา',
    hint: 'ห้องทางการของรายวิชา — อาจารย์และบุคลากรสร้างได้',
    Icon: Hash,
  },
  {
    kind: 'VOICE',
    label: 'ห้องเสียง',
    hint: 'กดเข้า-ออกได้อิสระ รับได้สูงสุด 8 คน',
    Icon: Volume2,
  },
];

/// ตัวนับตัวอักษรใต้ช่อง — บอกก่อนชนเพดาน ไม่ใช่รอให้หลังบ้านปฏิเสธ
function Counter({ id, value, max }: { id: string; value: string; max: number }) {
  return (
    <p
      id={id}
      className={`text-right text-csmju-caption tabular-nums ${
        value.length > max ? 'text-destructive' : 'text-muted-foreground'
      }`}
    >
      {value.length}/{max}
    </p>
  );
}

export function CreateRoomDialog({
  onCreated,
  defaultOpen = false,
}: {
  onCreated: (channel: Channel) => void;
  /// เปิดกล่องทันที — เมนู "สร้าง → สร้างห้อง" ในแถบซ้ายพามาด้วย ?create=1
  defaultOpen?: boolean;
}) {
  const id = useId();
  const me = useMe();
  const [open, setOpen] = useState(defaultOpen);
  const [kind, setKind] = useState<CreatableKind>('GROUP');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [courseTag, setCourseTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ห้องประจำวิชาสร้างได้เฉพาะบุคลากร อาจารย์ และ admin (ตรงกับ channels.service)
  // บอกเหตุผลที่ตัวเลือกเลย ดีกว่าให้กรอกครบแล้วค่อยเจอ 403 ตอนกดสร้าง
  const courseLocked = !isStaffLike(me.coreRole);

  const valid =
    name.trim().length > 0 &&
    name.trim().length <= NAME_MAX &&
    purpose.trim().length > 0 &&
    purpose.trim().length <= PURPOSE_MAX;

  function reset() {
    setKind('GROUP');
    setName('');
    setPurpose('');
    setCourseTag('');
    setError(null);
  }

  async function submit() {
    if (!valid) return;

    setBusy(true);
    setError(null);

    try {
      const channel = await api.post<Channel>('/channels', {
        kind,
        name: name.trim(),
        description: purpose.trim(),
        ...(kind === 'COURSE' && courseTag.trim()
          ? { courseTag: courseTag.trim().toUpperCase() }
          : {}),
      });

      onCreated(channel);
      setOpen(false);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'สร้างห้องไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-csmju-caption font-medium text-primary-foreground shadow-csmju-xs transition-opacity hover:opacity-90"
      >
        <Plus aria-hidden className="size-3.5" />
        สร้างห้อง
      </button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="border-b border-border px-6 py-4 text-base">
            สร้างห้องใหม่
          </DialogTitle>
        </DialogHeader>

        <DialogDescription className="px-6 pt-3 text-csmju-caption text-muted-foreground">
          สมาชิกทุกคนจะเห็นว่าคุณเป็นผู้สร้าง และเห็นวัตถุประสงค์ของห้องนี้
        </DialogDescription>

        <form
          className="space-y-4 px-6 pb-6 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-csmju-label font-medium">ชนิดห้อง</legend>

            <div className="grid gap-1.5">
              {KINDS.map(({ kind: option, label, hint, Icon }) => {
                const locked = option === 'COURSE' && courseLocked;

                return (
                  <label
                    key={option}
                    className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                      kind === option
                        ? 'border-primary bg-secondary'
                        : 'border-border hover:bg-accent/60'
                    } ${locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                  >
                    <input
                      type="radio"
                      name={`${id}-kind`}
                      value={option}
                      checked={kind === option}
                      disabled={locked}
                      onChange={() => setKind(option)}
                      className="mt-1 accent-[var(--csmju-primary)]"
                    />
                    <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="min-w-0 leading-tight">
                      <span className="block text-csmju-label font-medium">{label}</span>
                      <span className="block text-csmju-caption text-muted-foreground">
                        {locked ? 'ต้องเป็นอาจารย์หรือบุคลากร' : hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-1">
            <Label htmlFor={`${id}-name`}>ชื่อห้อง</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              placeholder="เช่น ติวสอบ Data Structures"
              aria-describedby={`${id}-name-count`}
              required
            />
            <Counter id={`${id}-name-count`} value={name} max={NAME_MAX} />
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${id}-purpose`}>สร้างห้องนี้เพื่ออะไร</Label>
            <Textarea
              id={`${id}-purpose`}
              value={purpose}
              maxLength={PURPOSE_MAX}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="เช่น ติวก่อนสอบกลางภาค บทที่ 1-5 ทุกวันพุธ 18:00"
              rows={3}
              aria-describedby={`${id}-purpose-count`}
              required
            />
            <Counter id={`${id}-purpose-count`} value={purpose} max={PURPOSE_MAX} />
          </div>

          {kind === 'COURSE' && (
            <div className="space-y-1">
              <Label htmlFor={`${id}-course`}>รหัสวิชา (ไม่บังคับ)</Label>
              <Input
                id={`${id}-course`}
                value={courseTag}
                maxLength={20}
                onChange={(event) => setCourseTag(event.target.value.toUpperCase())}
                placeholder="CS201"
                className="font-mono"
              />
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-csmju-caption text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
              สร้างห้อง
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/// แก้ไขห้อง + ลบห้อง — แสดงเฉพาะคนที่หลังบ้านบอกว่า `canManage`
///
/// การลบอยู่ในกล่องเดียวกันแต่แยกเป็นขั้นยืนยันของมันเอง (ConfirmDialog ตาม
/// ui-design-system.md ข้อ 8.3) ข้อความต้องบอก **ชื่อห้อง** และ **ผลที่ตามมา**
/// เพราะกู้คืนไม่ได้ และคนอื่นในห้องเสียประวัติไปด้วย
export function ManageRoomDialog({
  channel,
  onUpdated,
  onDeleted,
}: {
  channel: Channel;
  onUpdated: (channel: Channel) => void;
  onDeleted: (channelId: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(channel.name ?? '');
  const [purpose, setPurpose] = useState(channel.description ?? '');
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changed =
    name.trim() !== (channel.name ?? '') ||
    purpose.trim() !== (channel.description ?? '');

  const valid =
    name.trim().length > 0 &&
    name.trim().length <= NAME_MAX &&
    purpose.trim().length > 0 &&
    purpose.trim().length <= PURPOSE_MAX;

  function openDialog() {
    // เริ่มจากค่าล่าสุดเสมอ — คนอื่นอาจแก้ไปแล้วระหว่างที่เปิดห้องค้างไว้
    setName(channel.name ?? '');
    setPurpose(channel.description ?? '');
    setConfirming(false);
    setError(null);
    setOpen(true);
  }

  async function save() {
    if (!valid || !changed) return;

    setBusy('save');
    setError(null);

    try {
      const next = await api.patch<Channel>(`/channels/${channel.id}`, {
        name: name.trim(),
        description: purpose.trim(),
      });

      onUpdated(next);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    setError(null);

    try {
      await api.del(`/channels/${channel.id}`);
      setOpen(false);
      onDeleted(channel.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ลบห้องไม่สำเร็จ');
      setBusy(null);
    }
  }

  const roomName = channel.name ?? 'ห้องนี้';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={openDialog}
        aria-label="แก้ไขหรือลบห้อง"
        title="แก้ไขหรือลบห้อง"
        className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Settings2 aria-hidden className="size-4" />
      </button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="border-b border-border px-6 py-4 text-base">
            {confirming ? `ลบห้อง "${roomName}"?` : 'แก้ไขห้อง'}
          </DialogTitle>
        </DialogHeader>

        {confirming ? (
          <div className="space-y-4 px-6 pb-6 pt-4">
            <DialogDescription className="text-csmju-body leading-relaxed">
              ห้องนี้จะถูกลบถาวร ข้อความทั้งหมด {channel.memberCount > 1 ? `ของสมาชิก ${channel.memberCount} คน ` : ''}
              ห้องเสียง และนัดประชุมของห้องจะหายไปด้วย กู้คืนไม่ได้
            </DialogDescription>

            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-csmju-caption text-destructive">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={busy === 'delete'}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void remove()}
                disabled={busy === 'delete'}
              >
                {busy === 'delete' && <Loader2 aria-hidden className="size-4 animate-spin" />}
                ลบห้อง
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4 px-6 pb-6 pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <DialogDescription className="sr-only">
              แก้ชื่อหรือวัตถุประสงค์ของห้อง หรือลบห้องทิ้ง
            </DialogDescription>

            <div className="space-y-1">
              <Label htmlFor={`${id}-name`}>ชื่อห้อง</Label>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={NAME_MAX}
                onChange={(event) => setName(event.target.value)}
                aria-describedby={`${id}-name-count`}
                required
              />
              <Counter id={`${id}-name-count`} value={name} max={NAME_MAX} />
            </div>

            <div className="space-y-1">
              <Label htmlFor={`${id}-purpose`}>สร้างห้องนี้เพื่ออะไร</Label>
              <Textarea
                id={`${id}-purpose`}
                value={purpose}
                maxLength={PURPOSE_MAX}
                onChange={(event) => setPurpose(event.target.value)}
                rows={3}
                aria-describedby={`${id}-purpose-count`}
                required
              />
              <Counter id={`${id}-purpose-count`} value={purpose} max={PURPOSE_MAX} />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-csmju-caption text-destructive">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setConfirming(true);
                  setError(null);
                }}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 aria-hidden className="size-4" />
                ลบห้อง
              </Button>

              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  ยกเลิก
                </Button>
                <Button type="submit" disabled={!valid || !changed || busy === 'save'}>
                  {busy === 'save' && <Loader2 aria-hidden className="size-4 animate-spin" />}
                  บันทึก
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
