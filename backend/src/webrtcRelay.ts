import { RTCPeerConnection, RTCIceCandidate, RTCDataChannel } from 'werift';

type Role = 'p1' | 'p2';

interface PeerEntry {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
}

interface RoomRelay {
  p1: PeerEntry | null;
  p2: PeerEntry | null;
}

const roomRelays = new Map<string, RoomRelay>();

function getRelay(roomId: string): RoomRelay {
  let relay = roomRelays.get(roomId);
  if (!relay) {
    relay = { p1: null, p2: null };
    roomRelays.set(roomId, relay);
  }
  return relay;
}

function opponentRole(role: Role): Role {
  return role === 'p1' ? 'p2' : 'p1';
}

export async function handleDCOffer(
  roomId: string,
  role: Role,
  sdp: string,
  onIceCandidate: (candidate: { candidate: string; sdpMid: string }) => void,
): Promise<{ sdp: string }> {
  const relay = getRelay(roomId);

  if (relay[role]?.pc) {
    relay[role]!.pc.close();
  }

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  const entry: PeerEntry = { pc, dc: null };
  relay[role] = entry;

  pc.onIceCandidate.subscribe((candidate) => {
    if (!candidate || !candidate.candidate) return;
    onIceCandidate({
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? '0',
    });
  });

  pc.onDataChannel.subscribe((dc) => {
    entry.dc = dc;

    dc.onMessage.subscribe((data: Buffer | string) => {
      const buf = typeof data === 'string' ? Buffer.from(data) : data;
      if (buf.length < 4 || buf[0] !== 0x01) return;

      const opp = relay[opponentRole(role)];
      if (opp?.dc && opp.dc.readyState === 'open') {
        try {
          opp.dc.send(buf);
        } catch {}
      }
    });

    dc.onclose = () => {
      entry.dc = null;
    };
  });

  await pc.setRemoteDescription({ type: 'offer', sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  return { sdp: answer.sdp! };
}

export async function handleDCIce(
  roomId: string,
  role: Role,
  candidate: { candidate: string; sdpMid?: string },
): Promise<void> {
  const relay = roomRelays.get(roomId);
  const entry = relay?.[role];
  if (!entry?.pc) return;

  try {
    await entry.pc.addIceCandidate(
      new RTCIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? '0',
      }),
    );
  } catch {}
}

export function isDCActive(roomId: string): boolean {
  const relay = roomRelays.get(roomId);
  if (!relay) return false;
  return !!(
    relay.p1?.dc?.readyState === 'open' &&
    relay.p2?.dc?.readyState === 'open'
  );
}

export function cleanupRoomRelay(roomId: string): void {
  const relay = roomRelays.get(roomId);
  if (!relay) return;
  try { relay.p1?.dc?.close(); } catch {}
  try { relay.p2?.dc?.close(); } catch {}
  try { relay.p1?.pc.close(); } catch {}
  try { relay.p2?.pc.close(); } catch {}
  roomRelays.delete(roomId);
}
