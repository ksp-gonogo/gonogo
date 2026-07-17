using System.Runtime.CompilerServices;
using System.Threading;
using Xunit;

// These integration tests each spin up a REAL WebSocket server + clients on an
// ephemeral port. xUnit runs test CLASSES in parallel by default, and this
// project has a dozen of them, so running them serially keeps a dozen live
// servers from competing for CPU on the same box. That is necessary but NOT
// sufficient on its own: the residual flake (intermittent ~10s
// OperationCanceledException timeouts, a different test each run, only under
// machine load) was never a server/engine wedge. Root-caused via thread-stack
// dumps at the stall: the engine's Courier and per-connection Outbox run on
// DEDICATED threads and were always idle at the wedge; the SERVER had already
// sent the frame the timing-out test was waiting for. The stall lived entirely
// in the async CLIENT/harness pipeline — socket-receive and Channel
// continuations scheduled on the .NET thread pool, which the pool cannot
// service promptly when the box is CPU-saturated (by this suite's own threads
// plus whatever else CI runs alongside), amplified by the pool's slow
// thread-injection throttle.
//
// Two fixes address that, both in WsTestHarness / this file (the product engine
// needed no change — it was already robust):
//   1. TestClient now pumps its socket on a DEDICATED thread with a blocking
//      receive and an AllowSynchronousContinuations channel, so server->client
//      delivery never waits on a free pool worker.
//   2. The floor below pre-creates pool worker threads so the tests' own await
//      continuations (e.g. resuming after a send) aren't delayed by the
//      injection throttle under load.
[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace Sitrep.Host.IntegrationTests
{
    internal static class ThreadPoolFloor
    {
        [ModuleInitializer]
        public static void Raise()
        {
            ThreadPool.GetMinThreads(out var worker, out var io);
            ThreadPool.SetMinThreads(System.Math.Max(worker, 64), System.Math.Max(io, 64));
        }
    }
}
