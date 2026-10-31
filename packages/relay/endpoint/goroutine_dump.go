package main

import (
	"io"
	"os"
	"os/signal"
	"runtime/pprof"
	"syscall"
)

// dumpGoroutines writes every goroutine's stack to w, the same text a SIGQUIT prints.
func dumpGoroutines(w io.Writer) {
	_ = pprof.Lookup("goroutine").WriteTo(w, 2)
}

// dumpGoroutinesOnSignal writes the dump to standard error each time the process gets SIGUSR1, and keeps running, which SIGQUIT does not.
func dumpGoroutinesOnSignal() {
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGUSR1)
	go func() {
		for range sig {
			dumpGoroutines(os.Stderr)
		}
	}()
}
