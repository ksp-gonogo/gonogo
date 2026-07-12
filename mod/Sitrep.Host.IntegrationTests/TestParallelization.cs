using Xunit;

// These integration tests each spin up a REAL WebSocket server + clients on an
// ephemeral port. xUnit runs test CLASSES in parallel by default, and this
// project has a dozen of them — so on a busy CI runner the concurrent servers
// starve each other's CPU (GC pauses, scheduler contention) and the per-op 10s
// timeouts trip with OperationCanceledException. That's a flake, not a real
// failure: every class passes clean when run in isolation. Running the classes
// serially keeps the servers from competing, so the generous timeouts hold.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
