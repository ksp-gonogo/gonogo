package main

import (
	"bytes"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestTheGoroutineDumpNamesTheStacksItIsAskedFor(t *testing.T) {
	var out bytes.Buffer
	dumpGoroutines(&out)
	if !strings.Contains(out.String(), "TestTheGoroutineDumpNamesTheStacksItIsAskedFor") {
		t.Errorf("the dump has no stack of the running test:\n%s", out.String())
	}
}

func TestSIGUSR1DumpsGoroutinesAndTheProcessKeepsRunning(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	stop := dumpGoroutinesOnSignal(w)
	t.Cleanup(stop)
	if err := syscall.Kill(os.Getpid(), syscall.SIGUSR1); err != nil {
		t.Fatal(err)
	}
	got := make(chan string, 1)
	go func() {
		buf := make([]byte, 64*1024)
		n, _ := r.Read(buf)
		got <- string(buf[:n])
	}()
	select {
	case s := <-got:
		if !strings.Contains(s, "goroutine ") {
			t.Errorf("the signal wrote %q", s)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the signal wrote no dump")
	}
}
