package main

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

/*
The simulation drives the pacer on a virtual clock against a model of a phone's mobile link,
with the numbers the playtest's endpoint heartbeats measured. A camera sends 28 frames a second
in groups of 60, each group opening with a keyframe sent as one unpaced burst, the way the
camera sidecar sends them. The link drains at a fixed rate and drops whatever arrives while its
queue is full, which is how a carrier's queue loses a burst. The station counts what it can
decode: a frame is shown when every packet of it arrived and the picture before it was shown,
or it is a keyframe; a broken frame stops the picture until the next keyframe, and the station
asks for one at most once a second, as a browser does.

"Before" writes each packet to the link as it arrives, as the endpoint did. "After" puts the
same packets through the pacer, with the station's receiver reports fed back once a second.
*/

const (
	simPacket = 1200
	simFPS    = 28
	simGOP    = 60
	simTick   = time.Millisecond
)

type simFrame struct {
	feed      int
	key       bool
	n         int
	at        time.Time
	sent      int
	delivered int
	lost      int
}

type simCamera struct {
	f        *feed
	index    int
	rateBps  float64
	keyBytes int
	next     time.Time
	frameNo  int
	seq      uint16
	ts       uint32
	forceKey bool
	lastKey  time.Time
	frames   []*simFrame
}

// frameBytes is a delta frame's size, so a group of pictures averages the camera's rate with its keyframe in it.
func (c *simCamera) frameBytes(key bool) int {
	if key {
		return c.keyBytes
	}
	gopBytes := c.rateBps / 8 * float64(simGOP) / simFPS
	return int((gopBytes - float64(c.keyBytes)) / (simGOP - 1))
}

// requestKeyframe is the sidecar honouring a keyframe request, at most once a second.
func (c *simCamera) requestKeyframe(now time.Time) {
	if now.Sub(c.lastKey) >= time.Second {
		c.forceKey = true
	}
}

type simPkt struct {
	pkt   *rtp.Packet
	frame *simFrame
	size  int
}

type simLink struct {
	rate     float64
	buffer   int
	queued   int
	queue    []simPkt
	credit   float64
	sent     int
	lostPkts int
}

func (l *simLink) offer(p simPkt) bool {
	l.sent++
	if p.frame != nil {
		p.frame.sent++
	}
	if l.queued+p.size > l.buffer {
		l.lostPkts++
		if p.frame != nil {
			p.frame.lost++
		}
		return false
	}
	l.queue = append(l.queue, p)
	l.queued += p.size
	return true
}

func (l *simLink) drain(dt time.Duration, delivered func(simPkt)) {
	l.credit += l.rate * dt.Seconds()
	for len(l.queue) > 0 && l.credit >= float64(l.queue[0].size) {
		p := l.queue[0]
		l.queue = l.queue[1:]
		l.queued -= p.size
		l.credit -= float64(p.size)
		delivered(p)
	}
	if len(l.queue) == 0 && l.credit > float64(simPacket) {
		l.credit = float64(simPacket)
	}
}

// simReceiver is one feed as the station's browser sees it.
type simReceiver struct {
	showing   bool
	shown     int
	first     time.Duration
	lastAsk   time.Time
	highest   uint16
	started   bool
	expected  int
	received  int
	nextFrame int
}

type simConfig struct {
	paced    bool
	linkRate func(t time.Duration) float64
	buffer   int
	cameras  []simCameraSpec
	snapshot int
	length   time.Duration
}

type simCameraSpec struct {
	rateBps  float64
	keyBytes int
	startAt  time.Duration
	phase    time.Duration
}

type simSecond struct {
	shown    []int
	lossPct  int
	ceiling  float64
	shed     []bool
	dataSent int
	maxBurst int
}

type simResult struct {
	seconds  []simSecond
	first    []time.Duration
	shown    []int
	sheds    int64
	restores int64
	logs     []string
	// maxWindow is the most bytes the station's link was offered in any 20 ms.
	maxWindow int
	dataDone  time.Duration
}

func runSim(cfg simConfig) simResult {
	start := time.Unix(1_700_000_000, 0)
	now := start
	link := &simLink{rate: cfg.linkRate(0), buffer: cfg.buffer}
	var res simResult
	p := &pacer{name: "session 1"}
	p.logf = func(format string, args ...any) {
		res.logs = append(res.logs, fmt.Sprintf("%6.1fs ", now.Sub(start).Seconds())+fmt.Sprintf(format, args...))
	}

	cams := make([]*simCamera, len(cfg.cameras))
	recv := make([]*simReceiver, len(cfg.cameras))
	for i, spec := range cfg.cameras {
		c := &simCamera{index: i, rateBps: spec.rateBps, keyBytes: spec.keyBytes, next: start.Add(spec.startAt + spec.phase), forceKey: true}
		cams[i] = c
		recv[i] = &simReceiver{first: -1}
		c.f = &feed{name: fmt.Sprintf("bridge 1 section %d", i), kind: webrtc.RTPCodecTypeVideo, write: func(*rtp.Packet) error { return nil }}
		cam := c
		c.f.askKeyframe = func() { cam.requestKeyframe(now) }
	}
	frameOf := map[*rtp.Packet]*simFrame{}

	// The join snapshot crosses on the data channel, whose transport sends at about 1 Mbit/s (the playtest's drain rate) whatever the media is doing.
	const dataRate = 125_000.0
	dataLeft := cfg.snapshot
	dataInFlight := 0
	dataCredit := 0.0
	dataDelivered := 0
	if cfg.paced {
		for left := cfg.snapshot; left > 0; left -= 16 << 10 {
			p.pushData(make([]byte, min(left, 16<<10)))
		}
		dataLeft = 0
	}
	res.dataDone = -1

	var window []struct {
		at   time.Time
		size int
	}
	windowBytes := 0
	toLink := func(sp simPkt) {
		link.offer(sp)
		window = append(window, struct {
			at   time.Time
			size int
		}{now, sp.size})
		windowBytes += sp.size
		for len(window) > 0 && now.Sub(window[0].at) >= 20*time.Millisecond {
			windowBytes -= window[0].size
			window = window[1:]
		}
		res.maxWindow = max(res.maxWindow, windowBytes)
	}

	sec := simSecond{shown: make([]int, len(cams)), shed: make([]bool, len(cams))}
	linkSentAtSecond, linkLostAtSecond := 0, 0
	nextSecond := start.Add(time.Second)
	nextReport := make([]time.Time, len(cams))
	for i := range nextReport {
		nextReport[i] = start.Add(time.Second + time.Duration(i)*137*time.Millisecond)
	}
	added := make([]bool, len(cams))

	for now.Before(start.Add(cfg.length)) {
		link.rate = cfg.linkRate(now.Sub(start))
		for i, c := range cams {
			if now.Before(c.next) {
				continue
			}
			if cfg.paced && !added[i] {
				added[i] = true
				p.addFeed(now, c.f)
			}
			key := c.forceKey || c.frameNo%simGOP == 0
			if key {
				c.forceKey = false
				c.lastKey = now
				c.frameNo = 0
			}
			fr := &simFrame{feed: i, key: key, at: now}
			bytes := c.frameBytes(key)
			fr.n = (bytes + simPacket - 1) / simPacket
			c.frames = append(c.frames, fr)
			for k := 0; k < fr.n; k++ {
				payload := []byte{0x7c, 0x01, 0}
				if key {
					payload[1] = 0x05
				}
				if k == 0 {
					payload[1] |= 0x80
				}
				body := min(simPacket, bytes-k*simPacket) - 12 - len(payload)
				pkt := &rtp.Packet{Header: rtp.Header{SequenceNumber: c.seq, Timestamp: c.ts, Marker: k == fr.n-1}, Payload: append(payload, make([]byte, max(0, body))...)}
				c.seq++
				frameOf[pkt] = fr
				if cfg.paced {
					p.packet(now, c.f, pkt)
				} else {
					toLink(simPkt{pkt: pkt, frame: fr, size: pkt.MarshalSize()})
				}
			}
			c.ts += 90000 / simFPS
			c.frameNo++
			c.next = c.next.Add(time.Second / simFPS)
		}

		if cfg.paced {
			room := max(0, p.dataWindow()-dataInFlight)
			pkts, msgs, _ := p.pull(now, room)
			for _, q := range pkts {
				fr := frameOf[q.pkt]
				toLink(simPkt{pkt: q.pkt, frame: fr, size: q.size})
			}
			for _, m := range msgs {
				dataInFlight += len(m)
			}
		}

		// The data channel's transport sends what it holds at its own rate, in packets that cross the same link and are sent again when lost.
		if dataLeft > 0 || dataInFlight > 0 {
			dataCredit += dataRate * simTick.Seconds()
			for dataCredit >= simPacket && (dataLeft > 0 || dataInFlight > 0) {
				dataCredit -= simPacket
				if toLinkData(link, toLink) {
					sec.dataSent += simPacket
					dataDelivered += simPacket
					if dataLeft > 0 {
						dataLeft -= simPacket
					} else {
						dataInFlight = max(0, dataInFlight-simPacket)
					}
				}
			}
			if dataLeft <= 0 && dataInFlight <= 0 && (!cfg.paced || p.dataBytes == 0) && res.dataDone < 0 {
				res.dataDone = now.Sub(start)
			}
		}

		link.drain(simTick, func(sp simPkt) {
			if sp.frame != nil {
				sp.frame.delivered++
				onArrive(recv[sp.frame.feed], sp.pkt)
			}
		})

		for i, c := range cams {
			r := recv[i]
			for r.nextFrame < len(c.frames) && now.Sub(c.frames[r.nextFrame].at) > 400*time.Millisecond {
				fr := c.frames[r.nextFrame]
				age := now.Sub(fr.at)
				live := c.f.state == feedLive
				if fr.sent == 0 {
					if live && age < 3*time.Second {
						break
					}
					r.nextFrame++
					continue
				}
				waiting := (fr.sent < fr.n && live) || fr.delivered+fr.lost < fr.sent
				if waiting && age < 3*time.Second {
					break
				}
				if fr.delivered < fr.n {
					r.showing = false
				} else if fr.key || r.showing {
					r.showing = true
					r.shown++
					sec.shown[i]++
					if r.first < 0 {
						r.first = now.Sub(start)
					}
				}
				if !r.showing && now.Sub(r.lastAsk) >= time.Second {
					r.lastAsk = now
					if !cfg.paced {
						c.requestKeyframe(now)
					} else if p.keyframeRequest(now, c.f) {
						c.requestKeyframe(now)
					}
				}
				r.nextFrame++
			}
			if cfg.paced && !now.Before(nextReport[i]) {
				nextReport[i] = nextReport[i].Add(time.Second)
				loss := 0.0
				if r.expected > 0 {
					loss = float64(max(0, r.expected-r.received)) / float64(r.expected)
				}
				r.expected, r.received = 0, 0
				p.report(now, c.f, loss)
			}
		}

		if !now.Before(nextSecond) {
			nextSecond = nextSecond.Add(time.Second)
			sent := link.sent - linkSentAtSecond
			lost := link.lostPkts - linkLostAtSecond
			linkSentAtSecond, linkLostAtSecond = link.sent, link.lostPkts
			if sent > 0 {
				sec.lossPct = lost * 100 / sent
			}
			sec.ceiling = p.ceiling
			for i, c := range cams {
				sec.shed[i] = cfg.paced && c.f.state != feedLive
			}
			res.seconds = append(res.seconds, sec)
			sec = simSecond{shown: make([]int, len(cams)), shed: make([]bool, len(cams))}
		}
		now = now.Add(simTick)
	}
	for _, r := range recv {
		res.first = append(res.first, r.first)
		res.shown = append(res.shown, r.shown)
	}
	res.sheds, res.restores = p.stats.sheds, p.stats.restores
	return res
}

// toLinkData offers one data packet to the link; a dropped one stays to be sent again.
func toLinkData(l *simLink, offer func(simPkt)) bool {
	before := l.lostPkts
	offer(simPkt{size: simPacket})
	return l.lostPkts == before
}

// onArrive counts a packet the station received, and the packets it now knows to expect from the highest sequence number, as a receiver report does.
func onArrive(r *simReceiver, pkt *rtp.Packet) {
	r.received++
	if !r.started {
		r.started = true
		r.highest = pkt.SequenceNumber
		r.expected++
		return
	}
	if d := int(int16(pkt.SequenceNumber - r.highest)); d > 0 {
		r.expected += d
		r.highest = pkt.SequenceNumber
	}
}

// timeline renders the run one line per second, for the before and after evidence.
func (r simResult) timeline(title string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n\n| s | link loss | ceiling | %s |\n|---|---|---|%s\n", title, feedHeads(len(r.shown)), strings.Repeat("---|", len(r.shown)))
	for i, s := range r.seconds {
		var cells []string
		for f, n := range s.shown {
			cell := fmt.Sprintf("%d fps", n)
			if s.shed[f] {
				cell += " (waiting)"
			}
			cells = append(cells, cell)
		}
		fmt.Fprintf(&b, "| %d | %d%% | %s | %s |\n", i+1, s.lossPct, kbps(s.ceiling), strings.Join(cells, " | "))
	}
	return b.String()
}

func feedHeads(n int) string {
	var h []string
	for i := 0; i < n; i++ {
		h = append(h, fmt.Sprintf("feed %d frames shown", i+1))
	}
	return strings.Join(h, " | ")
}

// framesShownBetween is how many frames of a feed the station showed from second a to second b.
func (r simResult) framesShownBetween(feed, a, b int) int {
	n := 0
	for i := a; i < b && i < len(r.seconds); i++ {
		n += r.seconds[i].shown[feed]
	}
	return n
}

func writeEvidence(t *testing.T, name, text string) {
	dir := os.Getenv("PACE_EVIDENCE_DIR")
	if dir == "" {
		return
	}
	if err := os.WriteFile(dir+"/"+name, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

/*
The phone's link carried about 3 Mbit/s: two feeds at about 300 packets a second between them
played for 90 s at a time, and at about 430 a second, with a third feed, it went into a loss
storm every time.
*/
var (
	phoneLink   = func(time.Duration) float64 { return 400_000 }
	phoneBuffer = 120 << 10
	softwareCam = simCameraSpec{rateBps: 1_440_000, keyBytes: 100 << 10}
	faceCam     = simCameraSpec{rateBps: 1_250_000, keyBytes: 60 << 10}
)

func TestTwoFeedsThatFitKeepPlayingWhenTheirKeyframesLineUp(t *testing.T) {
	cams := []simCameraSpec{softwareCam, softwareCam}
	before := runSim(simConfig{paced: false, linkRate: phoneLink, buffer: phoneBuffer, cameras: cams, length: 60 * time.Second})
	after := runSim(simConfig{paced: true, linkRate: phoneLink, buffer: phoneBuffer, cameras: cams, length: 60 * time.Second})
	writeEvidence(t, "two-feeds.md", before.timeline("Before: two feeds, keyframes lined up, forwarded as they arrive")+"\n"+after.timeline("After: the same feeds through the pacer"))

	for f := 0; f < 2; f++ {
		got := after.framesShownBetween(f, 10, 60)
		if got < 50*simFPS*9/10 {
			t.Errorf("feed %d showed %d frames in the last 50 s through the pacer, wanted nearly %d", f+1, got, 50*simFPS)
		}
	}
	if after.sheds != 0 {
		t.Errorf("two feeds that fit were shed %d times:\n%s", after.sheds, strings.Join(after.logs, "\n"))
	}
	if b, a := before.framesShownBetween(0, 10, 60)+before.framesShownBetween(1, 10, 60), after.framesShownBetween(0, 10, 60)+after.framesShownBetween(1, 10, 60); a < b {
		t.Errorf("the pacer showed %d frames against %d forwarded as they arrived", a, b)
	}
}

func TestAKeyframeBurstReachesTheLinkPaced(t *testing.T) {
	cams := []simCameraSpec{softwareCam, softwareCam}
	before := runSim(simConfig{paced: false, linkRate: phoneLink, buffer: phoneBuffer, cameras: cams, length: 10 * time.Second})
	after := runSim(simConfig{paced: true, linkRate: phoneLink, buffer: phoneBuffer, cameras: cams, length: 10 * time.Second})
	// Two lined-up keyframes are 200 KB in about a millisecond as they arrive; paced, no 20 ms carries a fifth of that.
	limit := before.maxWindow / 5
	if after.maxWindow > limit {
		t.Errorf("the link was offered %d bytes in 20 ms through the pacer, wanted at most %d", after.maxWindow, limit)
	}
	if before.maxWindow < 150<<10 {
		t.Errorf("the unpaced burst was only %d bytes in 20 ms, so the test does not show one", before.maxWindow)
	}
	t.Logf("most offered to the link in 20 ms: %d bytes as they arrive, %d paced", before.maxWindow, after.maxWindow)
}

func TestAThirdFeedWaitsWhileTwoPlayAndComesBackWhenTheLinkHasRoom(t *testing.T) {
	cams := []simCameraSpec{softwareCam, softwareCam, faceCam}
	cams[2].startAt = 5 * time.Second
	widens := 90 * time.Second
	link := func(at time.Duration) float64 {
		if at >= widens {
			return 900_000
		}
		return 400_000
	}
	before := runSim(simConfig{paced: false, linkRate: link, buffer: phoneBuffer, cameras: cams, length: 200 * time.Second})
	after := runSim(simConfig{paced: true, linkRate: link, buffer: phoneBuffer, cameras: cams, length: 200 * time.Second})
	writeEvidence(t, "third-feed.md", before.timeline("Before: a third feed joins two on a 3.2 Mbit/s link, which widens to 7.2 Mbit/s at 90 s")+"\n"+after.timeline("After: the same through the pacer")+"\nPacer log:\n\n```\n"+strings.Join(after.logs, "\n")+"\n```\n")

	if after.sheds == 0 {
		t.Fatalf("the third feed was never shed:\n%s", after.timeline("after"))
	}
	for f := 0; f < 2; f++ {
		if got := after.framesShownBetween(f, 30, 90); got < 60*simFPS*8/10 {
			t.Errorf("feed %d showed %d frames from 30 s to 90 s while the third waited, wanted nearly %d\n%s", f+1, got, 60*simFPS, after.timeline("after"))
		}
		if got := before.framesShownBetween(f, 30, 90); got > 60*simFPS/2 {
			t.Errorf("forwarded as they arrived, feed %d still showed %d frames from 30 s to 90 s, so the test does not show the storm", f+1, got)
		}
	}
	if after.restores == 0 {
		t.Fatalf("the third feed never came back once the link widened:\n%s\n%s", after.timeline("after"), strings.Join(after.logs, "\n"))
	}
	if got := after.framesShownBetween(2, 180, 200); got < 20*simFPS*8/10 {
		t.Errorf("the third feed showed %d frames in the last 20 s, long after the link widened, wanted nearly %d\n%s", got, 20*simFPS, after.timeline("after"))
	}
}

func TestTheFirstPictureIsNotQueuedBehindTheJoinSnapshot(t *testing.T) {
	cams := []simCameraSpec{softwareCam, softwareCam}
	snapshot := 3_500_000
	before := runSim(simConfig{paced: false, linkRate: phoneLink, buffer: phoneBuffer, cameras: cams, snapshot: snapshot, length: 60 * time.Second})
	after := runSim(simConfig{paced: true, linkRate: phoneLink, buffer: phoneBuffer, cameras: cams, snapshot: snapshot, length: 60 * time.Second})
	writeEvidence(t, "join-snapshot.md", before.timeline("Before: a 3.5 MB join snapshot and two feeds")+"\n"+after.timeline("After: the same through the pacer")+
		fmt.Sprintf("\nFirst picture: before %v and %v, after %v and %v. Snapshot fully sent: before %v, after %v.\n", before.first[0], before.first[1], after.first[0], after.first[1], before.dataDone, after.dataDone))

	for f := 0; f < 2; f++ {
		if after.first[f] < 0 || after.first[f] > 2*time.Second {
			t.Errorf("feed %d's first picture came at %v through the pacer, wanted within 2 s", f+1, after.first[f])
		}
		if got := after.framesShownBetween(f, 10, 60); got < 50*simFPS*8/10 {
			t.Errorf("feed %d showed %d frames from 10 s while the snapshot crossed, wanted nearly %d\n%s", f+1, got, 50*simFPS, after.timeline("after"))
		}
	}
	t.Logf("first picture before %v %v, after %v %v; snapshot done before %v after %v", before.first[0], before.first[1], after.first[0], after.first[1], before.dataDone, after.dataDone)
}
