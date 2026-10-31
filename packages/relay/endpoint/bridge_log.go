package main

import (
	"fmt"
	"log"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4"
)

// bridgeCounts are the packets a bridge has moved on each leg, read by its heartbeat line.
type bridgeCounts struct {
	upstreamRead    atomic.Int64
	stationWritten  atomic.Int64
	stationWriteErr atomic.Int64
	upstreamRTCP    atomic.Int64
	stationRTCP     atomic.Int64
}

// selectedPair names the candidate pair a connection is sending on, or "none" before one is chosen.
func selectedPair(pc *webrtc.PeerConnection) string {
	if pc == nil || pc.SCTP() == nil || pc.SCTP().Transport() == nil {
		return "none"
	}
	pair, err := pc.SCTP().Transport().ICETransport().GetSelectedCandidatePair()
	if err != nil || pair == nil {
		return "none"
	}
	return fmt.Sprintf("%s:%d to %s:%d", pair.Local.Address, pair.Local.Port, pair.Remote.Address, pair.Remote.Port)
}

// watchLeg logs every ICE state change of one connection of the bridge, with the pair it is on.
func (b *bridge) watchLeg(name string, pc *webrtc.PeerConnection) {
	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("bridge %d %s leg ice %s, pair %s", b.serial, name, state, selectedPair(pc))
	})
}

// logLegState logs a connection state change of one connection of the bridge.
func (b *bridge) logLegState(name string, state webrtc.PeerConnectionState, pc *webrtc.PeerConnection) {
	log.Printf("bridge %d %s leg connection %s, pair %s", b.serial, name, state, selectedPair(pc))
}

// heartbeat logs, once per b.beat until the bridge is dropped, what each leg moved since the last line.
func (b *bridge) heartbeat() {
	ticker := time.NewTicker(b.beat)
	defer ticker.Stop()
	var last [5]int64
	for {
		select {
		case <-b.done:
			return
		case <-ticker.C:
		}
		now := [5]int64{
			b.counts.upstreamRead.Load(), b.counts.stationWritten.Load(), b.counts.stationWriteErr.Load(),
			b.counts.upstreamRTCP.Load(), b.counts.stationRTCP.Load(),
		}
		log.Printf("bridge %d heartbeat: upstream read %d packets, station wrote %d (%d failed), upstream rtcp %d, station rtcp %d, upstream %s ice %s, station %s ice %s",
			b.serial, now[0]-last[0], now[1]-last[1], now[2]-last[2], now[3]-last[3], now[4]-last[4],
			b.upstream.ConnectionState(), b.upstream.ICEConnectionState(),
			b.station.ConnectionState(), b.station.ICEConnectionState())
		last = now
	}
}
