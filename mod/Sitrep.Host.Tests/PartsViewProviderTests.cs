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
        }

        private static KspSnapshot Rig(double? chargeRate, params double?[] partFlows)
        {
            var topology = new List<object?>();
            foreach (var flow in partFlows)
            {
                topology.Add(new Dictionary<string, object?>
                {
                    ["resources"] = new Dictionary<string, object?>
                    {
                        ["ElectricCharge"] = new Dictionary<string, object?>
                        {
                            ["amount"] = 40.0,
                            ["maxAmount"] = 100.0,
                            ["flow"] = flow,
                            ["nominalFlow"] = null,
                        },
                    },
                });
            }

            return new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["vessel"] = new Dictionary<string, object?> { ["topology"] = topology },
                    ["parts"] = new Dictionary<string, object?>
                    {
                        ["power"] = new Dictionary<string, object?> { ["totalProductionEc"] = 0.0 },
                        ["chargeRateEc"] = chargeRate,
                    },
                },
            };
        }

        private static Dictionary<string, object?> Power(KspSnapshot snapshot) =>
            Assert.IsType<Dictionary<string, object?>>(PartsViewProvider.BuildPower(snapshot));

        [Fact]
        public void BuildPowerSplitsTheMeasuredDrawIntoWhatPartsReportAndWhatTheyDoNot()
        {
            var root = Power(Rig(-0.0687, -0.0280));

            Assert.Equal(-0.0687, (double)root["netChargeRateEc"]!, 6);
            Assert.Equal(0.0687, (double)root["totalConsumptionEc"]!, 6);
            Assert.Equal(0.0407, (double)root["unattributedConsumptionEc"]!, 6);
        }

        [Fact]
        public void BuildPowerCountsWhatProducersAddToTheMeasuredDraw()
        {
            var root = Power(Rig(-0.5, 2.0, -2.0, -0.3));

            Assert.Equal(2.5, (double)root["totalConsumptionEc"]!, 6);
            Assert.Equal(0.2, (double)root["unattributedConsumptionEc"]!, 6);
        }

        [Fact]
        public void BuildPowerLeavesTheDrawUnknownWhileTheStoredChargeCannotBeRead()
        {
            var root = Power(Rig(null, -0.0280));

            Assert.Null(root["netChargeRateEc"]);
            Assert.Null(root["totalConsumptionEc"]);
            Assert.Null(root["unattributedConsumptionEc"]);
        }

        [Fact]
        public void BuildPowerNeverReportsLessThanThePartsThemselvesAccountFor()
        {
            var root = Power(Rig(-0.01, -0.0280));

            Assert.Equal(0.0, (double)root["unattributedConsumptionEc"]!, 6);
        }
    }
}
