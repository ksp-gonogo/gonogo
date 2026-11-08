package main

import (
	"strings"
	"testing"
	"time"
)

func TestAnOfferWhoseStationNeverReachesThePortIsLoggedAsUnreachable(t *testing.T) {
	logs := captureLog(t)
	_, url := startEndpoint(t, Config{ReachDelay: 200 * time.Millisecond, PendingTimeout: time.Second})
	tb := dialTab(t, url)
	tb.send(map[string]any{"type": "offer", "sid": 3, "peerId": "station-a", "sdp": newStation(t).offer(t)})
	tb.next("answer")
	waitForLog(t, logs, "station station-a offered as session 3 with no candidates, answered with udp and tcp on lan 127.0.0.1:")
	waitForLog(t, logs, "station station-a session 3: nothing from the station reached port")
	waitForLog(t, logs, "the port may not be reachable from outside the container or through the router (ice ")
	tb.next("close")
	waitForLog(t, logs, "station station-a session 3 dropped before it opened: timeout (ice ")
}

func TestAStationThatJoinsIsNeverCalledUnreachableAndItsCloseIsLogged(t *testing.T) {
	logs := captureLog(t)
	_, url := startEndpoint(t, Config{ReachDelay: 300 * time.Millisecond})
	tb := dialTab(t, url)
	waitForLog(t, logs, "main screen connected; stations are offered udp and tcp on lan 127.0.0.1:")
	join(t, tb, newStation(t), 7, "station-b")
	time.Sleep(600 * time.Millisecond)
	if strings.Contains(logs.String(), "may not be reachable") {
		t.Fatalf("a station that joined was logged as unreachable:\n%s", logs.String())
	}
	tb.send(map[string]any{"type": "close", "sid": 7})
	waitForLog(t, logs, "station station-b session 7 closed: the main screen closed it")
	tb.conn.Close()
	waitForLog(t, logs, "main screen left (")
}

func TestOfferedCandidatesCountsEachTypeAndTheHiddenHostsApart(t *testing.T) {
	sdp := strings.Join([]string{
		"v=0",
		"a=candidate:1 1 udp 2122260223 9b1f3c.local 54321 typ host generation 0",
		"a=candidate:2 1 udp 1686052607 92.17.22.1 54321 typ srflx raddr 0.0.0.0 rport 0",
		"a=candidate:3 1 tcp 1518280447 198.51.100.5 9 typ host tcptype active",
		"a=candidate:4 1 udp 41885439 203.0.113.1 3478 typ relay raddr 0.0.0.0 rport 0",
	}, "\r\n")
	want := "4 candidates (host 1, mdns host 1, relay 1, srflx 1)"
	if got := offeredCandidates(sdp); got != want {
		t.Errorf("got %q, wanted %q", got, want)
	}
	if got := offeredCandidates("v=0\r\n"); got != "no candidates" {
		t.Errorf("an offer with no candidates reads %q", got)
	}
}

func TestAdvertisedNamesWhatTheAnswerAdds(t *testing.T) {
	cases := []struct {
		public, lan string
		omitUDP     bool
		want        string
	}{
		{"92.17.22.202", "203.0.113.24", false, "udp and tcp on public 92.17.22.202:47100 and lan 203.0.113.24:47100"},
		{"92.17.22.202", "", true, "tcp on public 92.17.22.202:47100"},
		{"", "", false, "no address of its own, only the container's"},
	}
	for _, c := range cases {
		if got := advertised(c.public, c.lan, 47100, c.omitUDP); got != c.want {
			t.Errorf("got %q, wanted %q", got, c.want)
		}
	}
}
