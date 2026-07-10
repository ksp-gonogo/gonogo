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
    /// provenance/absence rules — no-vessel / no-topology / null snapshot →
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
            // tick — never a fabricated empty-parts record.
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
            // Topology present but no identity id to attribute it to — an
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
            Assert.Equal(1.5, part.Bounds.Size.Y);
            Assert.NotNull(part.Bounds.Center);
            Assert.Equal(0.25, part.Bounds.Center!.Y);
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
        public void MetaSourceIsTheVesselGuid()
        {
            var parts = VesselPartsViewProvider.BuildParts(TopologySnapshot(RawPart("1", null)))!;
            Assert.Equal("vessel:" + Guid, parts.Meta.Source);
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
