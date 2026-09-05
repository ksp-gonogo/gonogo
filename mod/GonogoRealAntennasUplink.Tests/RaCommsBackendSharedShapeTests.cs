using System;
using System.Reflection;
using Gonogo.RealAntennasUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// That the shared half of <see cref="ICommsBackend"/> really is shared, and
    /// that the backend's own half really is not.
    ///
    /// <para>Five accessors used to be the same code twice in two assemblies,
    /// down to a byte-identical <c>"no connection to a command source"</c>
    /// string. The behavioural tests elsewhere check that each backend produces
    /// the right payload; what they cannot check is that the two are produced by
    /// ONE implementation, which is the property that stops them drifting again.
    /// A duplicate that agrees today passes every behavioural test right up
    /// until somebody edits one copy.</para>
    ///
    /// <para>The drift was not hypothetical or cosmetic. The stock copy wrapped
    /// every read in a try/catch that turned a throw into an authoritative
    /// <c>connected:false</c>, and the RealAntennas copy let it propagate.
    /// <c>connected:false</c> is a freeze lever
    /// (<c>ChannelEngine.RevealDelayFor</c> returns <c>+Inf</c> for every Delayed
    /// topic of a disconnected subject, whether or not signal delay is even
    /// enabled), so one transient scene settle froze the whole board under one
    /// backend and was a one-tick hold under the other.</para>
    ///
    /// <para>Reflection rather than a source scan, deliberately: a scan that
    /// stops matching reports zero and zero reads as success, whereas
    /// <see cref="MethodInfo.DeclaringType"/> on a method moved back into a
    /// backend changes to that backend, and a method that has been deleted
    /// throws here rather than passing quietly.</para>
    /// </summary>
    public class RaCommsBackendSharedShapeTests
    {
        /// <summary>
        /// The accessors whose SHAPE the contract owns. Every one of these was a
        /// duplicated implementation before <see cref="CommsBackendBase"/>.
        /// </summary>
        private static readonly string[] SharedShape =
        {
            nameof(ICommsBackend.Connectivity),
            nameof(ICommsBackend.SignalStrength),
            nameof(ICommsBackend.ControlState),
            nameof(ICommsBackend.Path),
            nameof(ICommsBackend.Network),
            nameof(ICommsBackend.ControlPathTerminus),
        };

        /// <summary>
        /// The questions a backend genuinely answers differently. These MUST
        /// stay per-backend: a shared implementation of any of them would be
        /// core deciding a backend's own rule, which is the defect class this
        /// seam exists to prevent.
        /// </summary>
        private static readonly string[] OwnJudgement =
        {
            nameof(ICommsBackend.RouteBetween),
            nameof(ICommsBackend.ReachModel),
            nameof(ICommsBackend.OcclusionModel),
        };

        [Fact]
        public void TheSharedShapeIsImplementedOnceInTheContract()
        {
            foreach (var name in SharedShape)
            {
                var method = typeof(RaCommsBackend).GetMethod(name, BindingFlags.Public | BindingFlags.Instance);
                Assert.True(method != null, "RaCommsBackend no longer implements " + name);
                Assert.True(
                    method!.DeclaringType == typeof(CommsBackendBase),
                    name + " is declared on " + method.DeclaringType?.Name + " rather than on "
                    + nameof(CommsBackendBase) + ": the shape is duplicated again, and a duplicate "
                    + "that agrees today passes every behavioural test until somebody edits one copy");
            }
        }

        [Fact]
        public void TheJudgementStaysWithTheBackend()
        {
            foreach (var name in OwnJudgement)
            {
                var method = typeof(RaCommsBackend).GetMethod(name, BindingFlags.Public | BindingFlags.Instance);
                Assert.True(method != null, "RaCommsBackend no longer implements " + name);
                Assert.True(
                    method!.DeclaringType == typeof(RaCommsBackend),
                    name + " is answered by " + method.DeclaringType?.Name + " rather than by "
                    + "RaCommsBackend: routing, reach and occlusion are the rules a backend OWNS, and "
                    + "core answering one of them is exactly the defect the seam exists to stop");
            }
        }

        /// <summary>
        /// And the string that proved the duplication in the first place now
        /// exists once, where the contract can point at it.
        /// </summary>
        [Fact]
        public void TheDisconnectedReasonIsOneConstant()
        {
            Assert.Equal("no connection to a command source", CommsBackendBase.NoCommandSourceReason);
        }
    }
}
