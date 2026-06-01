// Side-effect module. Must be imported before anything that pulls in peerjs
// or webrtc-adapter — both sniff global WebRTC constructors at their own
// module-load time, so installing them from a deferred function call would
// run too late (ES import hoisting runs this module's body first).
//
// peerjs needs only RTCPeerConnection / RTCSessionDescription /
// RTCIceCandidate to negotiate a DataConnection; the media constructors
// aren't required for the directory's data-only round-trip but are cheap
// to install and keep us aligned with the OCISLY-era pattern.
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
