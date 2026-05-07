// Side-effect module. Must be imported before anything that pulls in peerjs
// or webrtc-adapter — both sniff global WebRTC constructors at their own
// module-load time, and ES import hoisting means a deferred function call
// from index.ts would run too late.
import wrtc from "@roamhq/wrtc";

type Globalish = typeof globalThis & Record<string, unknown>;

function install(): void {
  const g = globalThis as Globalish;
  if (!g.RTCPeerConnection) g.RTCPeerConnection = wrtc.RTCPeerConnection;
  if (!g.RTCSessionDescription)
    g.RTCSessionDescription = wrtc.RTCSessionDescription;
  if (!g.RTCIceCandidate) g.RTCIceCandidate = wrtc.RTCIceCandidate;
  if (!g.MediaStream) g.MediaStream = wrtc.MediaStream;
  if (!g.MediaStreamTrack) g.MediaStreamTrack = wrtc.MediaStreamTrack;
}

install();
