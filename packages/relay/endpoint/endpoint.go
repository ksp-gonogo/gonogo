package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

// Config is what the endpoint advertises and how long it holds a station that has not connected.
type Config struct {
	// PublicIP is the router's public address, advertised on the one port. Empty advertises none.
	PublicIP string
	// LANIP is this computer's address on the home network. In a container the endpoint's own
	// interface address is the container's, which nothing outside can reach.
	LANIP string
	// OmitUDP leaves every UDP candidate out of the answer, so a station has to join over TCP.
	OmitUDP bool
	// MaxPending is how many sessions may wait for their data channel to open at once.
	MaxPending int
	// PendingTimeout is how long a session may wait for its data channel to open.
	PendingTimeout time.Duration
	// MaxBuffered is how many bytes may wait to go out to one station before it is dropped.
	MaxBuffered uint64
	// includeLoopback lets the endpoint answer on 127.0.0.1, which only a test needs.
	includeLoopback bool
}

const (
	defaultMaxPending     = 8
	defaultPendingTimeout = 15 * time.Second
	defaultMaxBuffered    = 4 << 20
)

// controlFrame is every text frame on the control socket, in both directions.
type controlFrame struct {
	Type   string `json:"type"`
	Sid    uint32 `json:"sid,omitempty"`
	PeerID string `json:"peerId,omitempty"`
	SDP    string `json:"sdp,omitempty"`
	Reason string `json:"reason,omitempty"`
	// Path is "lan" or "internet" on an open frame: where the station's address is.
	Path string `json:"path,omitempty"`
	// Status only.
	PublicIP string `json:"publicIp,omitempty"`
	Port     int    `json:"port,omitempty"`
}

type session struct {
	sid    uint32
	peerID string
	pc     *webrtc.PeerConnection
	dc     *webrtc.DataChannel
	open   bool
	timer  *time.Timer
}

// tab is the main screen's control socket. Writes are serialised because gorilla allows one writer.
type tab struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (t *tab) write(kind int, data []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	_ = t.conn.WriteMessage(kind, data)
}

/*
Endpoint terminates every internet station's WebRTC connection on one UDP port and the
same TCP port number, and passes each station's data channel messages to the main screen
tab over one control WebSocket. A station is never admitted from the open port: the endpoint
only builds a peer connection for an offer the tab sent, so the only STUN it answers carries
the ICE credentials of an answer the tab asked for.

Data frames on the control socket are binary: a 4-byte big-endian session id, then the exact
bytes the station's data channel carried. The endpoint never reads the payload.
*/
type Endpoint struct {
	cfg      Config
	api      *webrtc.API
	port     int
	udp      net.PacketConn
	tcp      net.Listener
	upgrader websocket.Upgrader

	mu       sync.Mutex
	tab      *tab
	sessions map[uint32]*session
}

// New builds an endpoint on an already-bound UDP socket and TCP listener with the same port number.
func New(cfg Config, udp net.PacketConn, tcp net.Listener) (*Endpoint, error) {
	if cfg.MaxPending == 0 {
		cfg.MaxPending = defaultMaxPending
	}
	if cfg.PendingTimeout == 0 {
		cfg.PendingTimeout = defaultPendingTimeout
	}
	if cfg.MaxBuffered == 0 {
		cfg.MaxBuffered = defaultMaxBuffered
	}
	se := webrtc.SettingEngine{}
	se.SetICEUDPMux(webrtc.NewICEUDPMux(nil, udp))
	se.SetICETCPMux(webrtc.NewICETCPMux(nil, tcp, 8))
	se.SetNetworkTypes([]webrtc.NetworkType{
		webrtc.NetworkTypeUDP4, webrtc.NetworkTypeUDP6,
		webrtc.NetworkTypeTCP4, webrtc.NetworkTypeTCP6,
	})
	// A closed tab or a phone that walks out of signal is noticed in seconds rather than half a minute.
	se.SetIncludeLoopbackCandidate(cfg.includeLoopback)
	se.SetICETimeouts(5*time.Second, 10*time.Second, 2*time.Second)
	return &Endpoint{
		cfg:      cfg,
		api:      webrtc.NewAPI(webrtc.WithSettingEngine(se)),
		port:     udp.LocalAddr().(*net.UDPAddr).Port,
		udp:      udp,
		tcp:      tcp,
		sessions: map[uint32]*session{},
		// The socket is reached only through the relay's own proxy, which checks the page's origin.
		upgrader: websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }},
	}, nil
}

// Handler serves the control socket at /stations.
func (e *Endpoint) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/stations", func(w http.ResponseWriter, r *http.Request) {
		conn, err := e.upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		e.serveTab(&tab{conn: conn})
	})
	return mux
}

// Close drops the tab and every station, then the sockets.
func (e *Endpoint) Close() {
	e.mu.Lock()
	t := e.tab
	e.tab = nil
	e.mu.Unlock()
	if t != nil {
		t.conn.Close()
	}
	e.dropAll()
	e.udp.Close()
	e.tcp.Close()
}

func (e *Endpoint) serveTab(t *tab) {
	e.mu.Lock()
	previous := e.tab
	e.tab = t
	e.mu.Unlock()
	if previous != nil {
		log.Printf("a new main screen connected, replacing the previous one")
		previous.conn.Close()
		e.dropAll()
	}
	status, _ := json.Marshal(controlFrame{Type: "status", PublicIP: e.cfg.PublicIP, Port: e.port})
	t.write(websocket.TextMessage, status)

	for {
		kind, msg, err := t.conn.ReadMessage()
		if err != nil {
			break
		}
		if kind == websocket.BinaryMessage {
			e.forward(msg)
			continue
		}
		var f controlFrame
		if json.Unmarshal(msg, &f) != nil {
			continue
		}
		switch f.Type {
		case "offer":
			go e.offer(t, f)
		case "close":
			e.drop(f.Sid, "")
		}
	}

	e.mu.Lock()
	current := e.tab == t
	if current {
		e.tab = nil
	}
	e.mu.Unlock()
	if current {
		e.dropAll()
	}
}

func (e *Endpoint) send(f controlFrame) {
	e.mu.Lock()
	t := e.tab
	e.mu.Unlock()
	if t == nil {
		return
	}
	data, _ := json.Marshal(f)
	t.write(websocket.TextMessage, data)
}

func (e *Endpoint) offer(t *tab, f controlFrame) {
	refuse := func(reason string) { e.send(controlFrame{Type: "close", Sid: f.Sid, Reason: reason}) }

	e.mu.Lock()
	if e.tab != t {
		e.mu.Unlock()
		return
	}
	if _, taken := e.sessions[f.Sid]; taken {
		e.mu.Unlock()
		refuse("sid in use")
		return
	}
	pending := 0
	for _, s := range e.sessions {
		if !s.open {
			pending++
		}
	}
	if pending >= e.cfg.MaxPending {
		e.mu.Unlock()
		refuse("busy")
		return
	}
	pc, err := e.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		e.mu.Unlock()
		refuse(err.Error())
		return
	}
	s := &session{sid: f.Sid, peerID: f.PeerID, pc: pc}
	e.sessions[f.Sid] = s
	s.timer = time.AfterFunc(e.cfg.PendingTimeout, func() { e.drop(s.sid, "timeout") })
	e.mu.Unlock()

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			e.drop(s.sid, state.String())
		}
	})
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		e.mu.Lock()
		if e.sessions[s.sid] != s || s.dc != nil {
			e.mu.Unlock()
			return
		}
		s.dc = dc
		e.mu.Unlock()
		dc.OnOpen(func() {
			e.mu.Lock()
			s.open = true
			s.timer.Stop()
			e.mu.Unlock()
			log.Printf("station %s joined as session %d", s.peerID, s.sid)
			e.send(controlFrame{Type: "open", Sid: s.sid, Path: pathOf(pc)})
		})
		dc.OnMessage(func(m webrtc.DataChannelMessage) {
			e.mu.Lock()
			t := e.tab
			e.mu.Unlock()
			if t == nil {
				return
			}
			frame := make([]byte, 4+len(m.Data))
			binary.BigEndian.PutUint32(frame, s.sid)
			copy(frame[4:], m.Data)
			t.write(websocket.BinaryMessage, frame)
		})
		dc.OnClose(func() { e.drop(s.sid, "closed") })
	})

	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: f.SDP}); err != nil {
		e.drop(s.sid, "bad offer")
		return
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		e.drop(s.sid, "bad offer")
		return
	}
	gathered := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(answer); err != nil {
		e.drop(s.sid, err.Error())
		return
	}
	<-gathered
	sdp := withCandidates(pc.LocalDescription().SDP, e.cfg.PublicIP, e.cfg.LANIP, e.port, e.cfg.OmitUDP)
	e.send(controlFrame{Type: "answer", Sid: s.sid, SDP: sdp})
}

func (e *Endpoint) forward(frame []byte) {
	if len(frame) < 4 {
		return
	}
	sid := binary.BigEndian.Uint32(frame)
	e.mu.Lock()
	s := e.sessions[sid]
	e.mu.Unlock()
	if s == nil || !s.open {
		return
	}
	if s.dc.BufferedAmount() > e.cfg.MaxBuffered {
		e.drop(sid, "too far behind")
		return
	}
	_ = s.dc.Send(frame[4:])
}

// closeDrained gives what the station has already been sent a moment to go out before the connection closes.
func closeDrained(pc *webrtc.PeerConnection, dc *webrtc.DataChannel) {
	for i := 0; i < 100 && dc != nil && dc.BufferedAmount() > 0; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	pc.Close()
}

// drop closes one session and tells the tab, unless the tab asked for it (reason empty).
func (e *Endpoint) drop(sid uint32, reason string) {
	e.mu.Lock()
	s := e.sessions[sid]
	delete(e.sessions, sid)
	var dc *webrtc.DataChannel
	if s != nil {
		dc = s.dc
	}
	e.mu.Unlock()
	if s == nil {
		return
	}
	s.timer.Stop()
	go closeDrained(s.pc, dc)
	if reason != "" {
		e.send(controlFrame{Type: "close", Sid: sid, Reason: reason})
	}
}

func (e *Endpoint) dropAll() {
	e.mu.Lock()
	all := e.sessions
	e.sessions = map[uint32]*session{}
	e.mu.Unlock()
	for _, s := range all {
		s.timer.Stop()
		go s.pc.Close()
	}
}

// pathOf says whether the station's side of the selected pair is on a private network or the internet.
func pathOf(pc *webrtc.PeerConnection) string {
	pair, err := pc.SCTP().Transport().ICETransport().GetSelectedCandidatePair()
	if err != nil || pair == nil {
		return ""
	}
	ip := net.ParseIP(pair.Remote.Address)
	if ip == nil {
		return ""
	}
	if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return "lan"
	}
	return "internet"
}

var ufragLine = regexp.MustCompile(`a=ice-ufrag:(\S+)`)

/*
withCandidates adds the router's public address and the computer's LAN address on the one
port to an answer, for UDP and TCP. Pion's own candidates name only the addresses its sockets
can see, which in a container is the container's, and Pion's NAT 1:1 setting advertises a
random port when the sockets are muxed, so the lines are written by hand.
*/
func withCandidates(sdp, publicIP, lanIP string, port int, omitUDP bool) string {
	ufrag := ""
	if m := ufragLine.FindStringSubmatch(sdp); m != nil {
		ufrag = " ufrag " + m[1]
	}
	var add strings.Builder
	line := func(foundation, proto string, priority uint32, ip, rest string) {
		fmt.Fprintf(&add, "a=candidate:%s 1 %s %d %s %d %s%s\r\n", foundation, proto, priority, ip, port, rest, ufrag)
	}
	if publicIP != "" {
		if !omitUDP {
			line("9001", "udp", 1694498815, publicIP, fmt.Sprintf("typ srflx raddr 0.0.0.0 rport %d", port))
		}
		line("9002", "tcp", 1518280447, publicIP, fmt.Sprintf("typ srflx raddr 0.0.0.0 rport %d tcptype passive", port))
	}
	if lanIP != "" {
		if !omitUDP {
			line("9003", "udp", 2130706430, lanIP, "typ host")
		}
		line("9004", "tcp", 1671430142, lanIP, "typ host tcptype passive")
	}

	var out strings.Builder
	for _, l := range strings.SplitAfter(sdp, "\r\n") {
		if omitUDP && strings.HasPrefix(l, "a=candidate:") && strings.Contains(strings.ToLower(l), " udp ") {
			continue
		}
		if strings.HasPrefix(l, "a=end-of-candidates") {
			out.WriteString(add.String())
		}
		out.WriteString(l)
	}
	return out.String()
}
