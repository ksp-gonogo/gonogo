package main

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

func videoFeed(name string, asked *int) *feed {
	return &feed{name: name, kind: webrtc.RTPCodecTypeVideo, write: func(*rtp.Packet) error { return nil }, askKeyframe: func() { *asked++ }}
}

func delta(seq uint16) *rtp.Packet {
	return &rtp.Packet{Header: rtp.Header{SequenceNumber: seq}, Payload: []byte{0x7c, 0x01, 0}}
}

func keyStart(seq uint16) *rtp.Packet {
	return &rtp.Packet{Header: rtp.Header{SequenceNumber: seq}, Payload: []byte{0x7c, 0x85, 0}}
}

func newTestPacer(logs *[]string) *pacer {
	return &pacer{name: "session 1", logf: func(format string, args ...any) {
		*logs = append(*logs, strings.TrimSpace(fmt.Sprintf(format, args...)))
	}}
}

func TestAFeedBroughtBackStartsAtAKeyframeWithNoGapInItsNumbers(t *testing.T) {
	var logs []string
	p := newTestPacer(&logs)
	now := time.Unix(0, 0)
	var asked int
	top, low := videoFeed("bridge 1 section 0", &asked), videoFeed("bridge 1 section 1", &asked)
	p.addFeed(now, top)
	p.addFeed(now, low)
	for seq := uint16(100); seq < 110; seq++ {
		p.packet(now, low, delta(seq))
	}
	p.shed(now, low, 0, "test")
	for seq := uint16(110); seq < 200; seq++ {
		p.packet(now, low, delta(seq))
	}
	now = now.Add(shedHold + probeAfterDown)
	p.look(now, false)
	if low.state != feedResuming || asked != 1 {
		t.Fatalf("after its hold the shed feed is %v with %d keyframe requests, wanted resuming with one", low.state, asked)
	}
	p.packet(now, low, delta(200))
	p.packet(now, low, keyStart(201))
	p.packet(now, low, delta(202))
	var seqs []uint16
	for step := 0; step < 100; step++ {
		out, _, _ := p.pull(now.Add(time.Duration(step)*10*time.Millisecond), 0)
		for _, q := range out {
			if q.f == low {
				seqs = append(seqs, q.pkt.SequenceNumber)
			}
		}
	}
	want := []uint16{100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111}
	if len(seqs) != len(want) {
		t.Fatalf("sent %v, wanted %v", seqs, want)
	}
	for i := range want {
		if seqs[i] != want[i] {
			t.Fatalf("sent %v, wanted %v", seqs, want)
		}
	}
	if !strings.Contains(strings.Join(logs, "\n"), "bridge 1 section 1 restored") {
		t.Errorf("no restore line in %q", logs)
	}
	if p.stats.sheds != 1 || p.stats.restores != 1 {
		t.Errorf("counted %d sheds and %d restores, wanted 1 and 1", p.stats.sheds, p.stats.restores)
	}
}

func TestTheTopRankedFeedIsNeverShed(t *testing.T) {
	var logs []string
	p := newTestPacer(&logs)
	var asked int
	only := videoFeed("bridge 1 section 0", &asked)
	p.addFeed(time.Unix(0, 0), only)
	if p.lowestSheddable() != nil {
		t.Fatal("the only video feed could be shed")
	}
	second := videoFeed("bridge 1 section 1", &asked)
	p.addFeed(time.Unix(0, 0), second)
	if got := p.lowestSheddable(); got != second {
		t.Fatalf("the feed to shed is %v, wanted the one added last", got)
	}
}

func TestAStationsKeyframeRequestsAreHeldForAShedFeedAndKeptToOneASecond(t *testing.T) {
	var logs []string
	p := newTestPacer(&logs)
	now := time.Unix(100, 0)
	var asked int
	f := videoFeed("bridge 1 section 0", &asked)
	p.addFeed(now, f)
	if !p.keyframeRequest(now, f) {
		t.Fatal("the first request was held")
	}
	if p.keyframeRequest(now.Add(500*time.Millisecond), f) {
		t.Fatal("a second request within a second went upstream")
	}
	if !p.keyframeRequest(now.Add(1100*time.Millisecond), f) {
		t.Fatal("a request a second later was held")
	}
	f.state = feedShed
	if p.keyframeRequest(now.Add(5*time.Second), f) {
		t.Fatal("a request for a shed feed went upstream")
	}
	if p.stats.heldKeyframeRequests != 2 {
		t.Errorf("counted %d held requests, wanted 2", p.stats.heldKeyframeRequests)
	}
}

func TestTheDataChannelWaitsForANewFeedsFirstKeyframe(t *testing.T) {
	var logs []string
	p := newTestPacer(&logs)
	now := time.Unix(0, 0)
	var asked int
	f := videoFeed("bridge 1 section 0", &asked)
	p.addFeed(now, f)
	p.pushData(now, []byte("snapshot"))
	if _, msgs, _ := p.pull(now.Add(100*time.Millisecond), 1<<20); len(msgs) != 0 {
		t.Fatal("the data channel was sent a message before the feed's first keyframe")
	}
	p.packet(now.Add(200*time.Millisecond), f, keyStart(1))
	if _, msgs, _ := p.pull(now.Add(300*time.Millisecond), 1<<20); len(msgs) != 1 {
		t.Fatalf("after the keyframe the data channel was sent %d messages, wanted 1", len(msgs))
	}

	p.pushData(now, []byte("more"))
	g := videoFeed("bridge 2 section 0", &asked)
	p.addFeed(now.Add(time.Second), g)
	if _, msgs, _ := p.pull(now.Add(time.Second+firstKeyframeHold), 1<<20); len(msgs) != 1 {
		t.Fatal("the data channel still waited once the first keyframe hold was over")
	}
}

func TestADataChannelWithNoVideoIsHandedMessagesUpToItsWindow(t *testing.T) {
	var logs []string
	p := newTestPacer(&logs)
	for i := 0; i < 10; i++ {
		p.pushData(time.Unix(0, 0), make([]byte, 64<<10))
	}
	_, msgs, _ := p.pull(time.Unix(0, 0), p.dataWindow())
	if len(msgs) != 4 {
		t.Fatalf("handed %d messages of 64 KB into a %d byte window, wanted 4", len(msgs), p.dataWindow())
	}
	if p.dataBytes != 6*64<<10 {
		t.Errorf("%d bytes held, wanted %d", p.dataBytes, 6*64<<10)
	}
}

func TestStartsKeyframeReadsEveryWayAnH264KeyframeBegins(t *testing.T) {
	cases := []struct {
		name    string
		payload []byte
		want    bool
	}{
		{"sequence parameter set", []byte{0x67, 0x42}, true},
		{"IDR slice", []byte{0x65, 0x88}, true},
		{"delta slice", []byte{0x41, 0x9a}, false},
		{"aggregate with SPS", []byte{0x78, 0x00, 0x02, 0x67, 0x42, 0x00, 0x01, 0x68}, true},
		{"aggregate without", []byte{0x78, 0x00, 0x01, 0x06, 0x00, 0x01, 0x41}, false},
		{"IDR fragment start", []byte{0x7c, 0x85, 0x00}, true},
		{"IDR fragment middle", []byte{0x7c, 0x05, 0x00}, false},
		{"empty", nil, false},
	}
	for _, c := range cases {
		if got := startsKeyframe(c.payload); got != c.want {
			t.Errorf("%s: %v, wanted %v", c.name, got, c.want)
		}
	}
}

func TestARateMeterReadsANewFeedAtItsRate(t *testing.T) {
	var m rateMeter
	start := time.Unix(0, 0)
	for i := 0; i < 300; i++ {
		m.add(start.Add(time.Duration(i)*10*time.Millisecond), 1000)
	}
	got := m.rate(start.Add(3 * time.Second))
	if got < 90_000 || got > 110_000 {
		t.Errorf("a feed sending 100 KB/s for 3 s reads %.0f B/s", got)
	}
}
