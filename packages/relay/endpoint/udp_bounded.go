package main

import (
	"errors"
	"log"
	"net"
	"net/netip"
	"os"
	"sync"
	"time"
)

const (
	// udpWriteLimit is how long one datagram may wait to be sent before it is dropped.
	udpWriteLimit = 250 * time.Millisecond
	// udpBlockedHold is how long datagrams to a destination whose send just timed out are dropped without trying, so a destination that stays unwritable does not take the limit from every other write.
	udpBlockedHold = time.Second
	// udpSendBuffer is the size asked for the shared socket's send buffer.
	udpSendBuffer = 1 << 20
)

/*
boundedWriteConn wraps the one UDP socket every connection of the endpoint shares, so a send
the kernel will not take cannot hold the socket for everyone. Go serialises writers on a
socket, and a send to a destination that is not writable parks inside that lock: the ICE
keepalives, STUN answers and RTCP of every other connection then wait behind it. Each write
here has a deadline, and one that misses it is dropped as a datagram lost on the network is.
A destination that missed is skipped for udpBlockedHold, and the drops are logged at most
once a second with a destination and a size.
*/
type boundedWriteConn struct {
	net.PacketConn
	limit time.Duration
	hold  time.Duration

	// mu makes setting a write deadline and the write it applies to one step. Without it a writer waiting behind a parked one would move the parked write's deadline later.
	mu      sync.Mutex
	blocked map[netip.AddrPort]time.Time
	lastLog time.Time
	dropped int
}

func newBoundedWriteConn(pc net.PacketConn) *boundedWriteConn {
	if c, ok := pc.(interface{ SetWriteBuffer(int) error }); ok {
		if err := c.SetWriteBuffer(udpSendBuffer); err != nil {
			log.Printf("could not enlarge the UDP send buffer: %v", err)
		}
	}
	return &boundedWriteConn{PacketConn: pc, limit: udpWriteLimit, hold: udpBlockedHold, blocked: map[netip.AddrPort]time.Time{}}
}

// ReadFromAddrPort reads one datagram, without allocating an address when the socket allows it.
func (c *boundedWriteConn) ReadFromAddrPort(b []byte) (int, netip.AddrPort, error) {
	if u, ok := c.PacketConn.(*net.UDPConn); ok {
		return u.ReadFromUDPAddrPort(b)
	}
	n, addr, err := c.PacketConn.ReadFrom(b)
	if err != nil {
		return n, netip.AddrPort{}, err
	}
	if u, ok := addr.(*net.UDPAddr); ok {
		return n, u.AddrPort(), nil
	}
	ap, _ := netip.ParseAddrPort(addr.String())
	return n, ap, nil
}

// WriteToAddrPort sends one datagram, or drops it if the destination cannot take it within the limit.
func (c *boundedWriteConn) WriteToAddrPort(b []byte, addr netip.AddrPort) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	if until, ok := c.blocked[addr]; ok {
		if now.Before(until) {
			c.drop(now, addr, len(b), "skipped, its last send timed out")
			return len(b), nil
		}
		delete(c.blocked, addr)
	}
	_ = c.PacketConn.SetWriteDeadline(now.Add(c.limit))
	var n int
	var err error
	if u, ok := c.PacketConn.(*net.UDPConn); ok {
		n, err = u.WriteToUDPAddrPort(b, addr)
	} else {
		n, err = c.PacketConn.WriteTo(b, net.UDPAddrFromAddrPort(addr))
	}
	if errors.Is(err, os.ErrDeadlineExceeded) {
		c.blocked[addr] = time.Now().Add(c.hold)
		c.drop(time.Now(), addr, len(b), "blocked for "+c.limit.String())
		return len(b), nil
	}
	return n, err
}

// WriteTo is WriteToAddrPort for callers that hold a net.Addr.
func (c *boundedWriteConn) WriteTo(b []byte, addr net.Addr) (int, error) {
	if u, ok := addr.(*net.UDPAddr); ok {
		return c.WriteToAddrPort(b, u.AddrPort())
	}
	return c.PacketConn.WriteTo(b, addr)
}

// drop counts a dropped datagram and logs the drops since the last line once a second. The caller holds mu.
func (c *boundedWriteConn) drop(now time.Time, addr netip.AddrPort, size int, reason string) {
	c.dropped++
	if now.Sub(c.lastLog) < time.Second {
		return
	}
	log.Printf("udp write dropped: %d datagrams in the last second, the latest %d bytes to %s (%s)", c.dropped, size, addr, reason)
	c.lastLog = now
	c.dropped = 0
}
