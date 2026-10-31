package main

import (
	"bytes"
	"fmt"
	"log"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

const sidecarFmtp = "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"

// browserStation is a station whose offer lists several H.264 formats the way a browser's does, a
// packetization mode 0 one first, then a VP8 format.
type browserStation struct {
	pc    *webrtc.PeerConnection
	codec chan webrtc.RTPCodecParameters
	pt    chan uint8
}

func newBrowserStation(t *testing.T) *browserStation {
	t.Helper()
	me := &webrtc.MediaEngine{}
	feedback := []webrtc.RTCPFeedback{{Type: "nack"}, {Type: "nack", Parameter: "pli"}}
	formats := []struct {
		pt   webrtc.PayloadType
		mime string
		fmtp string
	}{
		{96, webrtc.MimeTypeH264, "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f"},
		{97, webrtc.MimeTypeH264, sidecarFmtp},
		{98, webrtc.MimeTypeH264, "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f"},
		{99, webrtc.MimeTypeH264, "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f"},
		{100, webrtc.MimeTypeVP8, ""},
	}
	for _, f := range formats {
		params := webrtc.RTPCodecParameters{
			RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: f.mime, ClockRate: 90000, SDPFmtpLine: f.fmtp, RTCPFeedback: feedback},
			PayloadType:        f.pt,
		}
		if err := me.RegisterCodec(params, webrtc.RTPCodecTypeVideo); err != nil {
			t.Fatal(err)
		}
	}
	se := webrtc.SettingEngine{}
	se.SetIncludeLoopbackCandidate(true)
	pc, err := webrtc.NewAPI(webrtc.WithSettingEngine(se), webrtc.WithMediaEngine(me)).NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pc.Close() })
	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
		t.Fatal(err)
	}
	if _, err := pc.CreateDataChannel("control", nil); err != nil {
		t.Fatal(err)
	}
	b := &browserStation{pc: pc, codec: make(chan webrtc.RTPCodecParameters, 1), pt: make(chan uint8, 1)}
	pc.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		pkt, _, err := track.ReadRTP()
		if err != nil {
			return
		}
		b.codec <- track.Codec()
		b.pt <- pkt.PayloadType
	})
	return b
}

// syncBuffer is a log destination safe to write from the endpoint's goroutines and read from the test.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

func captureLog(t *testing.T) *syncBuffer {
	t.Helper()
	out := &syncBuffer{}
	prev := log.Writer()
	log.SetOutput(out)
	t.Cleanup(func() { log.SetOutput(prev) })
	return out
}

func TestAStationIsAnsweredWithTheH264FormatTheSidecarSends(t *testing.T) {
	logs := captureLog(t)
	tb, _ := joinedStation(t)
	side := newSidecar(t, 1)
	st := newBrowserStation(t)

	offer, err := st.pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.pc.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	tb.send(map[string]any{"type": "bridge", "sid": 1, "bid": 1, "sdp": offer.SDP})
	up := tb.next("bridge-offer")
	tb.send(map[string]any{"type": "bridge-answer", "bid": 1, "sdp": side.answer(t, up["sdp"].(string))})
	ready := tb.next("bridge-ready")
	answer := ready["sdp"].(string)
	if err := st.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answer}); err != nil {
		t.Fatal(err)
	}

	var desc sdp.SessionDescription
	if err := desc.Unmarshal([]byte(answer)); err != nil {
		t.Fatal(err)
	}
	var video *sdp.MediaDescription
	for _, md := range desc.MediaDescriptions {
		if md.MediaName.Media == "video" {
			video = md
		}
	}
	if video == nil {
		t.Fatal("the answer has no video section")
	}
	if len(video.MediaName.Formats) != 1 {
		t.Errorf("the station is answered with formats %v, wanted only the one the sidecar sends", video.MediaName.Formats)
	}

	select {
	case codec := <-st.codec:
		pt := <-st.pt
		if codec.MimeType != webrtc.MimeTypeH264 || codec.SDPFmtpLine != sidecarFmtp {
			t.Errorf("the station's track is %s with fmtp %q, wanted H264 with %q", codec.MimeType, codec.SDPFmtpLine, sidecarFmtp)
		}
		if pt != uint8(codec.PayloadType) {
			t.Errorf("packets arrive on payload type %d, the track's format is %d", pt, codec.PayloadType)
		}
	case <-time.After(wait):
		t.Fatal("no packet reached the station")
	}

	for _, want := range []string{"upstream answered video/H264/90000", "upstream sends payload type", "station answered", sidecarFmtp} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("the log has no %q:\n%s", want, logs.String())
		}
	}
}

func TestAnAnswerNamesTheMediaCodecAndItsFeedback(t *testing.T) {
	answer := strings.Join([]string{
		"v=0", "o=- 1 1 IN IP4 0.0.0.0", "s=-", "t=0 0",
		"m=video 9 UDP/TLS/RTP/SAVPF 97 96",
		"a=mid:1",
		"a=rtpmap:97 rtx/90000",
		"a=fmtp:97 apt=96",
		"a=rtpmap:96 H264/90000",
		"a=fmtp:96 " + sidecarFmtp,
		"a=rtcp-fb:96 nack",
		"a=rtcp-fb:96 nack pli",
		"",
	}, "\r\n")
	codecs, err := answeredCodecs(answer)
	if err != nil {
		t.Fatal(err)
	}
	got := codecs["1"]
	if got.MimeType != "video/H264" || got.ClockRate != 90000 || got.SDPFmtpLine != sidecarFmtp {
		t.Errorf("the codec is %+v", got)
	}
	if len(got.RTCPFeedback) != 2 || got.RTCPFeedback[1].Type != "nack" || got.RTCPFeedback[1].Parameter != "pli" {
		t.Errorf("the feedback is %+v", got.RTCPFeedback)
	}
}

func TestABridgeLogsItsLegsAndWhyItClosed(t *testing.T) {
	logs := captureLog(t)
	tb, _ := joinedStationWith(t, Config{HeartbeatInterval: 100 * time.Millisecond})
	side := newSidecar(t, 1)
	st := newBrowserStation(t)

	offer, err := st.pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.pc.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	tb.send(map[string]any{"type": "bridge", "sid": 1, "bid": 1, "sdp": offer.SDP})
	up := tb.next("bridge-offer")
	tb.send(map[string]any{"type": "bridge-answer", "bid": 1, "sdp": side.answer(t, up["sdp"].(string))})
	ready := tb.next("bridge-ready")
	if err := st.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: ready["sdp"].(string)}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-st.codec:
	case <-time.After(wait):
		t.Fatal("no packet reached the station")
	}

	waitFor := func(want string) {
		t.Helper()
		deadline := time.Now().Add(wait)
		for !strings.Contains(logs.String(), want) {
			if time.Now().After(deadline) {
				t.Fatalf("the log has no %q:\n%s", want, logs.String())
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	waitFor("bridge 1 upstream leg ice connected, pair ")
	waitFor("bridge 1 station leg ice connected, pair ")
	waitFor("bridge 1 station leg connection connected")
	waitFor("bridge 1 heartbeat: upstream read ")
	waitFor("station wrote ")

	tb.send(map[string]any{"type": "bridge-close", "bid": 1})
	waitFor("bridge 1 closed: the main screen asked")
}

func TestTheUpstreamOfferCarriesOnlyTheConstrainedBaselineFormat(t *testing.T) {
	tb, _ := joinedStation(t)
	st := newBrowserStation(t)
	offer, err := st.pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.pc.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	tb.send(map[string]any{"type": "bridge", "sid": 1, "bid": 1, "sdp": offer.SDP})
	up := tb.next("bridge-offer")

	var desc sdp.SessionDescription
	if err := desc.Unmarshal([]byte(up["sdp"].(string))); err != nil {
		t.Fatal(err)
	}
	videos := 0
	for _, md := range desc.MediaDescriptions {
		if md.MediaName.Media != "video" {
			continue
		}
		videos++
		var h264 []string
		for _, a := range md.Attributes {
			if a.Key == "rtpmap" && !strings.Contains(a.Value, "H264/90000") {
				t.Errorf("the upstream offer lists %q, wanted H264 only", a.Value)
			}
			if a.Key == "fmtp" {
				h264 = append(h264, a.Value)
			}
		}
		if len(md.MediaName.Formats) != 1 || len(h264) != 1 || !strings.HasSuffix(h264[0], sidecarFmtp) {
			t.Errorf("the upstream offer lists formats %v with fmtp %v, wanted the one with %q", md.MediaName.Formats, h264, sidecarFmtp)
		}
	}
	if videos == 0 {
		t.Fatal("the upstream offer has no video section")
	}
}

func waitForLog(t *testing.T, logs *syncBuffer, want string) {
	t.Helper()
	deadline := time.Now().Add(wait)
	for !strings.Contains(logs.String(), want) {
		if time.Now().After(deadline) {
			t.Fatalf("the log has no %q:\n%s", want, logs.String())
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestABridgeStopsLoggingWhenTheMainScreenLeaves(t *testing.T) {
	logs := captureLog(t)
	tb, _ := joinedStationWith(t, Config{HeartbeatInterval: 50 * time.Millisecond})
	bridgeThrough(t, tb, 1, 1, newMediaStation(t, 1), newSidecar(t, 1))
	waitForLog(t, logs, "bridge 1 heartbeat:")

	tb.conn.Close()
	waitForLog(t, logs, "bridge 1 closed: the main screen left")
	time.Sleep(200 * time.Millisecond)
	settled := strings.Count(logs.String(), "bridge 1 heartbeat:")
	time.Sleep(400 * time.Millisecond)
	if after := strings.Count(logs.String(), "bridge 1 heartbeat:"); after != settled {
		t.Errorf("a closed bridge logged %d more heartbeat lines", after-settled)
	}
}

func TestEachBridgeOfAnEndpointHasItsOwnNumberInTheLog(t *testing.T) {
	logs := captureLog(t)
	_, url := startEndpoint(t, Config{})
	for round := 1; round <= 2; round++ {
		tb := dialTab(t, url)
		join(t, tb, newStation(t), 1, "station-a")
		bridgeThrough(t, tb, 1, 1, newMediaStation(t, 1), newSidecar(t, 1))
		waitForLog(t, logs, fmt.Sprintf("bridge %d for session 1 ready", round))
		tb.conn.Close()
		waitForLog(t, logs, fmt.Sprintf("bridge %d closed: the main screen left", round))
	}
	for _, want := range []string{"bridge 1 is bid 1 of session 1", "bridge 2 is bid 1 of session 1"} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("the log has no %q:\n%s", want, logs.String())
		}
	}
}
