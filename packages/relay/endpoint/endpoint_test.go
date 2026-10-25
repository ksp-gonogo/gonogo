package main

import (
	"encoding/binary"
	"encoding/json"
	"net"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

const wait = 10 * time.Second

func startEndpoint(t *testing.T, cfg Config) (*Endpoint, string) {
	t.Helper()
	udp, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	tcp, err := net.Listen("tcp4", udp.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	cfg.LANIP = "127.0.0.1"
	cfg.includeLoopback = true
	e, err := New(cfg, udp, tcp)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(e.Handler())
	t.Cleanup(func() {
		srv.Close()
		e.Close()
	})
	return e, "ws" + strings.TrimPrefix(srv.URL, "http") + "/stations"
}

type fakeTab struct {
	t    *testing.T
	conn *websocket.Conn
	text chan map[string]any
	data chan []byte
	done chan struct{}
}

func dialTab(t *testing.T, url string) *fakeTab {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	tb := &fakeTab{t: t, conn: conn, text: make(chan map[string]any, 32), data: make(chan []byte, 32), done: make(chan struct{})}
	go func() {
		defer close(tb.done)
		for {
			kind, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if kind == websocket.TextMessage {
				var m map[string]any
				_ = json.Unmarshal(msg, &m)
				tb.text <- m
			} else {
				tb.data <- msg
			}
		}
	}()
	t.Cleanup(func() { conn.Close() })
	if got := tb.next("status"); got["port"] == nil {
		t.Fatalf("status frame has no port: %v", got)
	}
	return tb
}

func (tb *fakeTab) send(m map[string]any) {
	tb.t.Helper()
	if err := tb.conn.WriteJSON(m); err != nil {
		tb.t.Fatal(err)
	}
}

func (tb *fakeTab) sendData(sid uint32, payload []byte) {
	tb.t.Helper()
	frame := make([]byte, 4+len(payload))
	binary.BigEndian.PutUint32(frame, sid)
	copy(frame[4:], payload)
	if err := tb.conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		tb.t.Fatal(err)
	}
}

// next returns the next control frame of the given type, failing on any other type first.
func (tb *fakeTab) next(kind string) map[string]any {
	tb.t.Helper()
	select {
	case m := <-tb.text:
		if m["type"] != kind {
			tb.t.Fatalf("wanted a %q frame, got %v", kind, m)
		}
		return m
	case <-time.After(wait):
		tb.t.Fatalf("no %q frame within %s", kind, wait)
	}
	return nil
}

func (tb *fakeTab) nextData() (uint32, string) {
	tb.t.Helper()
	select {
	case f := <-tb.data:
		return binary.BigEndian.Uint32(f), string(f[4:])
	case <-time.After(wait):
		tb.t.Fatalf("no data frame within %s", wait)
	}
	return 0, ""
}

type station struct {
	pc       *webrtc.PeerConnection
	dc       *webrtc.DataChannel
	open     chan struct{}
	closed   chan struct{}
	received chan string
}

func newStation(t *testing.T, networks ...webrtc.NetworkType) *station {
	t.Helper()
	se := webrtc.SettingEngine{}
	se.SetIncludeLoopbackCandidate(true)
	if len(networks) > 0 {
		se.SetNetworkTypes(networks)
	}
	pc, err := webrtc.NewAPI(webrtc.WithSettingEngine(se)).NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pc.Close() })
	dc, err := pc.CreateDataChannel("gonogo", nil)
	if err != nil {
		t.Fatal(err)
	}
	s := &station{pc: pc, dc: dc, open: make(chan struct{}), closed: make(chan struct{}), received: make(chan string, 32)}
	dc.OnOpen(func() { close(s.open) })
	dc.OnClose(func() { close(s.closed) })
	dc.OnMessage(func(m webrtc.DataChannelMessage) { s.received <- string(m.Data) })
	return s
}

func (s *station) offer(t *testing.T) string {
	t.Helper()
	offer, err := s.pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.pc.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	return offer.SDP
}

func (s *station) answer(t *testing.T, sdp string) {
	t.Helper()
	if err := s.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: sdp}); err != nil {
		t.Fatal(err)
	}
}

func waitFor(t *testing.T, ch <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(wait):
		t.Fatalf("%s did not happen within %s", what, wait)
	}
}

func (s *station) nextMessage(t *testing.T) string {
	t.Helper()
	select {
	case m := <-s.received:
		return m
	case <-time.After(wait):
		t.Fatalf("station received nothing within %s", wait)
	}
	return ""
}

// join takes a station through offer, answer and the open frame for sid.
func join(t *testing.T, tb *fakeTab, s *station, sid uint32, peerID string) {
	t.Helper()
	tb.send(map[string]any{"type": "offer", "sid": sid, "peerId": peerID, "sdp": s.offer(t)})
	ans := tb.next("answer")
	if uint32(ans["sid"].(float64)) != sid {
		t.Fatalf("answer for sid %v, wanted %d", ans["sid"], sid)
	}
	s.answer(t, ans["sdp"].(string))
	waitFor(t, s.open, "the station's data channel opening")
	got := tb.next("open")
	if uint32(got["sid"].(float64)) != sid {
		t.Fatalf("open for sid %v, wanted %d", got["sid"], sid)
	}
	if got["path"] != "lan" {
		t.Fatalf("a station on loopback joined with path %v, wanted lan", got["path"])
	}
}

func TestTwoStationsAtOnceEachGetTheirOwnMessages(t *testing.T) {
	_, url := startEndpoint(t, Config{})
	tb := dialTab(t, url)
	a, b := newStation(t), newStation(t)
	join(t, tb, a, 1, "station-a")
	join(t, tb, b, 2, "station-b")

	if err := a.dc.SendText("from a"); err != nil {
		t.Fatal(err)
	}
	if sid, msg := tb.nextData(); sid != 1 || msg != "from a" {
		t.Fatalf("tab got sid %d %q, wanted sid 1 \"from a\"", sid, msg)
	}
	if err := b.dc.SendText("from b"); err != nil {
		t.Fatal(err)
	}
	if sid, msg := tb.nextData(); sid != 2 || msg != "from b" {
		t.Fatalf("tab got sid %d %q, wanted sid 2 \"from b\"", sid, msg)
	}

	tb.sendData(2, []byte("to b"))
	tb.sendData(1, []byte("to a"))
	if got := a.nextMessage(t); got != "to a" {
		t.Fatalf("station a got %q", got)
	}
	if got := b.nextMessage(t); got != "to b" {
		t.Fatalf("station b got %q", got)
	}
}

func TestAStationJoinsOverTCPWhenTheAnswerOffersNoUDP(t *testing.T) {
	_, url := startEndpoint(t, Config{OmitUDP: true})
	tb := dialTab(t, url)
	s := newStation(t, webrtc.NetworkTypeTCP4)
	join(t, tb, s, 7, "station-tcp")
	pair, err := s.pc.SCTP().Transport().ICETransport().GetSelectedCandidatePair()
	if err != nil || pair == nil {
		t.Fatalf("no selected pair: %v", err)
	}
	if pair.Remote.Protocol != webrtc.ICEProtocolTCP {
		t.Fatalf("pair is %s, wanted tcp", pair.Remote.Protocol)
	}
	if err := s.dc.SendText("over tcp"); err != nil {
		t.Fatal(err)
	}
	if sid, msg := tb.nextData(); sid != 7 || msg != "over tcp" {
		t.Fatalf("tab got sid %d %q", sid, msg)
	}
}

func TestAnOfferBeyondThePendingCapIsRefusedAsBusy(t *testing.T) {
	_, url := startEndpoint(t, Config{MaxPending: 1})
	tb := dialTab(t, url)
	tb.send(map[string]any{"type": "offer", "sid": 1, "peerId": "a", "sdp": newStation(t).offer(t)})
	tb.next("answer")
	tb.send(map[string]any{"type": "offer", "sid": 2, "peerId": "b", "sdp": newStation(t).offer(t)})
	got := tb.next("close")
	if uint32(got["sid"].(float64)) != 2 || got["reason"] != "busy" {
		t.Fatalf("got %v, wanted close sid 2 busy", got)
	}
}

func TestASessionThatNeverOpensIsDroppedAfterThePendingTimeout(t *testing.T) {
	_, url := startEndpoint(t, Config{PendingTimeout: 200 * time.Millisecond})
	tb := dialTab(t, url)
	tb.send(map[string]any{"type": "offer", "sid": 3, "peerId": "a", "sdp": newStation(t).offer(t)})
	tb.next("answer")
	got := tb.next("close")
	if uint32(got["sid"].(float64)) != 3 || got["reason"] != "timeout" {
		t.Fatalf("got %v, wanted close sid 3 timeout", got)
	}
}

func TestASidAlreadyInUseIsRefused(t *testing.T) {
	_, url := startEndpoint(t, Config{})
	tb := dialTab(t, url)
	tb.send(map[string]any{"type": "offer", "sid": 4, "peerId": "a", "sdp": newStation(t).offer(t)})
	tb.next("answer")
	tb.send(map[string]any{"type": "offer", "sid": 4, "peerId": "b", "sdp": newStation(t).offer(t)})
	got := tb.next("close")
	if got["reason"] != "sid in use" {
		t.Fatalf("got %v", got)
	}
}

func TestTheTabClosingASessionClosesTheStation(t *testing.T) {
	_, url := startEndpoint(t, Config{})
	tb := dialTab(t, url)
	s := newStation(t)
	join(t, tb, s, 5, "station-a")
	tb.send(map[string]any{"type": "close", "sid": 5})
	waitFor(t, s.closed, "the station's data channel closing")
}

func TestASecondTabReplacesTheFirstAndDropsItsStations(t *testing.T) {
	_, url := startEndpoint(t, Config{})
	first := dialTab(t, url)
	s := newStation(t)
	join(t, first, s, 1, "station-a")
	dialTab(t, url)
	waitFor(t, first.done, "the first tab's socket closing")
	waitFor(t, s.closed, "the first tab's station closing")
}

func TestTheStationClosingTellsTheTab(t *testing.T) {
	_, url := startEndpoint(t, Config{})
	tb := dialTab(t, url)
	s := newStation(t)
	join(t, tb, s, 9, "station-a")
	s.pc.Close()
	got := tb.next("close")
	if uint32(got["sid"].(float64)) != 9 {
		t.Fatalf("got %v", got)
	}
}

func TestTheAnswerNamesThePublicAndLANAddressesOnOnePort(t *testing.T) {
	sdp := "v=0\r\na=ice-ufrag:abcd\r\na=candidate:1 1 udp 2130706431 198.51.100.2 47100 typ host\r\na=candidate:2 1 tcp 1671430143 198.51.100.2 47100 typ host tcptype passive\r\na=end-of-candidates\r\n"
	got := withCandidates(sdp, "203.0.113.7", "198.51.100.20", 47100, false)
	for _, want := range []string{
		"udp 1694498815 203.0.113.7 47100 typ srflx",
		"tcp 1518280447 203.0.113.7 47100 typ srflx raddr 0.0.0.0 rport 47100 tcptype passive",
		"udp 2130706430 198.51.100.20 47100 typ host",
		"tcp 1671430142 198.51.100.20 47100 typ host tcptype passive",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("answer lacks %q:\n%s", want, got)
		}
	}
	if !strings.HasSuffix(got, "a=end-of-candidates\r\n") {
		t.Errorf("the added lines must come before end-of-candidates:\n%s", got)
	}

	tcpOnly := withCandidates(sdp, "203.0.113.7", "198.51.100.20", 47100, true)
	if strings.Contains(tcpOnly, " udp ") {
		t.Errorf("an answer without UDP still names a UDP candidate:\n%s", tcpOnly)
	}
}
