package main

import (
	"sync"
	"testing"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// fakeSidecar answers an offer the way a camera sidecar does: one video track per offered
// video section, each sending packets whose first payload byte names the track, and an echo
// on any data channel the other side opens.
type fakeSidecar struct {
	pc     *webrtc.PeerConnection
	tracks []*webrtc.TrackLocalStaticRTP
	plis   chan uint32
	heard  chan string
	stop   chan struct{}
}

func newSidecar(t *testing.T, cameras int) *fakeSidecar {
	t.Helper()
	se := webrtc.SettingEngine{}
	se.SetIncludeLoopbackCandidate(true)
	pc, err := webrtc.NewAPI(webrtc.WithSettingEngine(se)).NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	s := &fakeSidecar{pc: pc, plis: make(chan uint32, 16), heard: make(chan string, 16), stop: make(chan struct{})}
	t.Cleanup(func() {
		close(s.stop)
		pc.Close()
	})
	for i := 0; i < cameras; i++ {
		track, err := webrtc.NewTrackLocalStaticRTP(
			webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000, SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"},
			"camera", "sidecar")
		if err != nil {
			t.Fatal(err)
		}
		sender, err := pc.AddTrack(track)
		if err != nil {
			t.Fatal(err)
		}
		s.tracks = append(s.tracks, track)
		go func() {
			for {
				pkts, _, err := sender.ReadRTCP()
				if err != nil {
					return
				}
				for _, p := range pkts {
					if pli, ok := p.(*rtcp.PictureLossIndication); ok {
						s.plis <- pli.MediaSSRC
					}
				}
			}
		}()
	}
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		dc.OnOpen(func() { _ = dc.SendText("hello from sidecar") })
		dc.OnMessage(func(m webrtc.DataChannelMessage) { s.heard <- dc.Label() + ":" + string(m.Data) })
	})
	return s
}

func (s *fakeSidecar) answer(t *testing.T, offer string) string {
	t.Helper()
	if err := s.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offer}); err != nil {
		t.Fatal(err)
	}
	answer, err := s.pc.CreateAnswer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(s.pc)
	if err := s.pc.SetLocalDescription(answer); err != nil {
		t.Fatal(err)
	}
	<-gathered
	go func() {
		seq := uint16(0)
		for {
			select {
			case <-s.stop:
				return
			case <-time.After(20 * time.Millisecond):
			}
			seq++
			for i, track := range s.tracks {
				_ = track.WriteRTP(&rtp.Packet{
					Header:  rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: uint32(seq) * 3000, Marker: true},
					Payload: []byte{byte(i), 0x65},
				})
			}
		}
	}()
	return s.pc.LocalDescription().SDP
}

// mediaStation is a station's camera connection: recvonly video sections and a control channel.
type mediaStation struct {
	pc      *webrtc.PeerConnection
	dc      *webrtc.DataChannel
	mu      sync.Mutex
	byMid   map[string]byte
	tracks  map[string]*webrtc.TrackRemote
	got     chan string
	trackIn chan string
}

func newMediaStation(t *testing.T, cameras int) *mediaStation {
	t.Helper()
	se := webrtc.SettingEngine{}
	se.SetIncludeLoopbackCandidate(true)
	pc, err := webrtc.NewAPI(webrtc.WithSettingEngine(se)).NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pc.Close() })
	m := &mediaStation{pc: pc, byMid: map[string]byte{}, tracks: map[string]*webrtc.TrackRemote{}, got: make(chan string, 16), trackIn: make(chan string, 16)}
	for i := 0; i < cameras; i++ {
		if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
			t.Fatal(err)
		}
	}
	dc, err := pc.CreateDataChannel("control", nil)
	if err != nil {
		t.Fatal(err)
	}
	m.dc = dc
	dc.OnMessage(func(msg webrtc.DataChannelMessage) { m.got <- string(msg.Data) })
	pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		mid := receiver.RTPTransceiver().Mid()
		pkt, _, err := track.ReadRTP()
		if err != nil {
			return
		}
		m.mu.Lock()
		m.byMid[mid] = pkt.Payload[0]
		m.tracks[mid] = track
		m.mu.Unlock()
		m.trackIn <- mid
		for {
			if _, _, err := track.ReadRTP(); err != nil {
				return
			}
		}
	})
	return m
}

func (m *mediaStation) offer(t *testing.T) string {
	t.Helper()
	offer, err := m.pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.pc.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	return offer.SDP
}

// bridgeThrough asks the endpoint to bridge a station's camera offer to the sidecar, playing
// the main screen's part: the sidecar answers the endpoint's offer, and the station gets the
// endpoint's answer.
func bridgeThrough(t *testing.T, tb *fakeTab, sid, bid uint32, m *mediaStation, side *fakeSidecar) {
	t.Helper()
	tb.send(map[string]any{"type": "bridge", "sid": sid, "bid": bid, "sdp": m.offer(t)})
	up := tb.next("bridge-offer")
	if uint32(up["bid"].(float64)) != bid {
		t.Fatalf("bridge-offer for %v, wanted %d", up["bid"], bid)
	}
	tb.send(map[string]any{"type": "bridge-answer", "bid": bid, "sdp": side.answer(t, up["sdp"].(string))})
	ready := tb.next("bridge-ready")
	if err := m.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: ready["sdp"].(string)}); err != nil {
		t.Fatal(err)
	}
}

func joinedStation(t *testing.T) (*fakeTab, *station) {
	t.Helper()
	_, url := startEndpoint(t, Config{})
	tb := dialTab(t, url)
	s := newStation(t)
	join(t, tb, s, 1, "station-a")
	return tb, s
}

func TestABridgedCameraReachesTheStationOnItsOwnMid(t *testing.T) {
	tb, _ := joinedStation(t)
	side := newSidecar(t, 2)
	m := newMediaStation(t, 2)
	bridgeThrough(t, tb, 1, 1, m, side)

	for i := 0; i < 2; i++ {
		select {
		case <-m.trackIn:
		case <-time.After(wait):
			t.Fatalf("only %d of 2 cameras reached the station", i)
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	mids := m.pc.GetTransceivers()
	for i, tr := range mids[:2] {
		if got := m.byMid[tr.Mid()]; got != byte(i) {
			t.Errorf("the station's mid %s carries camera %d, wanted %d", tr.Mid(), got, i)
		}
	}
}

func TestABridgeCarriesTheControlChannelBothWays(t *testing.T) {
	tb, _ := joinedStation(t)
	side := newSidecar(t, 1)
	m := newMediaStation(t, 1)
	opened := make(chan struct{})
	m.dc.OnOpen(func() { close(opened) })
	bridgeThrough(t, tb, 1, 1, m, side)
	waitFor(t, opened, "the station's control channel opening")

	select {
	case got := <-m.got:
		if got != "hello from sidecar" {
			t.Fatalf("station got %q", got)
		}
	case <-time.After(wait):
		t.Fatal("the sidecar's hello never reached the station")
	}
	if err := m.dc.SendText("subscribe 3"); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-side.heard:
		if got != "control:subscribe 3" {
			t.Fatalf("sidecar heard %q", got)
		}
	case <-time.After(wait):
		t.Fatal("the station's message never reached the sidecar")
	}
}

func TestAKeyframeRequestFromTheStationReachesTheSidecar(t *testing.T) {
	tb, _ := joinedStation(t)
	side := newSidecar(t, 1)
	m := newMediaStation(t, 1)
	bridgeThrough(t, tb, 1, 1, m, side)
	var mid string
	select {
	case mid = <-m.trackIn:
	case <-time.After(wait):
		t.Fatal("no camera reached the station")
	}
	m.mu.Lock()
	track := m.tracks[mid]
	m.mu.Unlock()
	if err := m.pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(track.SSRC())}}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-side.plis:
	case <-time.After(wait):
		t.Fatal("the keyframe request never reached the sidecar")
	}
}

func TestABridgeIsRefusedForAStationThatHasNotJoined(t *testing.T) {
	_, url := startEndpoint(t, Config{})
	tb := dialTab(t, url)
	m := newMediaStation(t, 1)
	tb.send(map[string]any{"type": "bridge", "sid": 42, "bid": 7, "sdp": m.offer(t)})
	got := tb.next("bridge-close")
	if uint32(got["bid"].(float64)) != 7 || got["reason"] != "no such station" {
		t.Fatalf("got %v", got)
	}
}

func TestABridgeClosesWhenItsStationLeaves(t *testing.T) {
	tb, s := joinedStation(t)
	side := newSidecar(t, 1)
	m := newMediaStation(t, 1)
	bridgeThrough(t, tb, 1, 1, m, side)
	s.pc.Close()
	tb.next("close")
	got := tb.next("bridge-close")
	if uint32(got["bid"].(float64)) != 1 {
		t.Fatalf("got %v", got)
	}
}
