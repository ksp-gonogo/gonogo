using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// The xunit collection every test class that writes a <c>CommsCoreUplink</c>
    /// process static belongs to, so that no two of them run at the same time.
    ///
    /// <para><b>The failure it ends.</b> The delay accessor is read through
    /// three settable statics (the authored config, the simulation kernel, and
    /// the comms-model probe), because five surfaces reach it without an
    /// instance of the uplink in hand. Two test classes write them, each
    /// restoring what it set; xunit runs different classes IN PARALLEL, so one
    /// class's window of a probe saying "this save models no comms network" fell
    /// across the other's assertions and cut the delay under them. Both classes
    /// were individually correct and the suite failed anyway, at a rate that
    /// moved with machine load: measured over three consecutive runs of the
    /// comms classes alone, 1, 4 and 1 failures out of 45, with the identity of
    /// the failing tests changing between runs.</para>
    ///
    /// <para>A collection is the fix rather than more restoring, because there
    /// is nothing left to restore better: the state is already put back, and
    /// what the other thread saw was the interval before it was. Naming the
    /// collection after the statics rather than after either class is
    /// deliberate: the next class that writes one joins by declaring the same
    /// attribute, and the reason it must is written here once.</para>
    /// </summary>
    [CollectionDefinition(Name)]
    public sealed class CommsCoreUplinkStatics
    {
        public const string Name = "CommsCoreUplink process statics";
    }
}
