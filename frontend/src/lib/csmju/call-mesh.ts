import { isPolite, shouldIgnoreOffer } from '@/lib/csmju/negotiation';
import {
  classifyVideo,
  decodeMediaState,
  encodeMediaState,
  type PeerMediaState,
} from '@/lib/csmju/call-media';

/// สาย WebRTC แบบ mesh — หนึ่งเส้นต่อคนหนึ่งคน ใช้ร่วมกันทั้งสายโทร (CallProvider)
/// และห้องเสียงแบบต่อค้าง (VoiceRoomProvider)
///
/// **ทำไมต้องมีตัวกลาง:** ตรรกะ perfect negotiation สั้นแต่พังแล้วหาไม่เจอ
/// (สายค้าง "กำลังเชื่อมต่อ" โดยไม่มี error) ถ้าสองที่เขียนกันคนละแบบ ก็ต้อง
/// แก้บั๊กเดียวกันสองรอบ — ที่นี่จึงเป็นที่เดียวที่แตะ RTCPeerConnection
///
/// โปรโตคอลไม่เปลี่ยน: ยังเป็น `rtc:signal {toCoreUserId, kind, data}` ชุดเดิม
/// ที่หลังบ้านส่งต่อให้เฉพาะคนที่อยู่ห้องเสียงเดียวกัน

export type PeerLinkState = 'connecting' | 'connected' | 'failed';

export interface MeshPeer {
  coreUserId: string;
  pc: RTCPeerConnection;
  /// เรายอมถอยไหมถ้ายื่นข้อเสนอชนกัน — ดู `negotiation.ts`
  polite: boolean;
  /// อีกฝ่ายอยู่ในห้องเสียงแล้ว หลังบ้านจึงยอมส่ง SDP ต่อให้ — ก่อนหน้านั้น
  /// ยื่นไปก็ถูกทิ้งเงียบ ๆ แล้วสายไม่มีวันติด
  ready: boolean;
  connection: PeerLinkState;
  makingOffer: boolean;
  ignoredOffer: boolean;
  channel: RTCDataChannel | null;
  audio: MediaStream | null;
  videos: Map<string, MediaStream>;
  /// id ของสตรีมกล้อง/จอที่อีกฝ่ายประกาศมา — ใช้แยกภาพสองเส้นออกจากกัน
  remote: PeerMediaState | null;
  /// ICE candidate ที่มาถึงก่อน description ของมัน — รอใส่หลังตั้ง description
  pendingIce: RTCIceCandidateInit[];
}

/// เก็บ candidate ที่ยังใส่ไม่ได้ไว้ไม่เกินเท่านี้ต่อสาย (กันหน่วยความจำบวมถ้าอีกฝ่ายพัง)
const MAX_PENDING_ICE = 64;

export interface SignalPayload {
  fromCoreUserId: string;
  kind: 'offer' | 'answer' | 'ice' | 'renegotiate';
  data: unknown;
}

export interface MeshOptions {
  me: string;
  iceServers: RTCIceServer[];
  /// สตรีมของเราที่ต้องส่งให้ทุกคน (ไมค์ · กล้อง · จอ) — คนที่ต่อเข้ามาทีหลังต้องได้ครบ
  localStreams: () => (MediaStream | null)[];
  localState: () => PeerMediaState;
  /// ส่งสัญญาณแบบไม่รอคำตอบ (ice · answer)
  emit: (payload: { toCoreUserId: string; kind: string; data: unknown }) => void;
  /// ส่ง offer แบบรอ ack — หลังบ้านปฏิเสธการส่งต่อได้ (อีกฝ่ายออกไปแล้ว)
  emitOffer: (payload: {
    toCoreUserId: string;
    kind: 'offer';
    data: unknown;
  }) => Promise<{ ok: boolean; error?: string }>;
  /// มีอะไรเปลี่ยนที่หน้าจอควรวาดใหม่
  onChange: () => void;
  onConnected?: (coreUserId: string) => void;
  onFailed?: (coreUserId: string) => void;
  onOfferRejected?: (coreUserId: string, error: string | undefined) => void;
  onOfferFailed?: (coreUserId: string) => void;
}

export interface PeerMedia {
  camera: MediaStream | null;
  screen: MediaStream | null;
}

function newStream(tracks: MediaStreamTrack[]): MediaStream | null {
  return typeof MediaStream === 'function' ? new MediaStream(tracks) : null;
}

export class Mesh {
  readonly peers = new Map<string, MeshPeer>();
  private closed = false;

  constructor(private readonly options: MeshOptions) {}

  get size(): number {
    return this.peers.size;
  }

  has(coreUserId: string): boolean {
    return this.peers.has(coreUserId);
  }

  get(coreUserId: string): MeshPeer | undefined {
    return this.peers.get(coreUserId);
  }

  /// เปิดสายไปหาคนหนึ่งคน (เรียกซ้ำได้ ได้สายเดิมกลับไป)
  open(coreUserId: string, ready: boolean): MeshPeer {
    const existing = this.peers.get(coreUserId);

    if (existing) return existing;

    // `username` ใน iceServers เป็นชื่อฟิลด์ของมาตรฐาน WebRTC ไม่ใช่ตัวตนผู้ใช้
    const pc = new RTCPeerConnection({ iceServers: this.options.iceServers });

    const peer: MeshPeer = {
      coreUserId,
      pc,
      polite: isPolite(this.options.me, coreUserId),
      ready,
      connection: 'connecting',
      makingOffer: false,
      ignoredOffer: false,
      channel: null,
      audio: null,
      videos: new Map(),
      remote: null,
      pendingIce: [],
    };

    this.peers.set(coreUserId, peer);

    for (const stream of this.options.localStreams()) {
      for (const track of stream?.getTracks() ?? []) pc.addTrack(track, stream!);
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      this.options.emit({
        toCoreUserId: coreUserId,
        kind: 'ice',
        data: event.candidate.toJSON(),
      });
    };

    pc.ontrack = (event) => this.handleTrack(peer, event);

    // ช่องประกาศสถานะ — **ฝ่ายไม่ยอมถอยเป็นคนเปิด หลังต่อติดแล้วเท่านั้น**
    //
    // เดิมเปิดแบบ negotiated ทั้งสองฝั่งตั้งแต่สร้างสาย แล้วพบในเบราว์เซอร์จริงว่า
    // พอยื่นข้อเสนอชนกันตอนเริ่มสาย ฝ่ายที่ยอมถอยม้วนข้อเสนอแรก (ที่มีช่อง
    // ข้อมูลอยู่) ทิ้ง Chrome ปิดช่องนั้นไปด้วย แล้วทั้งสองฝั่งยื่นข้อเสนอใหม่
    // วนไม่หยุดทุก ~15ms · ฝ่ายไม่ยอมถอยไม่เคยม้วนข้อเสนอของตัวเอง จึงปลอดภัย
    pc.ondatachannel = (event) => this.attachChannel(peer, event.channel);

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;

      if (state === 'connected') {
        peer.connection = 'connected';
        this.openStateChannel(peer);
        this.options.onConnected?.(coreUserId);
      } else if (state === 'failed') {
        peer.connection = 'failed';
        this.options.onFailed?.(coreUserId);
      } else if (state === 'connecting' || state === 'new') {
        peer.connection = 'connecting';
      }

      this.options.onChange();
    };

    // เบราว์เซอร์บอกเองว่าต้องเจรจาใหม่ (เช่นตอนเพิ่มแทร็ก) — offer() เงียบไว้
    // จนกว่าอีกฝ่ายจะอยู่ในห้องเสียงจริง
    pc.onnegotiationneeded = () => void this.offer(coreUserId);

    this.options.onChange();

    return peer;
  }

  setReady(coreUserId: string) {
    const peer = this.peers.get(coreUserId);

    if (peer) peer.ready = true;
  }

  drop(coreUserId: string) {
    const peer = this.peers.get(coreUserId);

    if (!peer) return;

    peer.channel?.close();
    peer.pc.close();
    this.peers.delete(coreUserId);
    this.options.onChange();
  }

  close() {
    this.closed = true;

    for (const peer of this.peers.values()) {
      peer.channel?.close();
      peer.pc.close();
    }

    this.peers.clear();
  }

  /// ยื่นข้อเสนอหนึ่งรอบให้สายหนึ่งเส้น
  ///
  /// ยื่นได้ทั้งสองฝั่ง ใครเพิ่มแทร็กก็ยื่นเอง ถ้าชนกันฝ่าย polite ถอย —
  /// ของเดิมเคยแบ่งหน้าที่ตายตัวแล้วส่ง `renegotiate` ไปขอให้อีกฝั่งยื่นแทน
  /// ซึ่งใช้ไม่ได้ตามสเปก (ฝ่ายที่ตอบเพิ่ม m-section ในคำตอบไม่ได้)
  async offer(coreUserId: string): Promise<void> {
    const peer = this.peers.get(coreUserId);

    if (!peer || !peer.ready || this.closed) return;

    // **ยื่นได้ทีละรอบเท่านั้น** — ทั้ง `negotiationneeded` และการเรียกตรง
    // พาเข้ามาที่นี่ ถ้าไม่กันจะยื่นสองรอบติดกัน แล้วคำตอบใบที่สองชน
    // InvalidStateError เบราว์เซอร์ยิง `negotiationneeded` ซ้ำให้เองเมื่อกลับ
    // สู่ stable แล้วยังมีของค้าง
    if (peer.pc.signalingState !== 'stable' || peer.makingOffer) return;

    try {
      peer.makingOffer = true;

      // ไม่ใส่อาร์กิวเมนต์ = ให้เบราว์เซอร์สร้างข้อเสนอตามสถานะปัจจุบันเอง
      await peer.pc.setLocalDescription();

      const relayed = await this.options.emitOffer({
        toCoreUserId: coreUserId,
        kind: 'offer',
        data: peer.pc.localDescription,
      });

      if (!relayed.ok) this.options.onOfferRejected?.(coreUserId, relayed.error);
    } catch {
      if (this.peers.get(coreUserId) === peer) this.options.onOfferFailed?.(coreUserId);
    } finally {
      peer.makingOffer = false;
    }
  }

  async offerAll(): Promise<void> {
    await Promise.all([...this.peers.keys()].map((id) => this.offer(id)));
  }

  /// รับสัญญาณหนึ่งชิ้น — ต้องมีสายของคนนั้นอยู่แล้ว (ผู้เรียกตัดสินเองว่าจะเปิดให้คนแปลกหน้าไหม)
  async signal(payload: SignalPayload): Promise<void> {
    const peer = this.peers.get(payload.fromCoreUserId);

    if (!peer) return;

    if (payload.kind === 'renegotiate') {
      // ไม่มีใครส่งมาแล้ว (ยื่นเองได้ทั้งคู่) แต่ยังรับไว้เพราะสัญญาของหลังบ้าน
      // ยังประกาศชนิดนี้อยู่ — ถือเป็น "ช่วยยื่นที"
      await this.offer(payload.fromCoreUserId);

      return;
    }

    if (payload.kind === 'offer' || payload.kind === 'answer') {
      const description = payload.data as RTCSessionDescriptionInit;

      // ยื่นชนกัน: ฝ่ายไม่ยอมถอยเมินของอีกฝ่าย ฝ่ายยอมถอยทิ้งของตัวเองแล้ว
      // รับของเขา (setRemoteDescription ม้วนกลับให้เอง)
      peer.ignoredOffer =
        description.type === 'offer' &&
        shouldIgnoreOffer({
          polite: peer.polite,
          makingOffer: peer.makingOffer,
          signalingState: peer.pc.signalingState,
        });

      if (peer.ignoredOffer) return;

      try {
        await peer.pc.setRemoteDescription(description);

        if (description.type === 'offer') {
          // เขายื่นมาได้ = เขาอยู่ในห้องเสียงแล้ว รอบหลังเรายื่นเองได้ด้วย
          peer.ready = true;
          await peer.pc.setLocalDescription();

          this.options.emit({
            toCoreUserId: payload.fromCoreUserId,
            kind: 'answer',
            data: peer.pc.localDescription,
          });
        }

        // ใส่ candidate ที่รอไว้ **หลังคำตอบเสร็จแล้วเท่านั้น** (กลับสู่ stable)
        //
        // เจอในเบราว์เซอร์จริง: ฝ่ายที่ยอมถอยม้วนข้อเสนอของตัวเองทิ้ง รับข้อเสนอ
        // ของอีกฝ่าย แล้วถ้าใส่ candidate ของอีกฝ่ายระหว่าง have-remote-offer
        // (ก่อนสร้างคำตอบ) Chrome เริ่มเก็บ candidate ของคำตอบแต่ไม่ปล่อยออกมา
        // สักตัว — ICE ทั้งสองฝั่งค้างที่ new ตลอดไป ราวหนึ่งในห้ารอบ
        await this.flushIce(peer);
      } catch {
        // คำตอบซ้ำที่มาช้า (สายกลับ stable ไปแล้ว) หรือสายถูกปิดระหว่างทาง
        // — ไม่ใช่ความผิดของผู้ใช้ และรอบเจรจาถัดไปจะแก้ให้เอง
      }

      return;
    }

    const candidate = payload.data as RTCIceCandidateInit;

    // **ห้ามทิ้ง candidate ที่ใส่ไม่ได้ตอนนี้** — หลังบ้านส่งต่อสัญญาณแต่ละชิ้น
    // หลังเช็กฐานข้อมูลแยกกัน (sharesVoiceSession) ลำดับจึงสลับได้: candidate
    // ของคำตอบวิ่งแซงตัวคำตอบมาถึงก่อน ถ้าทิ้ง ICE ไม่มีวันเริ่ม สายค้าง
    // "กำลังเชื่อมต่อ…" แบบสุ่ม (เจอจริงในสายกลุ่มสามคน ราวหนึ่งในสามรอบ)
    //
    // ช่วงที่เพิ่งเมินข้อเสนอที่ชน ก็เก็บไว้ก่อนเช่นกัน — อาจเป็นของคำตอบที่
    // แซงมา ถ้าเป็นของข้อเสนอที่ถูกเมินจริง ใส่ทีหลังก็แค่ถูกปฏิเสธเงียบ ๆ
    //
    // และระหว่างรอบเจรจาที่ยังไม่จบ (ไม่ใช่ stable) ก็เก็บไว้ — ดูเหตุผลที่ flushIce
    if (peer.ignoredOffer || !peer.pc.remoteDescription || peer.pc.signalingState !== 'stable') {
      this.queueIce(peer, candidate);

      return;
    }

    try {
      await peer.pc.addIceCandidate(candidate);
    } catch {
      // ของ description ที่ยังมาไม่ถึง (สลับลำดับกับรอบเจรจาใหม่) — ลองอีกทีทีหลัง
      this.queueIce(peer, candidate);
    }
  }

  private queueIce(peer: MeshPeer, candidate: RTCIceCandidateInit) {
    peer.pendingIce.push(candidate);

    if (peer.pendingIce.length > MAX_PENDING_ICE) peer.pendingIce.shift();
  }

  private async flushIce(peer: MeshPeer) {
    const pending = peer.pendingIce.splice(0);

    for (const candidate of pending) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch {
        // ของข้อเสนอที่ถูกม้วน/เมินไปแล้ว — ใช้ไม่ได้จริง ทิ้งได้
      }
    }
  }

  /// ส่งแทร็กใหม่ให้ทุกสาย (กล้อง · จอ) — `negotiationneeded` จะยื่นข้อเสนอให้เอง
  addTrack(track: MediaStreamTrack, stream: MediaStream) {
    for (const peer of this.peers.values()) peer.pc.addTrack(track, stream);
  }

  /// ถอนแทร็กออกจากทุกสาย — แค่ `track.stop()` ไม่พอ ผู้ชมจะค้างเฟรมสุดท้าย
  /// เพราะ sender ยังอยู่และ SDP ยังบอกว่ามีช่องวิดีโอ
  removeTracks(tracks: readonly MediaStreamTrack[]) {
    const ids = new Set(tracks.map((track) => track.id));

    for (const peer of this.peers.values()) {
      for (const sender of peer.pc.getSenders()) {
        if (sender.track && ids.has(sender.track.id)) peer.pc.removeTrack(sender);
      }
    }
  }

  /// เปลี่ยนอุปกรณ์กลางสาย — `replaceTrack` ไม่ต้องเจรจาใหม่ อีกฝ่ายไม่สะดุด
  async replaceTrack(old: readonly MediaStreamTrack[], next: MediaStreamTrack) {
    const ids = new Set(old.map((track) => track.id));

    await Promise.all(
      [...this.peers.values()].flatMap((peer) =>
        peer.pc
          .getSenders()
          .filter((sender) => sender.track && ids.has(sender.track.id))
          .map((sender) => sender.replaceTrack(next)),
      ),
    );
  }

  /// ประกาศ id ของสตรีมกล้อง/จอของเราให้ทุกคน
  broadcastState() {
    const message = encodeMediaState(this.options.localState());

    for (const peer of this.peers.values()) {
      if (peer.channel?.readyState !== 'open') continue;

      try {
        peer.channel.send(message);
      } catch {
        // ช่องปิดไประหว่างทาง — สายนั้นกำลังจะถูกถอดอยู่แล้ว
      }
    }
  }

  /// ภาพกล้อง/จอที่กำลังวิ่งมาจากคนหนึ่งคน
  ///
  /// `holdsScreen` = เขาถือสิทธิ์แชร์จอของห้องอยู่ ใช้เดาตอนเขายังไม่ได้ประกาศ
  media(peer: MeshPeer, holdsScreen: boolean): PeerMedia {
    const live = [...peer.videos.values()].filter((stream) =>
      stream.getVideoTracks().some((track) => track.readyState !== 'ended' && !track.muted),
    );

    return classifyVideo(live, peer.remote, holdsScreen);
  }

  private openStateChannel(peer: MeshPeer) {
    if (peer.polite || peer.channel || typeof peer.pc.createDataChannel !== 'function') return;

    this.attachChannel(peer, peer.pc.createDataChannel('csmju-media'));
  }

  private attachChannel(peer: MeshPeer, channel: RTCDataChannel) {
    peer.channel = channel;

    channel.onopen = () => {
      try {
        channel.send(encodeMediaState(this.options.localState()));
      } catch {
        // ปิดไปก่อนส่งทัน
      }
    };

    channel.onmessage = (event) => {
      const state = decodeMediaState(event.data);

      if (!state) return;

      peer.remote = state;
      this.options.onChange();
    };

    channel.onclose = () => {
      if (peer.channel === channel) peer.channel = null;
    };
  }

  private handleTrack(peer: MeshPeer, event: RTCTrackEvent) {
    const [stream] = event.streams;
    const track = event.track;
    const refresh = () => this.options.onChange();

    if (track.kind === 'audio') {
      peer.audio = stream ?? newStream([track]);
      refresh();

      return;
    }

    const target = stream ?? newStream([track]);

    if (!target) return;

    peer.videos.set(target.id, target);

    // อีกฝ่ายหยุดกล้อง/แชร์ = ได้ `mute` ก่อนแล้วค่อย `removetrack` — ดักทั้งคู่
    // เพราะเบราว์เซอร์ยิงไม่เหมือนกัน · `unmute` = ภาพกลับมาวิ่งอีก
    track.addEventListener('mute', refresh);
    track.addEventListener('unmute', refresh);
    track.addEventListener('ended', refresh);
    target.addEventListener('removetrack', () => {
      if (target.getVideoTracks().length === 0) peer.videos.delete(target.id);

      refresh();
    });

    refresh();
  }
}
