package main

import (
	"fmt"
	"math"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

/*
pacer keeps what the endpoint sends one station within what the station's link carries. Every
media packet bridged to the station, from every bridge it opened, and every message for its
data channel waits here and goes out at the pace rate, so a camera's keyframe, sent upstream as
one burst of up to a hundred packets, reaches the station's link spread out.

The pace rate is the station's ceiling once its receiver reports have shown loss, and until then
a multiple of the media rate arriving for it, enough to spread a burst without slowing a station
whose link has room. The first report of heavy loss sets the ceiling a little above the media
coming in, since loss from a burst alone stops once the burst is paced at the average, or to
what got through if that is more. Each later report of heavy loss lowers it to what got
through. A report of lighter loss does the same while the data channel is taking a share, and
while it is, no report takes the ceiling below the media, so the data channel gives way first.
It climbs slowly while reports come back clean, to at most a quarter above what is being sent
and just under the rate that last brought on loss, so it settles under the link instead of
climbing back into it. Bringing a shed feed back raises the ceiling to fit it, which is the only
way the pacer learns the link has more room; a return that brings heavy loss puts it back.

A browser's REMB estimate is kept for the heartbeat and not acted on: it covers one bridge's
connection rather than the station's link, and a receive-side estimate starts low and climbs,
so as a ceiling it would shed feeds a link has room for.

When the media coming in for the station is more than the ceiling and the link shows it, the
lowest-ranked video feed is shed: its packets are dropped here until there is room again and
it has waited out its hold, then the upstream is asked for a keyframe and the feed is forwarded
again from the first packet of that keyframe, renumbered so the station sees no gap. Feeds rank
in the order their media first arrived, so the feed the station has had longest is kept longest,
and the top-ranked video feed is never shed.

Data channel messages go after any media, under the same ceiling once one is known, and not at
all while a feed waits for its first keyframe, so a join snapshot never queues ahead of the
first picture. A pacer is not safe for concurrent use; stationLink holds its lock.
*/
type pacer struct {
	feeds []*feed
	ranks int
	// ceiling is the station's link in bytes a second, 0 until a receiver report shows loss.
	ceiling float64
	// remb is the station's latest REMB estimate in bytes a second, reported and not acted on.
	remb float64

	tokens   float64
	filledAt time.Time

	media      []pacedPacket
	mediaBytes int
	data       [][]byte
	dataBytes  int
	// sent is every byte handed on to the station, media and data, which a loss report is measured against.
	sent rateMeter
	// dataSent is the data channel's part of sent.
	dataSent rateMeter

	lastDown time.Time
	// quietUntil is the end of the loss a failed return leaves behind, which lowers no ceiling.
	quietUntil time.Time
	lastShed   time.Time
	// overloadRate is what was being sent when the station last reported heavy loss, until a feed brought back since has stayed.
	overloadRate float64
	// beforeProbe is the ceiling before a shed feed was brought back, which a failed return goes back to.
	beforeProbe float64
	lastUp      time.Time
	lastLook    time.Time

	stats pacerCounts
	logf  func(format string, args ...any)
	name  string
}

type pacedPacket struct {
	f    *feed
	pkt  *rtp.Packet
	size int
	at   time.Time
}

// pacerCounts are a pacer's running totals, read by the bridge heartbeat.
type pacerCounts struct {
	sheds, restores int64
	// shedPackets are media packets dropped because their feed was shed or waiting for its keyframe to come back.
	shedPackets int64
	// overflow are media packets dropped because the queue was full.
	overflow int64
	// heldKeyframeRequests are the station's keyframe requests not passed upstream: for a feed that is shed, or within a second of the last.
	heldKeyframeRequests int64
	ceilingDowns         int64
}

type feedState int

const (
	feedLive feedState = iota
	feedShed
	// feedResuming is a shed feed whose keyframe has been asked for and has not yet arrived.
	feedResuming
)

// feed is one bridged media section, as the station's pacer forwards it.
type feed struct {
	name        string
	kind        webrtc.RTPCodecType
	rank        int
	write       func(*rtp.Packet) error
	askKeyframe func()
	added       time.Time

	state   feedState
	in      rateMeter
	seenKey bool
	shedAt  time.Time
	hold    time.Duration
	askedAt time.Time
	// resumedAt is when the feed began coming back; askedAt moves on with each repeated keyframe request.
	resumedAt time.Time
	restored  time.Time
	// stayed is set once a feed brought back has kept going for shortRestore.
	stayed    bool
	lastAsked time.Time

	// offset renumbers the feed's packets so a stretch dropped while it was shed leaves no gap.
	offset  uint16
	lastSeq uint16
	sentAny bool
}

const (
	// mediaShare is the part of the ceiling a returning feed is given room under; the rest is left to the data channel and to retransmissions.
	mediaShare = 0.9
	// paceFactor times the incoming media rate is the pace while no ceiling is known.
	paceFactor = 2.5
	// minPace is the slowest pace while no ceiling is known, in bytes a second (1 Mbit/s).
	minPace = 125_000
	// bucketDepth is how much sending the pace lets build up while the queue is empty.
	bucketDepth = 10 * time.Millisecond
	minBucket   = 2600

	lossStorm     = 0.10
	lossClean     = 0.02
	downGap       = 2 * time.Second
	upGap         = time.Second
	upAfterDown   = 2 * time.Second
	ceilingGrowth = 1.05
	// maxHeadroom times what is being sent is as far as the ceiling climbs without loss to say otherwise.
	maxHeadroom = 1.25
	// overloadDelay is how long media may wait in the queue before the feeds are taken to be more than the ceiling.
	overloadDelay = time.Second
	// firstMargin is how far above the media coming in the first loss report sets the ceiling, so the bursts that caused it drain.
	firstMargin = 1.1
	/*
		dataYield times the media coming in is as low as a loss report takes the ceiling while the
		data channel is taking more than the margin above it: the data channel gives way before any
		feed is shed, since its messages wait and a feed's pictures do not.
	*/
	dataYield = 1.05
	// probeAfterDown is how long after the ceiling last fell a shed feed waits before it is tried again.
	probeAfterDown = 5 * time.Second
	// probeSettle is how long the loss of a feed brought back too soon is left to clear.
	probeSettle = 4 * time.Second
	// overloadMargin of overloadRate is as high as the ceiling climbs while it is known.
	overloadMargin = 0.95
	// minCeiling is the lowest the ceiling falls, in bytes a second (256 kbit/s).
	minCeiling = 32_000

	lookEvery = 100 * time.Millisecond
	// shedHold is how long a shed feed waits before it is brought back; it doubles, up to maxShedHold, each time a feed is shed again soon after it came back.
	shedHold     = 10 * time.Second
	maxShedHold  = 60 * time.Second
	shortRestore = 20 * time.Second
	resumeRetry  = 2 * time.Second
	// firstKeyframeHold is the longest the data channel waits for a new feed's first keyframe, or for a returning feed's.
	firstKeyframeHold = 3 * time.Second
	keyframeGap       = time.Second
	maxMediaQueue     = 2 << 20
	dataWindow        = 256 << 10
	videoDataWindow   = 32 << 10
)

// addFeed starts pacing a media section. Feeds rank in the order they are added.
func (p *pacer) addFeed(now time.Time, f *feed) {
	f.rank = p.ranks
	p.ranks++
	f.added = now
	f.hold = shedHold
	p.feeds = append(p.feeds, f)
}

// removeFeed stops pacing a section whose track has ended, dropping what of it is still queued.
func (p *pacer) removeFeed(f *feed) {
	for i, g := range p.feeds {
		if g == f {
			p.feeds = append(p.feeds[:i], p.feeds[i+1:]...)
			break
		}
	}
	kept := p.media[:0]
	for _, q := range p.media {
		if q.f == f {
			p.mediaBytes -= q.size
			continue
		}
		kept = append(kept, q)
	}
	p.media = kept
}

// packet queues one packet of a feed, or drops it while the feed is shed or waiting for the keyframe that brings it back.
func (p *pacer) packet(now time.Time, f *feed, pkt *rtp.Packet) {
	size := pkt.MarshalSize()
	f.in.add(now, size)
	key := f.kind == webrtc.RTPCodecTypeVideo && startsKeyframe(pkt.Payload)
	switch f.state {
	case feedShed:
		p.stats.shedPackets++
		return
	case feedResuming:
		if !key {
			p.stats.shedPackets++
			return
		}
		f.state = feedLive
		f.restored = now
		p.stats.restores++
		if f.sentAny {
			f.offset = f.lastSeq + 1 - pkt.SequenceNumber
		}
		p.logf("%s %s restored: its keyframe arrived %d ms after it was asked for", p.name, f.name, now.Sub(f.askedAt).Milliseconds())
	}
	if key {
		f.seenKey = true
	}
	pkt.SequenceNumber += f.offset
	f.lastSeq = pkt.SequenceNumber
	f.sentAny = true
	if p.mediaBytes+size > maxMediaQueue {
		p.stats.overflow++
		return
	}
	p.media = append(p.media, pacedPacket{f: f, pkt: pkt, size: size, at: now})
	p.mediaBytes += size
}

// pushData queues one message for the station's data channel.
func (p *pacer) pushData(msg []byte) {
	p.data = append(p.data, msg)
	p.dataBytes += len(msg)
}

// report takes one receiver report block from the station for a feed: the fraction of its packets lost since the last.
func (p *pacer) report(now time.Time, f *feed, loss float64) {
	if f.state != feedLive {
		return
	}
	storm := loss > lossStorm
	if loss > lossClean && p.ceiling > 0 || storm {
		if now.Sub(p.lastDown) < downGap || now.Before(p.quietUntil) {
			return
		}
		if probe := p.probing(now); probe != nil {
			p.lastDown = now
			p.quietUntil = now.Add(probeSettle)
			if p.beforeProbe > 0 {
				p.ceiling = p.beforeProbe
			}
			p.shed(now, probe, probe.in.rate(now), "the station reported "+fmt.Sprintf("%d%%", int(loss*100))+" loss after it came back")
			return
		}
		media := p.incoming(now)
		dataFlowing := p.dataSent.rate(now) > (dataYield-1)*media
		if !storm && !dataFlowing {
			return
		}
		sent := p.sent.rate(now)
		before := p.ceiling
		if before == 0 {
			p.ceiling = math.Max(minCeiling, math.Max(firstMargin*media, sent*(1-loss)))
		} else {
			p.ceiling = math.Max(minCeiling, math.Min(before, sent)*(1-loss))
			p.overloadRate = sent
			if dataFlowing && p.ceiling < dataYield*media {
				p.ceiling = dataYield * media
			}
		}
		p.lastDown = now
		p.stats.ceilingDowns++
		p.logf("%s ceiling %s, was %s: the station reported %d%% loss on %s", p.name, kbps(p.ceiling), kbps(before), int(loss*100), f.name)
		p.look(now, storm)
		return
	}
	if loss < lossClean && p.ceiling > 0 && now.Sub(p.lastDown) >= upAfterDown && now.Sub(p.lastUp) >= upGap {
		p.lastUp = now
		grown := p.ceiling * ceilingGrowth
		nearOverload := p.overloadRate > 0 && grown > overloadMargin*p.overloadRate
		if grown <= maxHeadroom*p.sent.rate(now) && !nearOverload {
			p.ceiling = grown
		}
	}
}

// estimate takes a REMB estimate from the station, in bytes a second.
func (p *pacer) estimate(bytesPerSecond float64) {
	p.remb = bytesPerSecond
}

// keyframeRequest says whether a keyframe request the station sent for a feed goes upstream: never while the feed is shed or coming back, and at most once a second.
func (p *pacer) keyframeRequest(now time.Time, f *feed) bool {
	if f == nil {
		return true
	}
	if f.state != feedLive || now.Sub(f.lastAsked) < keyframeGap {
		p.stats.heldKeyframeRequests++
		return false
	}
	f.lastAsked = now
	return true
}

// limit is the ceiling in force, or 0 while none is known.
func (p *pacer) limit() float64 {
	return p.ceiling
}

// probing is the feed brought back within shortRestore, whose return a loss report is put down to, or nil.
func (p *pacer) probing(now time.Time) *feed {
	for _, f := range p.feeds {
		if f.state == feedLive && !f.restored.IsZero() && now.Sub(f.restored) < shortRestore {
			return f
		}
	}
	return nil
}

// incoming is the media rate arriving for the feeds being forwarded, in bytes a second.
func (p *pacer) incoming(now time.Time) float64 {
	sum := 0.0
	for _, f := range p.feeds {
		if f.state != feedShed {
			sum += f.in.rate(now)
		}
	}
	return sum
}

func (p *pacer) paceRate(now time.Time) float64 {
	if c := p.limit(); c > 0 {
		return c
	}
	return math.Max(paceFactor*p.incoming(now), minPace)
}

/*
look sheds the lowest-ranked feed when the media coming in is more than the ceiling and the
station has just reported heavy loss or the queue has held media past overloadDelay, at most one
every downGap, and brings back the top-ranked shed feed once its hold is over and no loss has
been reported for probeAfterDown.
*/
func (p *pacer) look(now time.Time, force bool) {
	if !force && now.Sub(p.lastLook) < lookEvery {
		return
	}
	p.lastLook = now
	c := p.limit()
	sum := p.incoming(now)
	overloaded := sum > c && (force || p.queueDelay(now) > overloadDelay)
	if c > 0 && overloaded && now.Sub(p.lastShed) >= downGap {
		if victim := p.lowestSheddable(); victim != nil {
			p.lastShed = now
			p.shed(now, victim, victim.in.rate(now), fmt.Sprintf("the feeds' %s does not fit under the %s ceiling", kbps(sum), kbps(c)))
		}
	}
	for _, f := range p.feeds {
		if f.state == feedLive && !f.restored.IsZero() && !f.stayed && now.Sub(f.restored) >= shortRestore {
			f.stayed = true
			p.overloadRate = 0
			p.beforeProbe = 0
		}
	}
	resuming := false
	for _, f := range p.feeds {
		if f.state != feedResuming {
			continue
		}
		resuming = true
		if now.Sub(f.askedAt) >= resumeRetry {
			f.askedAt = now
			f.lastAsked = now
			f.askKeyframe()
		}
	}
	if resuming || p.probing(now) != nil {
		return
	}
	var next *feed
	for _, f := range p.feeds {
		if f.state == feedShed && (next == nil || f.rank < next.rank) {
			next = f
		}
	}
	if next == nil || now.Sub(next.shedAt) < next.hold || now.Sub(p.lastDown) < probeAfterDown {
		return
	}
	p.beforeProbe = p.ceiling
	if need := (sum + next.in.rate(now)) / mediaShare; c > 0 && need > c {
		p.ceiling = need
	}
	next.state = feedResuming
	next.resumedAt = now
	next.askedAt = now
	next.lastAsked = now
	p.logf("%s %s coming back after %d s: asked the upstream for a keyframe", p.name, next.name, int(now.Sub(next.shedAt).Seconds()))
	next.askKeyframe()
}

// lowestSheddable is the lowest-ranked video feed not shed, unless it is the only one.
func (p *pacer) lowestSheddable() *feed {
	var top, low *feed
	for _, f := range p.feeds {
		if f.kind != webrtc.RTPCodecTypeVideo || f.state == feedShed {
			continue
		}
		if top == nil || f.rank < top.rank {
			top = f
		}
		if low == nil || f.rank > low.rank {
			low = f
		}
	}
	if low == top {
		return nil
	}
	return low
}

func (p *pacer) shed(now time.Time, f *feed, rate float64, why string) {
	if !f.restored.IsZero() && now.Sub(f.restored) < shortRestore {
		f.hold = min(2*f.hold, maxShedHold)
	} else {
		f.hold = shedHold
	}
	f.state = feedShed
	f.stayed = false
	f.shedAt = now
	p.stats.sheds++
	p.logf("%s %s at %s shed for %d s: %s", p.name, f.name, kbps(rate), int(f.hold.Seconds()), why)
}

// holdingData is whether the data channel waits, because a feed is waiting for its first keyframe or for the one that brings it back.
func (p *pacer) holdingData(now time.Time) bool {
	for _, f := range p.feeds {
		if f.kind != webrtc.RTPCodecTypeVideo {
			continue
		}
		if f.state == feedLive && !f.seenKey && now.Sub(f.added) < firstKeyframeHold {
			return true
		}
		if f.state == feedResuming && now.Sub(f.resumedAt) < firstKeyframeHold {
			return true
		}
	}
	return false
}

/*
dataWindow is the most the data channel is handed ahead of what it has sent. Once handed on, a
message goes out at the channel's own pace, past the ceiling, so the window is small while video
shares the link.
*/
func (p *pacer) dataWindow() int {
	if p.hasVideo() {
		return videoDataWindow
	}
	return dataWindow
}

func (p *pacer) hasVideo() bool {
	for _, f := range p.feeds {
		if f.kind == webrtc.RTPCodecTypeVideo {
			return true
		}
	}
	return false
}

/*
pull takes what may go to the station now: media packets while the pace allows, then data
channel messages while `room` bytes fit in the channel's own buffer. It returns how long until
something more may go, or a negative wait when nothing will until more arrives.
*/
func (p *pacer) pull(now time.Time, room int) ([]pacedPacket, [][]byte, time.Duration) {
	p.look(now, false)
	rate := p.paceRate(now)
	depth := math.Max(rate*bucketDepth.Seconds(), minBucket)
	if !p.filledAt.IsZero() {
		p.tokens = math.Min(depth, p.tokens+rate*now.Sub(p.filledAt).Seconds())
	} else {
		p.tokens = depth
	}
	p.filledAt = now

	var out []pacedPacket
	for len(p.media) > 0 && p.tokens > 0 {
		q := p.media[0]
		p.media[0] = pacedPacket{}
		p.media = p.media[1:]
		p.mediaBytes -= q.size
		p.tokens -= float64(q.size)
		p.sent.add(now, q.size)
		out = append(out, q)
	}

	var msgs [][]byte
	held := p.holdingData(now)
	limited := p.limit() > 0 && p.hasVideo()
	if !held {
		for len(p.data) > 0 && room > 0 && (!limited || (len(p.media) == 0 && p.tokens > 0)) {
			m := p.data[0]
			p.data[0] = nil
			p.data = p.data[1:]
			p.dataBytes -= len(m)
			room -= len(m)
			if limited {
				p.tokens -= float64(len(m))
			}
			p.sent.add(now, len(m))
			p.dataSent.add(now, len(m))
			msgs = append(msgs, m)
		}
	}

	wait := time.Duration(-1)
	if len(p.media) > 0 || (len(p.data) > 0 && limited && room > 0 && !held) {
		wait = max(time.Millisecond, time.Duration(-p.tokens/rate*float64(time.Second)))
	}
	if len(p.feeds) > 0 && (wait < 0 || wait > lookEvery) {
		wait = lookEvery
	}
	return out, msgs, wait
}

// queueDelay is how long the oldest queued media packet has waited.
func (p *pacer) queueDelay(now time.Time) time.Duration {
	if len(p.media) == 0 {
		return 0
	}
	return now.Sub(p.media[0].at)
}

func (p *pacer) shedNow() int {
	n := 0
	for _, f := range p.feeds {
		if f.state != feedLive {
			n++
		}
	}
	return n
}

/*
startsKeyframe is whether an H.264 RTP payload begins a keyframe: a sequence parameter set or
the first fragment of an IDR picture, alone, in an aggregation packet, or as the start of a
fragmented unit.
*/
func startsKeyframe(payload []byte) bool {
	if len(payload) == 0 {
		return false
	}
	isKey := func(nal byte) bool { t := nal & 0x1f; return t == 5 || t == 7 }
	switch payload[0] & 0x1f {
	case 5, 7:
		return true
	case 24:
		for i := 1; i+2 < len(payload); {
			size := int(payload[i])<<8 | int(payload[i+1])
			i += 2
			if isKey(payload[i]) {
				return true
			}
			i += size
		}
	case 28:
		return len(payload) > 1 && payload[1]&0x80 != 0 && isKey(payload[1])
	}
	return false
}

/*
rateMeter is a rate in bytes a second, averaged exponentially over about five seconds, longer
than a camera's group of pictures so a keyframe does not read as a jump in its rate. For the
first seconds it divides by the part of the window it has seen, at least one second of it, so a
feed that has just started reads at its rate rather than climbing to it.
*/
type rateMeter struct {
	acc   float64
	at    time.Time
	since time.Time
}

const (
	rateWindow  = 5 * time.Second
	rateWarmest = time.Second
)

func (m *rateMeter) decay(now time.Time) {
	if !m.at.IsZero() && now.After(m.at) {
		m.acc *= math.Exp(-now.Sub(m.at).Seconds() / rateWindow.Seconds())
	}
	if now.After(m.at) {
		m.at = now
	}
}

func (m *rateMeter) add(now time.Time, bytes int) {
	if m.since.IsZero() {
		m.since = now
	}
	m.decay(now)
	m.acc += float64(bytes)
}

func (m *rateMeter) rate(now time.Time) float64 {
	m.decay(now)
	if m.since.IsZero() {
		return 0
	}
	seen := max(now.Sub(m.since), rateWarmest).Seconds() / rateWindow.Seconds()
	return m.acc / rateWindow.Seconds() / (1 - math.Exp(-seen))
}

// kbps is a rate in bytes a second as kilobits a second, or "unknown" for 0.
func kbps(bytesPerSecond float64) string {
	if bytesPerSecond <= 0 {
		return "unknown"
	}
	return fmt.Sprintf("%d kbit/s", int(bytesPerSecond*8/1000))
}
