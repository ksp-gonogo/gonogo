using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for the <c>vessel.parts</c> capture-add's
    /// <see cref="VesselPartsViewProvider"/>: fake <see cref="KspSnapshot"/>s
    /// carrying the raw <c>vessel.topology</c> list
    /// <c>Gonogo.KSP.KspHost.BuildTopology</c> produces are mapped to the typed
    /// <see cref="VesselParts"/> tree and asserted against the provider's
    /// provenance/absence rules: no-vessel / no-topology / null snapshot →
    /// null; per-part id/parent/thermal round-trip; symmetric same-named parts
    /// stay distinguishable by id.
    /// </summary>
    public class VesselPartsViewProviderTests
    {
        private const string Guid = "11111111-2222-3333-4444-555555555555";

        [Fact]
        public void BuildPartsReturnsNullWhenSnapshotIsNull()
        {
            Assert.Null(VesselPartsViewProvider.BuildParts(null));
            Assert.Null(VesselPartsViewProvider.BuildPartsWire(null));
        }

        [Fact]
        public void BuildPartsReturnsNullWhenNoVesselGroup()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };
            Assert.Null(VesselPartsViewProvider.BuildParts(snapshot));
        }

        [Fact]
        public void BuildPartsReturnsNullWhenVesselHasNoTopologyGroup()
        {
            // Vessel present (identity id resolvable) but no topology list this
            // tick: never a fabricated empty-parts record.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["vessel"] = new Dictionary<string, object?>
                    {
                        ["identity"] = new Dictionary<string, object?> { ["id"] = Guid },
                    },
                },
            };

            Assert.Null(VesselPartsViewProvider.BuildParts(snapshot));
        }

        [Fact]
        public void BuildPartsReturnsNullWhenNoSubjectId()
        {
            // Topology present but no identity id to attribute it to, an
            // unattributable payload is worse than none.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["vessel"] = new Dictionary<string, object?>
                    {
                        ["topology"] = new List<object?> { RawPart("1", null) },
                    },
                },
            };

            Assert.Null(VesselPartsViewProvider.BuildParts(snapshot));
        }

        [Fact]
        public void RootPartHasNullParentIdAndChildLinksToParent()
        {
            var snapshot = TopologySnapshot(
                RawPart("1", parentId: null),
                RawPart("2", parentId: "1"));

            var parts = VesselPartsViewProvider.BuildParts(snapshot);
            Assert.NotNull(parts);
            Assert.Equal(2, parts!.Parts.Count);

            var root = parts.Parts.Single(p => p.Id == "1");
            Assert.Null(root.ParentId);

            var child = parts.Parts.Single(p => p.Id == "2");
            Assert.Equal("1", child.ParentId);
        }

        [Fact]
        public void SameNamedPartsStayDistinguishableByPartId()
        {
            // The symmetric-arm case: two parts with an identical name but
            // distinct flightID-derived ids must survive the mapper distinct.
            var snapshot = TopologySnapshot(
                RawPart("2001", parentId: "1", name: "structuralPanel1", title: "Structural Panel"),
                RawPart("2002", parentId: "1", name: "structuralPanel1", title: "Structural Panel"));

            var parts = VesselPartsViewProvider.BuildParts(snapshot)!;
            var arm1 = parts.Parts.Single(p => p.Id == "2001");
            var arm2 = parts.Parts.Single(p => p.Id == "2002");

            Assert.Equal(arm1.Name, arm2.Name);
            Assert.NotEqual(arm1.Id, arm2.Id);
        }

        [Fact]
        public void UpIsNullWhenRawUpIsAbsent()
        {
            var raw = RawPart("1", null);
            raw.Remove("up");

            var parts = VesselPartsViewProvider.BuildParts(TopologySnapshot(raw))!;
            Assert.Null(Assert.Single(parts.Parts).Up);
        }

        [Fact]
        public void ForwardIsNullWhenRawForwardIsAbsent()
        {
            var raw = RawPart("1", null);
            raw.Remove("forward");

            var parts = VesselPartsViewProvider.BuildParts(TopologySnapshot(raw))!;
            Assert.Null(Assert.Single(parts.Parts).Forward);
        }

        [Fact]
        public void PerPartThermalAndGeometryRoundTrip()
        {
            var raw = RawPart("1", null);
            raw["maxTemp"] = 1200.0;
            raw["skinMaxTemp"] = 2400.0;
            raw["currentTemp"] = 340.0;
            raw["skinTemp"] = 355.0;
            raw["dryMass"] = 1.25;
            raw["inverseStage"] = 3;
            raw["position"] = new double[] { 1.0, 2.0, 3.0 };
            raw["up"] = new double[] { 0.0, 1.0, 0.0 };
            raw["forward"] = new double[] { -0.5, 0.0, 0.866 };
            raw["bounds"] = new Dictionary<string, object?>
            {
                ["size"] = new double[] { 0.5, 1.5, 0.5 },
                ["center"] = new double[] { 0.0, 0.25, 0.0 },
            };

            var part = Assert.Single(VesselPartsViewProvider.BuildParts(TopologySnapshot(raw))!.Parts);

            Assert.Equal(1200.0, part.MaxTemp);
            Assert.Equal(2400.0, part.SkinMaxTemp);
            Assert.Equal(340.0, part.CurrentTemp);
            Assert.Equal(355.0, part.SkinTemp);
            Assert.Equal(1.25, part.DryMass);
            Assert.Equal(3, part.InverseStage);
            Assert.Equal(2.0, part.Position.Y);
            Assert.NotNull(part.Up);
            Assert.Equal(1.0, part.Up!.Y);
            Assert.NotNull(part.Forward);
            Assert.Equal(-0.5, part.Forward!.X);
            Assert.Equal(0.866, part.Forward.Z);
            Assert.Equal(1.5, part.Bounds.Size.Y);
            Assert.NotNull(part.Bounds.Center);
            Assert.Equal(0.25, part.Bounds.Center!.Y);
        }

        [Fact]
        public void HullPiecesMapAsFlatTriplesAndReachTheWire()
        {
            var raw = RawPart("1", null);
            var strip = new double[] { -2.553, 0.116, -0.201, -2.553, 0.131, 0.199, -0.3, 0.12, 0.2 };
            var base_ = new double[] { 0.054, 0.241, -0.274, 0.054, -0.241, 0.274, 0.087, 0.281, 0.0 };
            raw["bounds"] = new Dictionary<string, object?>
            {
                ["size"] = new double[] { 2.65, 0.95, 0.55 },
                ["center"] = new double[] { -1.228, -0.183, 0.0 },
                ["hull"] = new[] { strip, base_ },
            };

            var part = Assert.Single(VesselPartsViewProvider.BuildParts(TopologySnapshot(raw))!.Parts);

            var pieces = Assert.IsType<List<PartHullPiece>>(part.Bounds.Hull);
            Assert.Equal(2, pieces.Count);
            Assert.Equal(strip, pieces[0].Points);
            Assert.Equal(base_, pieces[1].Points);
            var wire = Assert.Single(Assert.IsType<List<object?>>(Assert.IsType<Dictionary<string, object?>>(VesselPartsViewProvider.BuildPartsWire(TopologySnapshot(raw)))["parts"]));
            var bounds = Assert.IsType<Dictionary<string, object?>>(Assert.IsType<Dictionary<string, object?>>(wire)["bounds"]);
            var wirePieces = Assert.IsType<List<Dictionary<string, object?>>>(bounds["hull"]);
            Assert.Equal(strip, wirePieces[0]["points"]);
            Assert.Equal(2, wirePieces.Count);
        }

        [Fact]
        public void APieceThatIsNotWholePointsIsDroppedAndNoPiecesMapsToNull()
        {
            var ragged = RawPart("1", null);
            ragged["bounds"] = new Dictionary<string, object?>
            {
                ["size"] = new double[] { 1.0, 1.0, 1.0 },
                ["hull"] = new[] { new double[] { 0.0, 0.0, 0.0, 1.0, 1.0 }, new double[] { 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 2.0, 2.0, 2.0 } },
            };
            var onlyRagged = RawPart("2", null);
            onlyRagged["bounds"] = new Dictionary<string, object?>
            {
                ["size"] = new double[] { 1.0, 1.0, 1.0 },
                ["hull"] = new[] { new double[] { 0.0, 0.0, 0.0, 1.0, 1.0 } },
            };
            var absent = RawPart("3", null);
            absent["bounds"] = new Dictionary<string, object?>
            {
                ["size"] = new double[] { 1.0, 1.0, 1.0 },
                ["hull"] = null,
            };

            var kept = Assert.Single(VesselPartsViewProvider.BuildParts(TopologySnapshot(ragged))!.Parts).Bounds.Hull;
            Assert.Single(kept!);
            Assert.Null(Assert.Single(VesselPartsViewProvider.BuildParts(TopologySnapshot(onlyRagged))!.Parts).Bounds.Hull);
            Assert.Null(Assert.Single(VesselPartsViewProvider.BuildParts(TopologySnapshot(absent))!.Parts).Bounds.Hull);
        }

        [Fact]
        public void SentinelTemperaturesMapToNull()
        {
            // A part recorded with the KSP -1 "not simulated" sentinels comes
            // through as null, never a sub-zero-Kelvin reading. (KspHost guards
            // these at capture, but replay of an older raw must too.)
            var raw = RawPart("1", null);
            raw["currentTemp"] = null;
            raw["skinMaxTemp"] = null;

            var part = Assert.Single(VesselPartsViewProvider.BuildParts(TopologySnapshot(raw))!.Parts);
            Assert.Null(part.CurrentTemp);
            Assert.Null(part.SkinMaxTemp);
        }

        [Fact]
        public void ModulesAndFlagsRoundTrip()
        {
            var raw = RawPart("1", null);
            raw["modules"] = new List<object?> { "ModuleEngines", "ModuleGimbal" };
            raw["isRobotics"] = true;
            raw["isPowerRelated"] = true;
            raw["fuelLineTargetId"] = "9";

            var part = Assert.Single(VesselPartsViewProvider.BuildParts(TopologySnapshot(raw))!.Parts);
            Assert.Equal(new[] { "ModuleEngines", "ModuleGimbal" }, part.Modules);
            Assert.True(part.IsRobotics);
            Assert.True(part.IsPowerRelated);
            Assert.Equal("9", part.FuelLineTargetId);
        }

        [Fact]
        public void NegativeEcFlowRoundTripsAsAConsumer()
        {
            // Shape KspHost.BuildPartResources now emits for an EC-consuming
            // module (reaction wheel / light / probe core / antenna / active
            // ISRU input): review finding I3, restoring PowerSystems'
            // Consumers list (it filters contributions.flow < 0). Negative
            // flow must round-trip through the mapper exactly like positive
            // (production) flow already does; PartResourceFlow.Flow has no
            // sign-specific handling, so this pins the contract rather than
            // exercising new mapper logic.
            var raw = RawPart("1", null);
            raw["resources"] = new Dictionary<string, object?>
            {
                ["ElectricCharge"] = new Dictionary<string, object?>
                {
                    ["amount"] = 50.0,
                    ["maxAmount"] = 100.0,
                    ["flow"] = -4.5,
                    ["nominalFlow"] = null,
                },
            };

            var part = Assert.Single(VesselPartsViewProvider.BuildParts(TopologySnapshot(raw))!.Parts);
            var ec = Assert.Single(part.Resources, kvp => kvp.Key == "ElectricCharge").Value;
            Assert.Equal(50.0, ec.Amount);
            Assert.Equal(100.0, ec.MaxAmount);
            Assert.Equal(-4.5, ec.Flow);
            Assert.Null(ec.NominalFlow);
        }

        [Fact]
        public void MetaSourceIsTheVesselGuid()
        {
            var parts = VesselPartsViewProvider.BuildParts(TopologySnapshot(RawPart("1", null)))!;
            Assert.Equal("vessel:" + Guid, parts.Meta.Source);
        }

        [Fact]
        public void TrackedPartsAreNullWithNoRows()
        {
            Assert.Null(VesselPartsViewProvider.BuildTrackedParts(null));
            Assert.Null(VesselPartsViewProvider.BuildTrackedParts(new List<object?>()));
            Assert.Null(VesselPartsViewProvider.BuildTrackedPartsWire(new List<object?>()));
        }

        [Fact]
        public void TrackedPartsKeepTheTreeAndGeometry()
        {
            var parts = VesselPartsViewProvider.BuildTrackedParts(new List<object?>
            {
                RawPart("1", null),
                RawPart("2", "1"),
            })!;

            Assert.Equal(new[] { "1", "2" }, parts.Parts.Select(p => p.Id));
            Assert.Equal("1", parts.Parts[1].ParentId);
            Assert.Equal(1.0, parts.Parts[0].Up!.Y);
            Assert.Equal(1.0, parts.Parts[0].Bounds.Size.X);
        }

        [Fact]
        public void AnUnloadedCraftsRowsCarryNoLiveState()
        {
            var row = new Dictionary<string, object?>
            {
                ["id"] = "7",
                ["parentId"] = null,
                ["name"] = "solidBooster.sm.v2",
                ["title"] = "RT-10 Hammer",
                ["position"] = new double[] { 0.0, -2.0, 0.0 },
                ["up"] = new double[] { 0.0, 1.0, 0.0 },
                ["forward"] = new double[] { 0.0, 0.0, 1.0 },
                ["bounds"] = new Dictionary<string, object?>
                {
                    ["size"] = new double[] { 1.25, 7.5, 1.25 },
                    ["center"] = null,
                },
                ["dryMass"] = 0.75,
                ["inverseStage"] = 0,
                ["maxTemp"] = 2000.0,
                ["category"] = "Engine",
                ["categoryOrdinal"] = 2,
                ["modules"] = new List<object?> { "ModuleEngines" },
                ["resources"] = new Dictionary<string, object?>
                {
                    ["SolidFuel"] = new Dictionary<string, object?> { ["amount"] = 375.0, ["maxAmount"] = 375.0 },
                },
            };

            var wire = VesselPartsViewProvider.BuildTrackedPartsWire(new List<object?> { row })!;
            Assert.False(wire.ContainsKey("meta"));

            var part = Assert.Single(VesselPartsViewProvider.BuildTrackedParts(new List<object?> { row })!.Parts);
            Assert.Null(part.CurrentTemp);
            Assert.Null(part.SkinTemp);
            Assert.Null(part.FuelLineTargetId);
            Assert.Null(part.Bounds.Center);
            Assert.Empty(part.ModuleStates);
            Assert.Empty(part.ActionBindings);
            var fuel = part.Resources["SolidFuel"];
            Assert.Equal(375.0, fuel.MaxAmount);
            Assert.Null(fuel.Flow);
        }

        [Fact]
        public void ACraftFilesPartTreeKeepsTheTreeAndHasNoLiveState()
        {
            Assert.Null(VesselPartsViewProvider.BuildCraftFilePartsWire(null));
            Assert.Null(VesselPartsViewProvider.BuildCraftFilePartsWire(new List<object?>()));

            var wire = VesselPartsViewProvider.BuildCraftFilePartsWire(new List<object?>
            {
                RawPart("1", null),
                RawPart("2", "1"),
            })!;

            Assert.False(wire.ContainsKey("meta"));
            var parts = Assert.IsType<List<object?>>(wire["parts"]);
            var child = Assert.IsType<Dictionary<string, object?>>(parts[1]);
            Assert.Equal("2", child["id"]);
            Assert.Equal("1", child["parentId"]);
        }

        // ----------------------------------------------------------------

        private static KspSnapshot TopologySnapshot(params IDictionary<string, object?>[] parts) => new KspSnapshot
        {
            Ut = 0.0,
            Values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = Guid },
                    ["topology"] = parts.Cast<object?>().ToList(),
                },
            },
        };

        private static Dictionary<string, object?> RawPart(
            string id,
            string? parentId,
            string name = "someParty",
            string title = "Some Part") => new Dictionary<string, object?>
        {
            ["id"] = id,
            ["parentId"] = parentId,
            ["name"] = name,
            ["title"] = title,
            ["position"] = new double[] { 0.0, 0.0, 0.0 },
            ["up"] = new double[] { 0.0, 1.0, 0.0 },
            ["forward"] = new double[] { 0.0, 0.0, 1.0 },
            ["bounds"] = new Dictionary<string, object?>
            {
                ["size"] = new double[] { 1.0, 1.0, 1.0 },
                ["center"] = new double[] { 0.0, 0.0, 0.0 },
            },
            ["dryMass"] = 1.0,
            ["inverseStage"] = 0,
            ["maxTemp"] = 2000.0,
            ["skinMaxTemp"] = 2400.0,
            ["currentTemp"] = 300.0,
            ["skinTemp"] = 300.0,
            ["category"] = "Structural",
            ["modules"] = new List<object?>(),
            ["isRobotics"] = false,
            ["isPowerRelated"] = false,
            ["fuelLineTargetId"] = null,
        };
    }
}
