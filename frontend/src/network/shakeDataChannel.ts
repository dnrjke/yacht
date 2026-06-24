import { Socket } from 'socket.io-client';
import { pushShakeFrame } from './shakeBuffer';
import { pushDebugLog } from '../components/ui/DebugOverlay';

const SHAKE_FRAME_MSG = 0x01;
const FRAME_BYTES = 172;
const SETUP_TIMEOUT_MS = 5000;

let pc: RTCPeerConnection | null = null;
let dc: RTCDataChannel | null = null;
let transport: 'socketio' | 'webrtc' = 'socketio';
let setupTimer: ReturnType<typeof setTimeout> | null = null;
let boundSocket: Socket | null = null;

export function getActiveTransport(): 'socketio' | 'webrtc' {
  return transport;
}

export function initShakeDataChannel(socket: Socket, role: 'p1' | 'p2'): void {
  if (pc) closeShakeDataChannel();
  boundSocket = socket;

  try {
    pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
  } catch {
    pushDebugLog('DC_INIT_FAIL', { reason: 'RTCPeerConnection unavailable' });
    return;
  }

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit('DC_ICE', {
        candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid ?? '0',
      });
    }
  };

  socket.on('DC_ICE', (data: { candidate: string; sdpMid?: string }) => {
    if (!pc) return;
    pc.addIceCandidate(new RTCIceCandidate({
      candidate: data.candidate,
      sdpMid: data.sdpMid ?? '0',
    })).catch(() => {});
  });

  if (role === 'p1') {
    dc = pc.createDataChannel('shake', {
      ordered: false,
      maxRetransmits: 0,
    });
    dc.binaryType = 'arraybuffer';
    setupDCHandlers(dc);

    pc.createOffer()
      .then((offer) => pc!.setLocalDescription(offer))
      .then(() => {
        socket.emit('DC_OFFER', { sdp: pc!.localDescription!.sdp });
      })
      .catch(() => {
        pushDebugLog('DC_OFFER_FAIL', {});
      });

    socket.on('DC_ANSWER', (data: { sdp: string }) => {
      if (!pc) return;
      pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }))
        .catch(() => {});
    });
  } else {
    pc.ondatachannel = (ev) => {
      dc = ev.channel;
      dc.binaryType = 'arraybuffer';
      setupDCHandlers(dc);
    };

    socket.on('DC_OFFER', (data: { sdp: string }) => {
      if (!pc) return;
      pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }))
        .then(() => pc!.createAnswer())
        .then((answer) => pc!.setLocalDescription(answer))
        .then(() => {
          socket.emit('DC_ANSWER', { sdp: pc!.localDescription!.sdp });
        })
        .catch(() => {
          pushDebugLog('DC_ANSWER_FAIL', {});
        });
    });
  }

  setupTimer = setTimeout(() => {
    setupTimer = null;
    if (transport !== 'webrtc') {
      pushDebugLog('DC_TIMEOUT', {});
    }
  }, SETUP_TIMEOUT_MS);
}

function setupDCHandlers(channel: RTCDataChannel): void {
  channel.onopen = () => {
    transport = 'webrtc';
    if (setupTimer) { clearTimeout(setupTimer); setupTimer = null; }
    pushDebugLog('DC_OPEN', {});
  };

  channel.onclose = () => {
    transport = 'socketio';
    pushDebugLog('DC_CLOSE', {});
  };

  channel.onerror = () => {
    transport = 'socketio';
  };

  channel.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      handleIncomingBinary(ev.data);
    }
  };
}

function handleIncomingBinary(data: ArrayBuffer): void {
  if (data.byteLength < FRAME_BYTES) return;
  const view = new DataView(data);
  if (view.getUint8(0) !== SHAKE_FRAME_MSG) return;

  const seq = view.getUint16(1, false);
  const cupPosition = {
    x: view.getFloat32(4, false),
    y: view.getFloat32(8, false),
    z: view.getFloat32(12, false),
  };
  const cupQuaternion = {
    x: view.getFloat32(16, false),
    y: view.getFloat32(20, false),
    z: view.getFloat32(24, false),
    w: view.getFloat32(28, false),
  };
  const diceStates = [];
  for (let i = 0; i < 5; i++) {
    const base = 32 + i * 28;
    diceStates.push({
      position: {
        x: view.getFloat32(base, false),
        y: view.getFloat32(base + 4, false),
        z: view.getFloat32(base + 8, false),
      },
      quaternion: {
        x: view.getFloat32(base + 12, false),
        y: view.getFloat32(base + 16, false),
        z: view.getFloat32(base + 20, false),
        w: view.getFloat32(base + 24, false),
      },
    });
  }

  pushShakeFrame({ cupPosition, cupQuaternion, diceStates, seq });
}

export function sendShakeFrame(
  seq: number,
  turnNumber: number,
  cupPosition: { x: number; y: number; z: number },
  cupQuaternion: { x: number; y: number; z: number; w: number },
  diceStates: Array<{
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
  }>,
): boolean {
  if (!dc || dc.readyState !== 'open') return false;

  const buf = new ArrayBuffer(FRAME_BYTES);
  const view = new DataView(buf);

  view.setUint8(0, SHAKE_FRAME_MSG);
  view.setUint16(1, seq & 0xFFFF, false);
  view.setUint8(3, turnNumber & 0xFF);

  view.setFloat32(4, cupPosition.x, false);
  view.setFloat32(8, cupPosition.y, false);
  view.setFloat32(12, cupPosition.z, false);
  view.setFloat32(16, cupQuaternion.x, false);
  view.setFloat32(20, cupQuaternion.y, false);
  view.setFloat32(24, cupQuaternion.z, false);
  view.setFloat32(28, cupQuaternion.w, false);

  for (let i = 0; i < 5; i++) {
    const base = 32 + i * 28;
    const d = diceStates[i];
    view.setFloat32(base, d.position.x, false);
    view.setFloat32(base + 4, d.position.y, false);
    view.setFloat32(base + 8, d.position.z, false);
    view.setFloat32(base + 12, d.quaternion.x, false);
    view.setFloat32(base + 16, d.quaternion.y, false);
    view.setFloat32(base + 20, d.quaternion.z, false);
    view.setFloat32(base + 24, d.quaternion.w, false);
  }

  try {
    dc.send(buf);
    return true;
  } catch {
    return false;
  }
}

export function closeShakeDataChannel(): void {
  if (setupTimer) { clearTimeout(setupTimer); setupTimer = null; }
  try { dc?.close(); } catch {}
  try { pc?.close(); } catch {}
  dc = null;
  pc = null;
  transport = 'socketio';
  if (boundSocket) {
    boundSocket.off('DC_ICE');
    boundSocket.off('DC_OFFER');
    boundSocket.off('DC_ANSWER');
    boundSocket = null;
  }
}
