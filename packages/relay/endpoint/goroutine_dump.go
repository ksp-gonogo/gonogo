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

// dumpGoroutinesOnSignal writes the dump to w each time the process gets SIGUSR1, and keeps running, which SIGQUIT does not. The returned function stops it and waits until it has.
func dumpGoroutinesOnSignal(w io.Writer) (stop func()) {
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGUSR1)
	done := make(chan struct{})
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		for {
			select {
			case <-sig:
				dumpGoroutines(w)
			case <-done:
				return
			}
		}
	}()
	return func() {
		signal.Stop(sig)
		close(done)
		<-finished
	}
}
