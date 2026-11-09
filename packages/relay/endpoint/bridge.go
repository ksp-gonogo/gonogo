package main

import (
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

/*
A bridge carries one media connection a joined station opens, such as a camera feed, to a
server on the home network the station cannot reach: the station's connection ends here, and
the endpoint opens its own connection upstream in the same shape. The main screen negotiates
the upstream side with that server, because only it knows how. Each video or audio section
keeps the station's mid on both sides, so anything the two ends say about a section by its
mid still names the same one, and data channels and keyframe requests are passed through.

Video costs one copy of the stream per bridged station on the home internet upload.
*/
type bridge struct {
	id  uint32
	sid uint32
	// serial numbers the endpoint's bridges in the order they were opened and is the number the log lines carry, because the main screen restarts its own ids at 1 each time it loads.
	serial uint32
	// offer is the station's offer, answered once the upstream side is negotiated.
	offer    string
	sections []section
	station  *webrtc.PeerConnection
	upstream *webrtc.PeerConnection
	timer    *time.Timer
	// beat is how often the bridge logs its traffic counts.
	beat time.Duration
	// done closes when the bridge is dropped.
	done      chan struct{}
	closeOnce sync.Once
	counts    bridgeCounts

	mu sync.Mutex
	// local is the track sent to the station for each mid.
	local map[string]*webrtc.TrackLocalStaticRTP
	// remote is the track the upstream server sends for each mid, once it arrives.
	remote map[string]*webrtc.TrackRemote
	// asked is the video mids already sent the keyframe request made when the station's leg connected.
	asked map[string]bool
	// stationUp is set once the station's leg is connected, so a track that arrives later is asked for a keyframe at once.
	stationUp atomic.Bool
	// link is the station's pacer, shared with its data channel and its other bridges.
	link *stationLink
	// feeds is each section the link forwards, by mid, once its media arrives.
	feeds map[string]*feed
}

type section struct {
	mid  string
	kind webrtc.RTPCodecType
}

const bridgeTimeout = 15 * time.Second

/*
bridgedVideoFmtp is the one video format the camera server sends: constrained baseline, with
packetization mode 1 because its packets carry fragmented and aggregated units, which mode 0
does not allow. The upstream offer lists only this format, so the server's answer names the
codec it will send and nothing else. A station is answered with the same codec, never another
H.264 format the browser also offered.
*/
const bridgedVideoFmtp = "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"

func bridgedVideoCodec() webrtc.RTPCodecParameters {
	return webrtc.RTPCodecParameters{RTPCodecCapability: webrtc.RTPCodecCapability{
		MimeType:     webrtc.MimeTypeH264,
		ClockRate:    90000,
		SDPFmtpLine:  bridgedVideoFmtp,
		RTCPFeedback: []webrtc.RTCPFeedback{{Type: "nack"}, {Type: "nack", Parameter: "pli"}},
	}}
}

func (e *Endpoint) bridgeOffer(f controlFrame) {
	refuse := func(reason string) { e.send(controlFrame{Type: "bridge-close", Bid: f.Bid, Reason: reason}) }

	sections, hasData, err := mediaSections(f.SDP)
	if err != nil {
		refuse("bad offer")
		return
	}
	upstream, err := e.api.NewPeerConnection(webrtc.Configuration{AlwaysNegotiateDataChannels: hasData})
	if err != nil {
		refuse(err.Error())
		return
	}
	b := &bridge{
		id: f.Bid, sid: f.Sid, offer: f.SDP, sections: sections, upstream: upstream,
		local: map[string]*webrtc.TrackLocalStaticRTP{}, remote: map[string]*webrtc.TrackRemote{}, asked: map[string]bool{},
		feeds: map[string]*feed{},
		done:  make(chan struct{}), beat: e.cfg.HeartbeatInterval,
	}
	b.watchLeg("upstream", upstream)

	e.mu.Lock()
	s := e.sessions[f.Sid]
	_, taken := e.bridges[f.Bid]
	if s == nil || !s.open || taken {
		e.mu.Unlock()
		upstream.Close()
		if taken {
			refuse("bid in use")
		} else {
			refuse("no such station")
		}
		return
	}
	e.bridgeSerial++
	b.serial = e.bridgeSerial
	b.link = s.link
	e.bridges[f.Bid] = b
	b.timer = time.AfterFunc(bridgeTimeout, func() { e.dropBridge(b.id, "timeout") })
	e.mu.Unlock()
	log.Printf("bridge %d is bid %d of session %d", b.serial, b.id, b.sid)

	for _, sec := range sections {
		tr, err := upstream.AddTransceiverFromKind(sec.kind, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly})
		if err == nil {
			err = tr.SetMid(sec.mid)
		}
		if err == nil && sec.kind == webrtc.RTPCodecTypeVideo {
			err = tr.SetCodecPreferences([]webrtc.RTPCodecParameters{bridgedVideoCodec()})
		}
		if err != nil {
			e.dropBridge(b.id, err.Error())
			return
		}
	}
	upstream.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		mid := receiver.RTPTransceiver().Mid()
		log.Printf("bridge %d section %s upstream sends payload type %d: %s", b.serial, mid, track.PayloadType(), describeCodec(track.Codec().RTPCodecCapability))
		b.mu.Lock()
		b.remote[mid] = track
		local := b.local[mid]
		b.mu.Unlock()
		if b.stationUp.Load() {
			b.askForKeyframe(mid, track)
		}
		if local == nil {
			return
		}
		go func() {
			for {
				pkts, _, err := receiver.ReadRTCP()
				if err != nil {
					return
				}
				b.counts.upstreamRTCP.Add(int64(len(pkts)))
			}
		}()
		f := &feed{
			name: fmt.Sprintf("bridge %d section %s", b.serial, mid),
			kind: track.Kind(),
			write: func(pkt *rtp.Packet) error {
				err := local.WriteRTP(pkt)
				if err != nil {
					b.counts.stationWriteErr.Add(1)
				} else {
					b.counts.stationWritten.Add(1)
				}
				return err
			},
			askKeyframe: func() {
				if b.upstream.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(track.SSRC())}}) == nil {
					b.counts.keyframeRequests.Add(1)
				}
			},
		}
		b.mu.Lock()
		b.feeds[mid] = f
		b.mu.Unlock()
		b.link.addFeed(f)
		defer b.link.removeFeed(f)
		for {
			pkt, _, err := track.ReadRTP()
			if err != nil {
				return
			}
			b.counts.upstreamRead.Add(1)
			b.link.packet(f, pkt)
		}
	})
	upstream.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		b.logLegState("upstream", state, upstream)
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			e.dropBridge(b.id, "upstream "+state.String())
		}
	})

	offer, err := upstream.CreateOffer(nil)
	if err != nil {
		e.dropBridge(b.id, err.Error())
		return
	}
	gathered := webrtc.GatheringCompletePromise(upstream)
	if err := upstream.SetLocalDescription(offer); err != nil {
		e.dropBridge(b.id, err.Error())
		return
	}
	<-gathered
	// The upstream server is on the home network, so it is given the LAN address alone.
	sdpText := withCandidates(upstream.LocalDescription().SDP, "", e.cfg.LANIP, e.port, false)
	e.send(controlFrame{Type: "bridge-offer", Bid: b.id, SDP: sdpText})
}

func (e *Endpoint) bridgeAnswer(f controlFrame) {
	e.mu.Lock()
	b := e.bridges[f.Bid]
	e.mu.Unlock()
	if b == nil || b.station != nil {
		return
	}
	if err := b.upstream.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: f.SDP}); err != nil {
		e.dropBridge(b.id, "bad answer")
		return
	}
	codecs, err := answeredCodecs(f.SDP)
	if err != nil {
		e.dropBridge(b.id, "bad answer")
		return
	}

	station, err := e.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		e.dropBridge(b.id, err.Error())
		return
	}
	e.mu.Lock()
	if e.bridges[b.id] != b {
		e.mu.Unlock()
		station.Close()
		return
	}
	b.station = station
	e.mu.Unlock()

	senders := map[*webrtc.RTPSender]string{}
	for _, sec := range b.sections {
		codec, ok := codecs[sec.mid]
		if !ok {
			continue
		}
		log.Printf("bridge %d section %s upstream answered %s", b.serial, sec.mid, describeCodec(codec))
		track, err := webrtc.NewTrackLocalStaticRTP(codec, sec.kind.String()+sec.mid, "bridge")
		if err != nil {
			e.dropBridge(b.id, err.Error())
			return
		}
		sender, err := station.AddTrack(track)
		if err != nil {
			e.dropBridge(b.id, err.Error())
			return
		}
		senders[sender] = sec.mid
		b.mu.Lock()
		b.local[sec.mid] = track
		b.mu.Unlock()
	}

	b.watchLeg("station", station)
	station.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		b.logLegState("station", state, station)
		if state == webrtc.PeerConnectionStateConnected {
			b.stationUp.Store(true)
			b.askForKeyframes()
		}
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			e.dropBridge(b.id, "station "+state.String())
		}
	})
	station.OnDataChannel(func(dc *webrtc.DataChannel) { b.pipeChannel(dc, b.upstream, "station", "upstream") })
	b.upstream.OnDataChannel(func(dc *webrtc.DataChannel) { b.pipeChannel(dc, station, "upstream", "station") })

	if err := station.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: b.offer}); err != nil {
		e.dropBridge(b.id, "bad offer")
		return
	}
	// The tracks were added before the offer, so each was matched to a section by kind and order; read back which mid each one landed on.
	for _, tr := range station.GetTransceivers() {
		sender := tr.Sender()
		if sender == nil || sender.Track() == nil {
			continue
		}
		if mid := tr.Mid(); mid != senders[sender] {
			b.mu.Lock()
			local := b.local[senders[sender]]
			delete(b.local, senders[sender])
			b.local[mid] = local
			b.mu.Unlock()
			senders[sender] = mid
		}
		go b.relayKeyframeRequests(sender, senders[sender])
		if tr.Kind() == webrtc.RTPCodecTypeVideo {
			if codec, ok := codecs[senders[sender]]; ok {
				if err := tr.SetCodecPreferences([]webrtc.RTPCodecParameters{{RTPCodecCapability: withREMB(codec)}}); err != nil {
					e.dropBridge(b.id, "station offered no "+describeCodec(codec))
					return
				}
			}
		}
	}
	answer, err := station.CreateAnswer(nil)
	if err != nil {
		e.dropBridge(b.id, err.Error())
		return
	}
	gathered := webrtc.GatheringCompletePromise(station)
	if err := station.SetLocalDescription(answer); err != nil {
		e.dropBridge(b.id, err.Error())
		return
	}
	<-gathered
	b.timer.Stop()
	e.mu.Lock()
	beating := !e.closing
	if beating {
		e.beats.Add(1)
	}
	e.mu.Unlock()
	if beating {
		go func() {
			defer e.beats.Done()
			b.heartbeat()
		}()
	}
	log.Printf("bridge %d for session %d ready with %d sections", b.serial, b.sid, len(b.sections))
	for mid, pt := range answeredPayloadTypes(station.LocalDescription().SDP) {
		log.Printf("bridge %d section %s station answered %s", b.serial, mid, pt)
	}
	sdpText := withCandidates(station.LocalDescription().SDP, e.cfg.PublicIP, e.cfg.LANIP, e.port, e.cfg.OmitUDP)
	e.send(controlFrame{Type: "bridge-ready", Bid: b.id, SDP: sdpText})
}

// senderSends is whether ssrc is the stream a sender writes.
func senderSends(sender *webrtc.RTPSender, ssrc uint32) bool {
	for _, enc := range sender.GetParameters().Encodings {
		if uint32(enc.SSRC) == ssrc {
			return true
		}
	}
	return false
}

/*
withREMB adds the REMB feedback to a codec answered to a station, so a browser that estimates
its own bandwidth reports it and the station's pacer can hold the media under it.
*/
func withREMB(c webrtc.RTPCodecCapability) webrtc.RTPCodecCapability {
	for _, fb := range c.RTCPFeedback {
		if fb.Type == webrtc.TypeRTCPFBGoogREMB {
			return c
		}
	}
	c.RTCPFeedback = append(append([]webrtc.RTCPFeedback{}, c.RTCPFeedback...), webrtc.RTCPFeedback{Type: webrtc.TypeRTCPFBGoogREMB})
	return c
}

/*
relayKeyframeRequests reads what the station reports for one mid: its loss and bitrate
estimate go to the station's pacer, and its picture loss and full intra requests go upstream
unless the pacer holds them back.
*/
func (b *bridge) relayKeyframeRequests(sender *webrtc.RTPSender, mid string) {
	for {
		pkts, _, err := sender.ReadRTCP()
		if err != nil {
			return
		}
		b.counts.stationRTCP.Add(int64(len(pkts)))
		b.mu.Lock()
		f := b.feeds[mid]
		remote := b.remote[mid]
		b.mu.Unlock()
		for _, p := range pkts {
			switch p := p.(type) {
			case *rtcp.ReceiverReport:
				if f == nil {
					continue
				}
				for _, block := range p.Reports {
					if senderSends(sender, block.SSRC) {
						b.link.report(f, float64(block.FractionLost)/256)
					}
				}
				continue
			case *rtcp.ReceiverEstimatedMaximumBitrate:
				b.link.estimate(float64(p.Bitrate) / 8)
				continue
			case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
			default:
				continue
			}
			if remote != nil && b.link.keyframeRequest(f) {
				_ = b.upstream.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(remote.SSRC())}})
				b.counts.keyframeRequests.Add(1)
			}
		}
	}
}

/*
askForKeyframes asks the upstream server for a keyframe on every video section it already
sends, once each, when the station's leg connects. A camera named in the offer starts sending
before any viewer asks and its next keyframe can be a full group of pictures away, so a
station that connects mid-group would otherwise see nothing until then.
*/
func (b *bridge) askForKeyframes() {
	b.mu.Lock()
	tracks := make(map[string]*webrtc.TrackRemote, len(b.remote))
	for mid, track := range b.remote {
		tracks[mid] = track
	}
	b.mu.Unlock()
	for mid, track := range tracks {
		b.askForKeyframe(mid, track)
	}
}

// askForKeyframe sends one picture loss indication for a video section, the first time it is called for that mid.
func (b *bridge) askForKeyframe(mid string, track *webrtc.TrackRemote) {
	if track.Kind() != webrtc.RTPCodecTypeVideo {
		return
	}
	b.mu.Lock()
	again := b.asked[mid]
	b.asked[mid] = true
	b.mu.Unlock()
	if again {
		return
	}
	if err := b.upstream.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(track.SSRC())}}); err != nil {
		return
	}
	b.counts.keyframeRequests.Add(1)
	log.Printf("bridge %d section %s asked the upstream for a keyframe", b.serial, mid)
}

/*
pipeChannel mirrors a data channel one side opened onto the other connection, under the same
label and ordering, and copies messages both ways. What arrives before the mirror opens is
held and sent once it does. `from` and `to` name the two legs in the log, which records each
channel opening and closing and which leg closed first, because closing one closes the other,
and the size of the first messages each way, every failed send and the totals at close, which
together say whether a channel that opened ever carried what its ends expect.
*/
func (b *bridge) pipeChannel(dc *webrtc.DataChannel, other *webrtc.PeerConnection, from, to string) {
	log.Printf("bridge %d %s opened data channel %q", b.serial, from, dc.Label())
	ordered := dc.Ordered()
	init := &webrtc.DataChannelInit{Ordered: &ordered}
	if p := dc.MaxRetransmits(); p != nil {
		init.MaxRetransmits = p
	}
	if p := dc.MaxPacketLifeTime(); p != nil {
		init.MaxPacketLifeTime = p
	}
	mirror, err := other.CreateDataChannel(dc.Label(), init)
	if err != nil {
		dc.Close()
		return
	}
	var mu sync.Mutex
	open := false
	var held []webrtc.DataChannelMessage
	var forward, back atomic.Int64
	label := dc.Label()
	send := func(to *webrtc.DataChannel, m webrtc.DataChannelMessage, count *atomic.Int64, way string) {
		var err error
		if m.IsString {
			err = to.SendText(string(m.Data))
		} else {
			err = to.Send(m.Data)
		}
		if n := count.Add(1); n <= loggedChannelMessages || err != nil {
			why := ""
			if err != nil {
				why = ", not sent: " + err.Error()
			}
			log.Printf("bridge %d %s on %q: message %d, %d bytes%s", b.serial, way, label, n, len(m.Data), why)
		}
	}
	ahead, behind := from+" to "+to, to+" to "+from
	mirror.OnOpen(func() {
		mu.Lock()
		open = true
		pending := held
		held = nil
		mu.Unlock()
		if len(pending) > 0 {
			log.Printf("bridge %d %s held %d messages on %q until its copy opened", b.serial, ahead, len(pending), label)
		}
		for _, m := range pending {
			send(mirror, m, &forward, ahead)
		}
	})
	dc.OnMessage(func(m webrtc.DataChannelMessage) {
		mu.Lock()
		if !open {
			held = append(held, m)
			mu.Unlock()
			return
		}
		mu.Unlock()
		send(mirror, m, &forward, ahead)
	})
	mirror.OnMessage(func(m webrtc.DataChannelMessage) { send(dc, m, &back, behind) })
	var totals sync.Once
	logTotals := func() {
		totals.Do(func() {
			log.Printf("bridge %d data channel %q carried %d messages %s and %d %s", b.serial, label, forward.Load(), ahead, back.Load(), behind)
		})
	}
	dc.OnClose(func() {
		log.Printf("bridge %d %s leg closed data channel %q, closing its copy on the %s leg", b.serial, from, label, to)
		logTotals()
		mirror.Close()
	})
	mirror.OnClose(func() {
		log.Printf("bridge %d %s leg closed data channel %q, closing its copy on the %s leg", b.serial, to, label, from)
		logTotals()
		dc.Close()
	})
}

// loggedChannelMessages is how many messages each way a piped data channel logs, from its first, before it logs only failed sends and its totals at close.
const loggedChannelMessages = 8

// dropBridge closes one bridge and both its connections, and tells the tab unless the tab asked for it (reason empty).
func (e *Endpoint) dropBridge(bid uint32, reason string) {
	e.mu.Lock()
	b := e.bridges[bid]
	delete(e.bridges, bid)
	e.mu.Unlock()
	if b == nil {
		return
	}
	if reason == "" {
		log.Printf("bridge %d closed: the main screen asked", b.serial)
	} else {
		log.Printf("bridge %d closed: %s", b.serial, reason)
	}
	b.shutdown()
	if reason != "" {
		e.send(controlFrame{Type: "bridge-close", Bid: bid, Reason: reason})
	}
}

// shutdown stops the bridge's timer and heartbeat and closes both its connections, once however many paths reach it.
func (b *bridge) shutdown() {
	b.closeOnce.Do(func() {
		b.timer.Stop()
		close(b.done)
		go b.upstream.Close()
		if b.station != nil {
			go b.station.Close()
		}
	})
}

// dropBridgesOf closes every bridge a station opened, when the station leaves.
func (e *Endpoint) dropBridgesOf(sid uint32) {
	e.mu.Lock()
	var ids []uint32
	for id, b := range e.bridges {
		if b.sid == sid {
			ids = append(ids, id)
		}
	}
	e.mu.Unlock()
	for _, id := range ids {
		e.dropBridge(id, "station left")
	}
}

// mediaSections lists an offer's audio and video sections with their mids, in order, and whether it opens data channels.
func mediaSections(offer string) ([]section, bool, error) {
	var desc sdp.SessionDescription
	if err := desc.Unmarshal([]byte(offer)); err != nil {
		return nil, false, err
	}
	var out []section
	hasData := false
	for _, md := range desc.MediaDescriptions {
		mid, _ := md.Attribute("mid")
		switch md.MediaName.Media {
		case "video":
			out = append(out, section{mid: mid, kind: webrtc.RTPCodecTypeVideo})
		case "audio":
			out = append(out, section{mid: mid, kind: webrtc.RTPCodecTypeAudio})
		case "application":
			hasData = true
		}
	}
	return out, hasData, nil
}

// describeCodec is a codec as one log line: its name, clock rate and format parameters.
func describeCodec(c webrtc.RTPCodecCapability) string {
	return fmt.Sprintf("%s/%d fmtp %q", c.MimeType, c.ClockRate, c.SDPFmtpLine)
}

// answeredPayloadTypes lists, for each media section of an answer, the formats it carries in order, each as "pt name fmtp".
func answeredPayloadTypes(answer string) map[string]string {
	var desc sdp.SessionDescription
	if err := desc.Unmarshal([]byte(answer)); err != nil {
		return nil
	}
	out := map[string]string{}
	for _, md := range desc.MediaDescriptions {
		kind := md.MediaName.Media
		if kind != "video" && kind != "audio" {
			continue
		}
		mid, _ := md.Attribute("mid")
		var parts []string
		for _, pt := range md.MediaName.Formats {
			line := pt
			for _, a := range md.Attributes {
				switch {
				case a.Key == "rtpmap" && strings.HasPrefix(a.Value, pt+" "):
					line += " " + strings.TrimPrefix(a.Value, pt+" ")
				case a.Key == "fmtp" && strings.HasPrefix(a.Value, pt+" "):
					line += " " + strings.TrimPrefix(a.Value, pt+" ")
				}
			}
			parts = append(parts, line)
		}
		out[mid] = strings.Join(parts, " | ")
	}
	return out
}

/*
answeredCodecs reads the codec the upstream server chose for each media section of its answer:
the first format that is a media codec, with its clock rate, format parameters and feedback.
An answer lists every format both sides can use, retransmission formats among them, so the
first line is not always the codec that is sent; the upstream offer is narrowed so that it is.
*/
func answeredCodecs(answer string) (map[string]webrtc.RTPCodecCapability, error) {
	var desc sdp.SessionDescription
	if err := desc.Unmarshal([]byte(answer)); err != nil {
		return nil, err
	}
	out := map[string]webrtc.RTPCodecCapability{}
	for _, md := range desc.MediaDescriptions {
		kind := md.MediaName.Media
		if (kind != "video" && kind != "audio") || len(md.MediaName.Formats) == 0 {
			continue
		}
		mid, _ := md.Attribute("mid")
		var codec webrtc.RTPCodecCapability
		for _, pt := range md.MediaName.Formats {
			codec = webrtc.RTPCodecCapability{}
			for _, a := range md.Attributes {
				switch {
				case a.Key == "rtpmap" && strings.HasPrefix(a.Value, pt+" "):
					parts := strings.Split(strings.TrimPrefix(a.Value, pt+" "), "/")
					codec.MimeType = kind + "/" + parts[0]
					if len(parts) > 1 {
						rate, _ := strconv.ParseUint(parts[1], 10, 32)
						codec.ClockRate = uint32(rate)
					}
					if len(parts) > 2 {
						channels, _ := strconv.ParseUint(parts[2], 10, 16)
						codec.Channels = uint16(channels)
					}
				case a.Key == "fmtp" && strings.HasPrefix(a.Value, pt+" "):
					codec.SDPFmtpLine = strings.TrimPrefix(a.Value, pt+" ")
				case a.Key == "rtcp-fb" && strings.HasPrefix(a.Value, pt+" "):
					fb := strings.Fields(strings.TrimPrefix(a.Value, pt+" "))
					if len(fb) > 0 {
						f := webrtc.RTCPFeedback{Type: fb[0]}
						if len(fb) > 1 {
							f.Parameter = fb[1]
						}
						codec.RTCPFeedback = append(codec.RTCPFeedback, f)
					}
				}
			}
			if codec.MimeType != "" && !isAuxiliaryCodec(codec.MimeType) {
				break
			}
			codec = webrtc.RTPCodecCapability{}
		}
		if codec.MimeType == "" {
			return nil, fmt.Errorf("section %s names no codec", mid)
		}
		out[mid] = codec
	}
	return out, nil
}

// isAuxiliaryCodec is whether a format carries repair or redundancy for another format and no media of its own.
func isAuxiliaryCodec(mime string) bool {
	switch strings.ToLower(mime[strings.Index(mime, "/")+1:]) {
	case "rtx", "red", "ulpfec", "flexfec-03":
		return true
	}
	return false
}
