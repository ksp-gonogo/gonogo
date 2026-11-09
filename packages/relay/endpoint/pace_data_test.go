package main

import (
	"testing"
	"time"

	"github.com/pion/rtp"
)

// steadyRun drives a pacer for `length` in 10 ms steps: each feed sends its rate in 1200-byte packets, starting with a keyframe, and `dataRate` bytes a second of data channel messages are pushed in 1000-byte messages. The channel is taken to drain at once. It returns the longest any message waited.
func steadyRun(p *pacer, start time.Time, length time.Duration, feeds []*feed, rates []float64, dataRate float64) time.Duration {
	const step = 10 * time.Millisecond
	seq := make([]uint16, len(feeds))
	owed := make([]float64, len(feeds))
	dataOwed := 0.0
	var pushedAt []time.Time
	longest := time.Duration(0)
	for now := start; now.Before(start.Add(length)); now = now.Add(step) {
		for i, f := range feeds {
			owed[i] += rates[i] * step.Seconds()
			for owed[i] >= 1200 {
				owed[i] -= 1200
				pkt := &rtp.Packet{Header: rtp.Header{SequenceNumber: seq[i]}, Payload: make([]byte, 1188)}
				pkt.Payload[0], pkt.Payload[1] = 0x7c, 0x01
				if seq[i] == 0 {
					pkt.Payload[1] = 0x85
				}
				seq[i]++
				p.packet(now, f, pkt)
			}
		}
		dataOwed += dataRate * step.Seconds()
		for dataOwed >= 1000 {
			dataOwed -= 1000
			p.pushData(now, make([]byte, 1000))
			pushedAt = append(pushedAt, now)
		}
		_, msgs, _ := p.pull(now, p.dataWindow())
		for range msgs {
			longest = max(longest, now.Sub(pushedAt[0]))
			pushedAt = pushedAt[1:]
		}
	}
	if len(pushedAt) > 0 {
		longest = max(longest, start.Add(length).Sub(pushedAt[0]))
	}
	return longest
}

func TestDataStillGoesOutWhileTheOnlyFeedIsMoreThanTheCeiling(t *testing.T) {
	var logs []string
	p := newTestPacer(&logs)
	start := time.Unix(0, 0)
	var asked int
	only := videoFeed("bridge 1 section 0", &asked)
	p.addFeed(start, only)
	p.ceiling = 250_000
	if longest := steadyRun(p, start, 20*time.Second, []*feed{only}, []float64{300_000}, 10_000); longest > time.Second {
		t.Fatalf("a data channel message waited %v behind video that does not fit, wanted at most 1 s", longest)
	}
}

func TestDataThatWaitsTooLongShedsTheLowestFeed(t *testing.T) {
	var logs []string
	p := newTestPacer(&logs)
	start := time.Unix(0, 0)
	var asked int
	top, low := videoFeed("bridge 1 section 0", &asked), videoFeed("bridge 1 section 1", &asked)
	p.addFeed(start, top)
	p.addFeed(start, low)
	p.ceiling = 250_000
	steadyRun(p, start, 20*time.Second, []*feed{top, low}, []float64{110_000, 110_000}, 60_000)
	if p.stats.sheds == 0 || low.state == feedLive {
		t.Fatalf("data waited behind two feeds that fill the ceiling and nothing was shed (low feed %v):\n%v", low.state, logs)
	}
	if top.state != feedLive {
		t.Errorf("the top-ranked feed was shed")
	}
}

func TestAMessageSentAheadSkipsQueuedDataAndAFeedsKeyframeWait(t *testing.T) {
	var logs []string
	p := newTestPacer(&logs)
	now := time.Unix(0, 0)
	var asked int
	f := videoFeed("bridge 1 section 0", &asked)
	p.addFeed(now, f)
	p.ceiling = 250_000
	for i := 0; i < 50; i++ {
		p.pushData(now, make([]byte, 16<<10))
	}
	p.pushAhead([]byte("heartbeat"))
	_, msgs, _ := p.pull(now.Add(10*time.Millisecond), 0)
	if len(msgs) != 1 || string(msgs[0]) != "heartbeat" {
		t.Fatalf("pulled %d messages while the feed waits for its keyframe and the window is full, wanted the heartbeat alone", len(msgs))
	}
	if p.dataBytes != 50*16<<10 {
		t.Errorf("%d bytes of data held, wanted all of it, since the ahead message does not count", p.dataBytes)
	}
}
