// Command gonogo-endpoint is the one-port WebRTC endpoint the relay starts for stations on other networks.
package main

import (
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
)

func main() {
	port := flag.Int("port", 47100, "the one UDP port, and the same TCP port number, every station connects on")
	control := flag.String("control", "127.0.0.1:3003", "address of the main screen's control socket")
	publicIP := flag.String("public-ip", "", "the router's public address to advertise")
	lanIP := flag.String("lan-ip", "", "this computer's address on the home network to advertise")
	omitUDP := flag.Bool("omit-udp", false, "advertise TCP only, to prove the TCP fallback")
	flag.Parse()
	log.SetFlags(0)

	udp, err := net.ListenUDP("udp", &net.UDPAddr{Port: *port})
	if err != nil {
		log.Fatalf("cannot listen on UDP %d: %v", *port, err)
	}
	tcp, err := net.Listen("tcp", ":"+strconv.Itoa(*port))
	if err != nil {
		log.Fatalf("cannot listen on TCP %d: %v", *port, err)
	}
	e, err := New(Config{PublicIP: *publicIP, LANIP: *lanIP, OmitUDP: *omitUDP}, udp, tcp)
	if err != nil {
		log.Fatal(err)
	}

	srv := &http.Server{Addr: *control, Handler: e.Handler()}
	go func() {
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("control socket: %v", err)
		}
	}()
	log.Printf("endpoint listening on UDP and TCP %d, advertising %q and %q", *port, *publicIP, *lanIP)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	srv.Close()
	e.Close()
}
