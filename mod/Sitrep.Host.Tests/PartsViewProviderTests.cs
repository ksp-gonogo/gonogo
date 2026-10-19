using System.Collections.Generic;
using Sitrep.Host;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for the <c>parts.power</c> capture-add's
    /// <see cref="PartsViewProvider"/>: fake <see cref="KspSnapshot"/>s
    /// carrying the raw <c>"parts"</c> encoding <c>Gonogo.KSP.KspHost.
    /// BuildParts</c> produces are mapped to <c>parts.power</c> and asserted
    /// against the class doc's rules, no-vessel/no-data -&gt; null,
    /// primitives-only shape. The sibling Breaking Ground robotics tests that
    /// used to live here moved to <c>BreakingGroundViewProviderTests</c>
    /// alongside the split-out <see cref="BreakingGroundViewProvider"/>.
    /// </summary>
    public class PartsViewProviderTests
    {
        [Fact]
        public void BuildPowerReturnsNullWhenSnapshotHasNoPartsKeyAtAll()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(PartsViewProvider.BuildPower(snapshot));
        }

        [Fact]
        public void BuildPowerReturnsNullWhenSnapshotItselfIsNull()
        {
            Assert.Null(PartsViewProvider.BuildPower(null));
        }

        [Fact]
        public void BuildPowerMapsTheProductionTotal()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?>
                    {
                        ["power"] = new Dictionary<string, object?>
                        {
                            ["totalProductionEc"] = 5.6,
                        },
                    },
                },
            };

            var root = Assert.IsType<Dictionary<string, object?>>(PartsViewProvider.BuildPower(snapshot));

            Assert.Equal(5.6, root["totalProductionEc"]);
            Assert.Equal(new[] { "totalProductionEc" }, root.Keys);
        }
    }
}
