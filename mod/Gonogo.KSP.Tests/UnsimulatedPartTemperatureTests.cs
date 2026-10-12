using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A part physics has not run on yet reads 0 K of skin temperature, which is no
    /// measurement: <c>vessel.parts</c> must carry it as null, as it does the internal
    /// temperature's -1.
    ///
    /// <para>Source text, not behaviour: the topology walk reads live parts and cannot be
    /// compiled into this project.</para>
    /// </summary>
    public class UnsimulatedPartTemperatureTests
    {
        [Fact]
        public void an_unsimulated_skin_temperature_is_absent()
        {
            var source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

            Assert.Contains(
                "[\"skinTemp\"] = part.skinTemperature > 0 ? part.skinTemperature : (double?)null,",
                source,
                StringComparison.Ordinal);
        }
    }
}
