package main

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

/*
stationLink is everything the endpoint sends one joined station, on its data channel and on
every bridge it opened, behind one pacer and one goroutine that writes what the pacer lets go.
*/
type stationLink struct {
	mu   sync.Mutex
	p    pacer
	dc   *webrtc.DataChannel
	wake chan struct{}
	done chan struct{}
	once sync.Once
}

func newStationLink(sid uint32) *stationLink {
	l := &stationLink{wake: make(chan struct{}, 1), done: make(chan struct{})}
	l.p.name = fmt.Sprintf("session %d", sid)
	l.p.logf = log.Printf
	go l.run()
	return l
}

func (l *stationLink) kick() {
	select {
	case l.wake <- struct{}{}:
	default:
	}
}

func (l *stationLink) close() {
	l.once.Do(func() { close(l.done) })
}

// attach gives the link the station's data channel, once it opens.
func (l *stationLink) attach(dc *webrtc.DataChannel) {
	dc.SetBufferedAmountLowThreshold(videoDataWindow / 2)
	dc.OnBufferedAmountLow(l.kick)
	l.mu.Lock()
	l.dc = dc
	l.mu.Unlock()
	l.kick()
}

// send queues one message for the station's data channel.
func (l *stationLink) send(msg []byte) {
	l.mu.Lock()
	l.p.pushData(time.Now(), msg)
	l.mu.Unlock()
	l.kick()
}

// sendAhead queues one message for the station's data channel ahead of everything else waiting.
func (l *stationLink) sendAhead(msg []byte) {
	l.mu.Lock()
	l.p.pushAhead(msg)
	l.mu.Unlock()
	l.kick()
}

// held is the bytes of data channel messages waiting in the link, not yet handed to the channel.
func (l *stationLink) held() uint64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return uint64(l.p.dataBytes)
}

func (l *stationLink) addFeed(f *feed) {
	l.mu.Lock()
	l.p.addFeed(time.Now(), f)
	l.mu.Unlock()
	l.kick()
}

func (l *stationLink) removeFeed(f *feed) {
	l.mu.Lock()
	l.p.removeFeed(f)
	l.mu.Unlock()
	l.kick()
}

func (l *stationLink) packet(f *feed, pkt *rtp.Packet) {
	l.mu.Lock()
	l.p.packet(time.Now(), f, pkt)
	l.mu.Unlock()
	l.kick()
}

func (l *stationLink) report(f *feed, loss float64) {
	l.mu.Lock()
	l.p.report(time.Now(), f, loss)
	l.mu.Unlock()
	l.kick()
}

func (l *stationLink) estimate(bytesPerSecond float64) {
	l.mu.Lock()
	l.p.estimate(bytesPerSecond)
	l.mu.Unlock()
	l.kick()
}

func (l *stationLink) keyframeRequest(f *feed) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.p.keyframeRequest(time.Now(), f)
}

// paceSnapshot is what the bridge heartbeat says of the station's pacer.
type paceSnapshot struct {
	counts  pacerCounts
	limit   float64
	remb    float64
	delay   time.Duration
	queued  int
	held    int
	shedNow int
}

func (l *stationLink) snapshot() paceSnapshot {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	return paceSnapshot{
		counts: l.p.stats, limit: l.p.limit(), remb: l.p.remb, delay: l.p.queueDelay(now),
		queued: len(l.p.media), held: l.p.dataBytes, shedNow: l.p.shedNow(),
	}
}

func (l *stationLink) run() {
	timer := time.NewTimer(time.Hour)
	defer timer.Stop()
	for {
		l.mu.Lock()
		dc := l.dc
		room := 0
		if dc != nil {
			if window := uint64(l.p.dataWindow()); dc.BufferedAmount() < window {
				room = int(window - dc.BufferedAmount())
			}
		}
		pkts, msgs, wait := l.p.pull(time.Now(), room)
		l.mu.Unlock()
		for _, q := range pkts {
			_ = q.f.write(q.pkt)
		}
		for _, m := range msgs {
			_ = dc.Send(m)
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		if wait >= 0 {
			timer.Reset(wait)
		}
		select {
		case <-l.done:
			return
		case <-l.wake:
		case <-timer.C:
		}
	}
}
