using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// G1 shape ratchet for <see cref="PendingUplink"/> — the prediction-only
    /// queue entry that will back <c>system.uplink.pending</c> (Task 3).
    /// Locks the field set to EXACTLY the dispatch-time facts the spec's
    /// prediction-only invariant allows: <c>Id</c>, <c>Command</c>,
    /// <c>Label</c>, <c>Vantage</c>, <c>DispatchedAt</c>,
    /// <c>OneWaySeconds</c>. Any
    /// execution/result/vessel-derived field ever added here — even
    /// additively — must fail this test and force a deliberate edit, since
    /// (unlike <see cref="ContractShapeGateTests"/>'s Major-bump escape
    /// hatch) this gate has no additive carve-out: the queue's whole point is
    /// that its shape never grows past dispatch-time facts.
    /// </summary>
    public class UplinkPendingShapeTests
    {
        [Fact]
        public void PendingUplinkShapeIsExactlyTheDispatchTimeFactSet()
        {
            var expected = new HashSet<string>
            {
                "Id:System.String",
                "Command:System.String",
                "Label:System.String",
                "Vantage:System.String",
                "DispatchedAt:System.Double",
                "OneWaySeconds:System.Double",
            };

            var actual = typeof(PendingUplink)
                .GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Select(p => p.Name + ":" + p.PropertyType)
                .ToHashSet();

            Assert.Equal(expected, actual);
        }
    }
}
