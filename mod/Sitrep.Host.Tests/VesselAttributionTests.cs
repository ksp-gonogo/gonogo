using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The subject-naming half of the elected-capability channels: the science /
    /// isru / reliability namespaces publish active-vessel reads on FIXED topic
    /// names, on Delayed channels, so a delivered sample has to say which vessel
    /// it describes or a value cached across a vessel switch silently reads as
    /// the new ship's (see <see cref="VesselAttribution"/>).
    ///
    /// <para>Both shapes a backend can hand back are covered, because both
    /// exist: every in-tree backend builds dictionary entries, and
    /// <c>IScienceBackend</c> returns <c>object?</c>, so a third-party provider
    /// may hand back its own typed POCOs instead. Attribution has to work for
    /// either, since an unattributed sample from a provider IS the
    /// mis-attribution bug this closes, and the provider is exactly the party
    /// that must not have to care.</para>
    /// </summary>
    public class VesselAttributionTests
    {
        private const string VesselGuid = "e34e5a6d-2c1f-4b18-9c4a-1f2b3c4d5e6f";

        private static KspSnapshot SnapshotWithIdentity(string? id) => new KspSnapshot
        {
            Ut = 12.0,
            Values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = id },
                },
            },
        };

        [Fact]
        public void TheSubjectIsTheRawGuidOffTheSnapshotsOwnIdentity()
        {
            // Byte-identical to what fleet.<guid> / currency.<guid>.* key by and
            // to vessel.identity.vesselId: no "vessel:" prefix, no reformatting,
            // so a consumer joins across all of them without a translation step.
            Assert.Equal(VesselGuid, VesselAttribution.VesselIdOf(SnapshotWithIdentity(VesselGuid)));
        }

        [Fact]
        public void ThereIsNoSubjectWhenTheSnapshotHasNoVesselOrNoId()
        {
            Assert.Null(VesselAttribution.VesselIdOf(null));
            Assert.Null(VesselAttribution.VesselIdOf(new KspSnapshot { Ut = 0.0 }));
            Assert.Null(VesselAttribution.VesselIdOf(SnapshotWithIdentity(null)));
            // Empty string is treated as absent rather than passed through as a
            // subject nothing can be joined to.
            Assert.Null(VesselAttribution.VesselIdOf(SnapshotWithIdentity("")));
        }

        [Fact]
        public void EveryDictionaryEntryInAListIsAttributed()
        {
            // Per entry, not once for the list: these are array Topics with no
            // enclosing object to hold one copy, and giving them one would retype
            // the channel rather than add to it.
            var payload = new List<object?>
            {
                new Dictionary<string, object?> { ["partName"] = "Goo Pod" },
                new Dictionary<string, object?> { ["partName"] = "Science Jr." },
            };

            var stamped = Assert.IsType<List<object?>>(VesselAttribution.Stamp(payload, VesselGuid));

            foreach (var entry in stamped)
            {
                var dictionary = Assert.IsType<Dictionary<string, object?>>(entry);
                Assert.Equal(VesselGuid, dictionary["vesselId"]);
            }
        }

        [Fact]
        public void ATypedProvidersPocoEntriesAreAttributedToo()
        {
            // IScienceBackend returns object?, so a provider may hand back its own
            // typed entries. Leaving those anonymous would be the very
            // mis-attribution this exists to prevent, in the one case where the
            // provider cannot fix it itself.
            var payload = new List<object?>
            {
                new ExperimentEntry { PartName = "Goo Pod" },
                new ExperimentEntry { PartName = "Science Jr." },
            };

            VesselAttribution.Stamp(payload, VesselGuid);

            foreach (var entry in payload)
            {
                Assert.Equal(VesselGuid, Assert.IsType<ExperimentEntry>(entry).VesselId);
            }
        }

        [Fact]
        public void TheKeyIsWrittenEvenWithNoSubject()
        {
            // "We do not know which vessel" is stated, not left to inference: the
            // key is always present so a consumer reads an explicit null rather
            // than an absence it has to interpret, and the wire shape does not
            // change depending on whether a vessel was loaded.
            var entry = new Dictionary<string, object?> { ["partName"] = "Goo Pod" };

            VesselAttribution.Stamp(new List<object?> { entry }, vesselId: null);

            Assert.True(entry.ContainsKey("vesselId"));
            Assert.Null(entry["vesselId"]);
        }

        [Fact]
        public void ExistingFieldsAreUntouchedAndTheSamePayloadComesBack()
        {
            // Attribution ADDS a subject; it is not licence to rewrite what the
            // backend mapped. Same instance back, so the caller can keep publishing
            // exactly what it was given.
            var entry = new Dictionary<string, object?> { ["partName"] = "Goo Pod", ["dataAmount"] = 5.0 };
            var payload = new List<object?> { entry };

            var stamped = VesselAttribution.Stamp(payload, VesselGuid);

            Assert.Same(payload, stamped);
            Assert.Equal("Goo Pod", entry["partName"]);
            Assert.Equal(5.0, entry["dataAmount"]);
        }

        [Fact]
        public void AnUnattributableShapeIsPassedThroughRatherThanThrowing()
        {
            // A channel must not go dark because attribution could not find
            // anywhere to write. A backend returning something with no vesselId
            // member loses the subject, which is the state it was already in, not
            // the whole topic.
            Assert.Null(VesselAttribution.Stamp(null, VesselGuid));
            Assert.Equal("not an entry", VesselAttribution.Stamp("not an entry", VesselGuid));

            var noPlaceToWrite = new Vec3(1, 2, 3);
            Assert.Same(noPlaceToWrite, VesselAttribution.Stamp(noPlaceToWrite, VesselGuid));
        }

        [Fact]
        public void ASingleObjectPayloadIsAttributedNotIterated()
        {
            // reliability.summary is one object rather than an array. Its own
            // uplink stamps it directly, but the helper must not treat a lone
            // payload as a list and quietly skip it.
            var summary = new ReliabilitySummary { Source = "none" };

            VesselAttribution.Stamp(summary, VesselGuid);

            Assert.Equal(VesselGuid, summary.VesselId);
            Assert.Equal("none", summary.Source);
        }
    }
}
