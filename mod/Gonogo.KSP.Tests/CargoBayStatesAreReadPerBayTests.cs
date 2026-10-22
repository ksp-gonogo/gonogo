using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A part can carry several cargo bays, and one that throws on read must not drop the
    /// states of the others. Read as source for the same reason
    /// <c>SandboxRecoveryIsWiredTests</c> is: the read is of live part modules.
    /// </summary>
    public class CargoBayStatesAreReadPerBayTests
    {
        [Fact]
        public void each_bay_is_read_inside_its_own_guard()
        {
            var source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");
            var body = CurrencyDelaySourceText.MethodBody(source, "private static List<object?> BuildPartModuleStates(Part part)");
            var loop = body.Substring(body.IndexOf("foreach (var bay in bays)", StringComparison.Ordinal));

            var guard = loop.IndexOf("try", StringComparison.Ordinal);
            var read = loop.IndexOf("MapCargoBayState(part, bay)", StringComparison.Ordinal);

            Assert.True(guard >= 0 && guard < read, "MapCargoBayState must be called inside a try within the per-bay loop");
        }
    }
}
