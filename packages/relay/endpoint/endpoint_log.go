package main

import (
	"fmt"
	"log"
	"sort"
	"strings"

	"github.com/pion/webrtc/v4"
)

// advertised names the addresses an answer adds on the one port, as withCandidates writes them.
func advertised(publicIP, lanIP string, port int, omitUDP bool) string {
	protocols := "udp and tcp"
	if omitUDP {
		protocols = "tcp"
	}
	var addrs []string
	if publicIP != "" {
		addrs = append(addrs, fmt.Sprintf("public %s:%d", publicIP, port))
	}
	if lanIP != "" {
		addrs = append(addrs, fmt.Sprintf("lan %s:%d", lanIP, port))
	}
	if len(addrs) == 0 {
		return "no address of its own, only the container's"
	}
	return protocols + " on " + strings.Join(addrs, " and ")
}

/*
offeredCandidates counts the candidates a station's offer carries by type, with the host
candidates a browser hides behind an mDNS name counted apart, since the endpoint cannot
resolve those and a station offering nothing else can only be reached by its own checks.
*/
func offeredCandidates(sdp string) string {
	counts := map[string]int{}
	total := 0
	for _, l := range strings.Split(sdp, "\n") {
		l = strings.TrimSpace(l)
		if !strings.HasPrefix(l, "a=candidate:") {
			continue
		}
		fields := strings.Fields(l)
		kind := "unknown"
		for i := 0; i+1 < len(fields); i++ {
			if fields[i] == "typ" {
				kind = fields[i+1]
				break
			}
		}
		if kind == "host" && len(fields) > 4 && strings.HasSuffix(fields[4], ".local") {
			kind = "mdns host"
		}
		counts[kind]++
		total++
	}
	if total == 0 {
		return "no candidates"
	}
	return fmt.Sprintf("%d candidates (%s)", total, joinCounts(counts))
}

func joinCounts(counts map[string]int) string {
	keys := make([]string, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s %d", k, counts[k]))
	}
	return strings.Join(parts, ", ")
}

// iceChecks is what one session's ICE agent has seen of the station.
type iceChecks struct {
	state             webrtc.ICEConnectionState
	pairs             map[string]int
	remote            map[string]int
	requestsReceived  uint64
	responsesReceived uint64
	requestsSent      uint64
}

func readICEChecks(pc *webrtc.PeerConnection) iceChecks {
	c := iceChecks{state: pc.ICEConnectionState(), pairs: map[string]int{}, remote: map[string]int{}}
	for _, s := range pc.GetStats() {
		switch st := s.(type) {
		case webrtc.ICECandidatePairStats:
			c.pairs[string(st.State)]++
			c.requestsReceived += st.RequestsReceived
			c.responsesReceived += st.ResponsesReceived
			c.requestsSent += st.RequestsSent
		case webrtc.ICECandidateStats:
			if st.Type == webrtc.StatsTypeRemoteCandidate {
				c.remote[st.Protocol+" "+st.CandidateType.String()]++
			}
		}
	}
	return c
}

// heardNothing is true when no connectivity check or answer to one has come from the station.
func (c iceChecks) heardNothing() bool {
	return c.requestsReceived == 0 && c.responsesReceived == 0
}

func (c iceChecks) String() string {
	pairs, remote := "none", "none"
	if len(c.pairs) > 0 {
		pairs = joinCounts(c.pairs)
	}
	if len(c.remote) > 0 {
		remote = joinCounts(c.remote)
	}
	return fmt.Sprintf("ice %s, station candidates %s, pairs %s, checks received %d, answers received %d, checks sent %d",
		c.state, remote, pairs, c.requestsReceived, c.responsesReceived, c.requestsSent)
}

/*
checkReach runs once a session has had reachDelay to open. A session still pending whose ICE
agent has heard nothing from the station at all means no packet of the station's reached the
endpoint's port: the port is not published from the container, not forwarded by the router, or
the advertised address is wrong. A station whose packets arrive but which has not opened yet
is still working, and its fate is logged when it opens or is dropped.
*/
func (e *Endpoint) checkReach(s *session) {
	e.mu.Lock()
	pending := e.sessions[s.sid] == s && !s.open
	e.mu.Unlock()
	if !pending {
		return
	}
	checks := readICEChecks(s.pc)
	if !checks.heardNothing() {
		return
	}
	log.Printf("station %s session %d: nothing from the station reached port %d in %s; the port may not be reachable from outside the container or through the router (%s)",
		s.peerID, s.sid, e.port, e.cfg.ReachDelay, checks)
}

// logDrop says why a session ended: an open one with its reason, a pending one with what its ICE agent saw.
func logDrop(s *session, open bool, reason string) {
	why := reason
	if why == "" {
		why = "the main screen closed it"
	}
	if open {
		log.Printf("station %s session %d closed: %s", s.peerID, s.sid, why)
		return
	}
	log.Printf("station %s session %d dropped before it opened: %s (%s)", s.peerID, s.sid, why, readICEChecks(s.pc))
}
