package main

import "syscall"

func getSendBuffer(fd int) (int, error) {
	return syscall.GetsockoptInt(fd, syscall.SOL_SOCKET, syscall.SO_SNDBUF)
}
