package main

import (
	"net"
	"syscall"
)

// sendBufferOf reads the send buffer size the system gave a socket, which can differ from the size asked for.
func sendBufferOf(pc net.PacketConn) (int, error) {
	sc, ok := pc.(syscall.Conn)
	if !ok {
		return 0, syscall.ENOTSOCK
	}
	raw, err := sc.SyscallConn()
	if err != nil {
		return 0, err
	}
	var size int
	var gerr error
	if err := raw.Control(func(fd uintptr) {
		size, gerr = syscall.GetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_SNDBUF)
	}); err != nil {
		return 0, err
	}
	return size, gerr
}
