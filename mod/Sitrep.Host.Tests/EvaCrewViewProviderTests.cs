using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The <c>eva.crew</c> mapper. Its subject is the kerbals OUTSIDE a craft,
    /// which is why it reads the snapshot root rather than the vessel group:
    /// while a kerbal is on EVA the vessel group is the craft they left, so a
    /// kerbal outside appears in no vessel group at all.
    /// </summary>
    public class EvaCrewViewProviderTests
    {
        private static KspSnapshot SnapshotWith(params object?[] evaEntries) =>
            new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["evaCrew"] = new List<object?>(evaEntries),
                },
            };

        private static Dictionary<string, object?> Kerbal(string id) =>
            new Dictionary<string, object?>
            {
                ["kerbalVesselId"] = id,
                ["parentVesselId"] = "craft-1",
                ["name"] = "Jebediah Kerman",
                ["situation"] = "FLYING",
                ["propellantAmount"] = 3.5,
                ["propellantCapacity"] = 5.0,
                ["hasJetpack"] = true,
                ["jetpackDeployed"] = true,
                ["jetpackIsThrusting"] = false,
                ["onALadder"] = false,
                ["lampOn"] = true,
                ["visorState"] = "Lowered",
                ["willDieWithoutHelmet"] = true,
                ["canSafelyRemoveHelmet"] = false,
                ["helmetUnsafeReason"] = "Vacuum",
            };

        [Fact]
        public void MapsEveryFieldOfAKerbalOutside()
        {
            var eva = VesselViewProvider.BuildEvaCrew(SnapshotWith(Kerbal("kerbal-1")));

            var kerbal = Assert.Single(Assert.IsType<EvaCrew>(eva).Kerbals);
            Assert.Equal("kerbal-1", kerbal.KerbalVesselId);
            Assert.Equal("craft-1", kerbal.ParentVesselId);
            Assert.Equal("Jebediah Kerman", kerbal.Name);
            Assert.Equal("FLYING", kerbal.Situation);
            Assert.Equal(3.5, kerbal.PropellantAmount);
            Assert.Equal(5.0, kerbal.PropellantCapacity);
            Assert.True(kerbal.HasJetpack);
            Assert.True(kerbal.JetpackDeployed);
            Assert.False(kerbal.JetpackIsThrusting);
            Assert.False(kerbal.OnALadder);
            Assert.True(kerbal.LampOn);
            Assert.Equal("Lowered", kerbal.VisorState);
            Assert.True(kerbal.WillDieWithoutHelmet);
            Assert.False(kerbal.CanSafelyRemoveHelmet);
            Assert.Equal("Vacuum", kerbal.HelmetUnsafeReason);
        }

        [Fact]
        public void CountsTheKerbalsItMapped()
        {
            var eva = VesselViewProvider.BuildEvaCrew(
                SnapshotWith(Kerbal("kerbal-1"), Kerbal("kerbal-2"))
            );

            Assert.Equal(2, Assert.IsType<EvaCrew>(eva).Count);
        }

        [Fact]
        public void NobodyOutsideIsAnEmptyRosterRatherThanNothing()
        {
            // "Nobody is outside" is a real answer and has to be publishable as
            // one, or a reader cannot tell it from a channel that has gone
            // quiet.
            var eva = Assert.IsType<EvaCrew>(VesselViewProvider.BuildEvaCrew(SnapshotWith()));

            Assert.Empty(eva.Kerbals);
            Assert.Equal(0, eva.Count);
        }

        [Fact]
        public void ARecordingMadeBeforeTheChannelExistedMapsToNothingAtAll()
        {
            // No key, as opposed to an empty list: nothing was captured, which
            // is a different fact from nobody being outside.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>(),
            };

            Assert.Null(VesselViewProvider.BuildEvaCrew(snapshot));
        }

        [Fact]
        public void DropsAnEntryWithNoSubjectIdRatherThanMappingAnAnonymousKerbal()
        {
            var nameless = Kerbal("kerbal-1");
            nameless["kerbalVesselId"] = null;

            var eva = Assert.IsType<EvaCrew>(
                VesselViewProvider.BuildEvaCrew(SnapshotWith(nameless, Kerbal("kerbal-2")))
            );

            var kept = Assert.Single(eva.Kerbals);
            Assert.Equal("kerbal-2", kept.KerbalVesselId);
            Assert.Equal(1, eva.Count);
        }

        [Fact]
        public void AnUnreadableFieldStaysNullRatherThanBecomingAZero()
        {
            // The capture leaves a key ABSENT when the read throws, and the
            // difference matters: a kerbal whose propellant could not be read is
            // not a kerbal with an empty tank, and a suit whose safety could not
            // be read is not a safe one.
            var partial = Kerbal("kerbal-1");
            partial.Remove("propellantAmount");
            partial.Remove("willDieWithoutHelmet");

            var eva = Assert.IsType<EvaCrew>(VesselViewProvider.BuildEvaCrew(SnapshotWith(partial)));

            var kerbal = Assert.Single(eva.Kerbals);
            Assert.Null(kerbal.PropellantAmount);
            Assert.Null(kerbal.WillDieWithoutHelmet);
            // The fields that WERE read are unaffected by the ones that were not.
            Assert.Equal(5.0, kerbal.PropellantCapacity);
        }

        [Fact]
        public void AKerbalWhoseParentIsUnknownStillMaps()
        {
            // A kerbal already outside when a save was loaded by a build that
            // did not record the relation has no parent to name, and is still a
            // kerbal outside.
            var orphan = Kerbal("kerbal-1");
            orphan.Remove("parentVesselId");

            var eva = Assert.IsType<EvaCrew>(VesselViewProvider.BuildEvaCrew(SnapshotWith(orphan)));

            var kerbal = Assert.Single(eva.Kerbals);
            Assert.Null(kerbal.ParentVesselId);
            Assert.Equal("kerbal-1", kerbal.KerbalVesselId);
        }
    }
}
