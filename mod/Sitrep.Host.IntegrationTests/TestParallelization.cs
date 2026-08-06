using Xunit;

// These integration tests each spin up a REAL WebSocket server + clients on an
// ephemeral port. xUnit runs test CLASSES in parallel by default, and this
// project has a dozen of them, so running them serially keeps a dozen live
// servers from competing for CPU on the same box. That is necessary but not
// sufficient on its own: the residual CPU-starvation flake (intermittent
// timeouts, a different test each run, only under machine load) is addressed in
// TestBudgets.cs, which warms the thread pool so a ready delivery continuation
// runs the instant a core frees up, and sizes the suite's wall-clock deadlines
// as env-overridable load headroom rather than tight timing assertions. See
// that file's doc comment for the full root-cause analysis and why it is not a
// product race, a leaked thread, or intra-suite parallelism.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
