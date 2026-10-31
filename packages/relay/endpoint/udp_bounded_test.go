package main

import (
	"net"
	"net/netip"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// stuckConn is a socket that serialises writers the way an operating system socket does, and parks a write to one destination until its deadline.
type stuckConn struct {
	net.PacketConn
	stuck netip.AddrPort

	fd       sync.Mutex
	mu       sync.Mutex
	deadline time.Time
	sent     []netip.AddrPort
}

func (s *stuckConn) SetWriteDeadline(t time.Time) error {
	s.mu.Lock()
	s.deadline = t
	s.mu.Unlock()
	return nil
}

func (s *stuckConn) WriteTo(b []byte, addr net.Addr) (int, error) {
	to := addr.(*net.UDPAddr).AddrPort()
	s.fd.Lock()
	defer s.fd.Unlock()
	if to == s.stuck {
		for {
			s.mu.Lock()
			past := !s.deadline.IsZero() && time.Now().After(s.deadline)
			s.mu.Unlock()
			if past {
				return 0, os.ErrDeadlineExceeded
			}
			time.Sleep(2 * time.Millisecond)
		}
	}
	s.mu.Lock()
	s.sent = append(s.sent, to)
	s.mu.Unlock()
	return len(b), nil
}

func (s *stuckConn) sentTo(a netip.AddrPort) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, x := range s.sent {
		if x == a {
			n++
		}
	}
	return n
}

func TestOneUnwritableDestinationDoesNotHoldBackTheOthers(t *testing.T) {
	logs := captureLog(t)
	stuck := netip.MustParseAddrPort("192.0.2.24:51160")
	other := netip.MustParseAddrPort("198.51.100.33:40000")
	sock := &stuckConn{stuck: stuck}
	c := newBoundedWriteConn(sock)
	c.limit = 60 * time.Millisecond

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 40; i++ {
			if _, err := c.WriteToAddrPort(make([]byte, 1145), stuck); err != nil {
				t.Error(err)
			}
			time.Sleep(5 * time.Millisecond)
		}
	}()
	time.Sleep(20 * time.Millisecond)

	started := time.Now()
	for i := 0; i < 20; i++ {
		if _, err := c.WriteToAddrPort(make([]byte, 20), other); err != nil {
			t.Fatal(err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	wg.Wait()
	if got := sock.sentTo(other); got != 20 {
		t.Errorf("%d of 20 datagrams reached the other destination", got)
	}
	// Each of the 20 writes may wait for one blocked send at most, and every later send to the stuck destination is skipped.
	if elapsed := time.Since(started); elapsed > 20*10*time.Millisecond+500*time.Millisecond {
		t.Errorf("the other destination's writes took %v", elapsed)
	}
	if got := sock.sentTo(stuck); got != 0 {
		t.Errorf("%d datagrams reached the stuck destination", got)
	}
	out := logs.String()
	if !strings.Contains(out, "udp write dropped:") || !strings.Contains(out, "1145 bytes to 192.0.2.24:51160") {
		t.Errorf("the log does not name the dropped write:\n%s", out)
	}
	if n := strings.Count(out, "udp write dropped:"); n > 3 {
		t.Errorf("the drops were logged %d times in under a second and a half", n)
	}
}

func TestADestinationIsTriedAgainOnceItsHoldEnds(t *testing.T) {
	stuck := netip.MustParseAddrPort("192.0.2.24:51160")
	sock := &stuckConn{stuck: stuck}
	c := newBoundedWriteConn(sock)
	c.limit = 20 * time.Millisecond
	c.hold = 60 * time.Millisecond
	_, _ = c.WriteToAddrPort([]byte{1}, stuck)
	started := time.Now()
	_, _ = c.WriteToAddrPort([]byte{1}, stuck)
	if time.Since(started) > 15*time.Millisecond {
		t.Errorf("a write inside the hold was tried, it took %v", time.Since(started))
	}
	time.Sleep(80 * time.Millisecond)
	started = time.Now()
	_, _ = c.WriteToAddrPort([]byte{1}, stuck)
	if time.Since(started) < 15*time.Millisecond {
		t.Errorf("a write after the hold was skipped, it took %v", time.Since(started))
	}
}

func TestTheEndpointsSocketAsksForALargerSendBuffer(t *testing.T) {
	udp, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer udp.Close()
	before := sendBufferOf(t, udp)
	newBoundedWriteConn(udp)
	if after := sendBufferOf(t, udp); after <= before {
		t.Errorf("the send buffer is %d bytes, it was %d before", after, before)
	}
}

func sendBufferOf(t *testing.T, c *net.UDPConn) int {
	t.Helper()
	raw, err := c.SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	var size int
	var gerr error
	if err := raw.Control(func(fd uintptr) { size, gerr = getSendBuffer(int(fd)) }); err != nil {
		t.Fatal(err)
	}
	if gerr != nil {
		t.Fatal(gerr)
	}
	return size
}
