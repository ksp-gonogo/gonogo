using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using GonogoRp1Uplink;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// The avionics verdict on its way to the wire.
    ///
    /// <para>There is no arithmetic to test, and that is the change worth
    /// stating: RP-1 decides, this Uplink asks. What CAN still go wrong is the
    /// two seams either side of the ask, and both are here: the enum coming back
    /// out of a call this assembly cannot type, and the dict going out under key
    /// names nothing but a test connects to the declared payload.</para>
    /// </summary>
    public class Rp1AvionicsTests
    {
        [Fact]
        public void The_payload_carries_exactly_the_declared_shape()
        {
            var built = Rp1AvionicsCapture.Build(new Rp1AvionicsRaw
            {
                Level = Rp1LockLevel.Axial,
                SupportedMassTons = 1.5,
                VesselMassTons = 2.25,
                LimitedByNonInterplanetary = true,
            });

            var declared = typeof(Rp1Avionics)
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Select(p => char.ToLowerInvariant(p.Name[0]) + p.Name.Substring(1))
                .OrderBy(n => n, StringComparer.Ordinal)
                .ToArray();

            Assert.Equal(declared, built!.Keys.OrderBy(n => n, StringComparer.Ordinal).ToArray());
        }

        [Fact]
        public void The_three_levels_go_out_under_RP1s_own_names()
        {
            Assert.Equal("Locked", Rp1AvionicsCapture.LevelName(Rp1LockLevel.Locked));
            Assert.Equal("Axial", Rp1AvionicsCapture.LevelName(Rp1LockLevel.Axial));
            Assert.Equal("Unlocked", Rp1AvionicsCapture.LevelName(Rp1LockLevel.Unlocked));
        }

        /// <summary>
        /// Axial is the state the predecessor could not express. It kept a
        /// <c>bool? Controllable</c>, so a vessel that could still be rolled and
        /// could not be steered was indistinguishable from a dead one.
        /// </summary>
        [Fact]
        public void Axial_is_its_own_answer_and_not_a_flavour_of_locked()
        {
            var axial = Rp1AvionicsCapture.Build(new Rp1AvionicsRaw { Level = Rp1LockLevel.Axial });
            var locked = Rp1AvionicsCapture.Build(new Rp1AvionicsRaw { Level = Rp1LockLevel.Locked });

            Assert.Equal("Axial", axial!["lockLevel"]);
            Assert.Equal("Locked", locked!["lockLevel"]);
        }

        /// <summary>
        /// A reading nobody took is not a verdict of Unlocked and not a zero
        /// tonnage. The whole payload is absent, which the channel's
        /// <c>AbsenceIsData</c> carries as "nothing to report" rather than as a
        /// craft that can be steered.
        /// </summary>
        [Fact]
        public void No_reading_publishes_no_payload_rather_than_a_permissive_one() =>
            Assert.Null(Rp1AvionicsCapture.Build(null));

        /// <summary>
        /// Each half of the reading is independently absent-able, so a call that
        /// answered with a level and no masses says so rather than reporting a
        /// vessel of zero tonnes inside a limit of zero tonnes, which compares
        /// as comfortably GO.
        /// </summary>
        [Fact]
        public void An_absent_mass_travels_as_absent_and_never_as_zero()
        {
            var built = Rp1AvionicsCapture.Build(new Rp1AvionicsRaw { Level = Rp1LockLevel.Unlocked });

            Assert.Null(built!["supportedMassTons"]);
            Assert.Null(built["vesselMassTons"]);
            Assert.Null(built["limitedByNonInterplanetary"]);
        }

        [Fact]
        public void The_masses_and_the_interplanetary_flag_travel_unchanged()
        {
            var built = Rp1AvionicsCapture.Build(new Rp1AvionicsRaw
            {
                Level = Rp1LockLevel.Locked,
                SupportedMassTons = 0.7,
                VesselMassTons = 12.5,
                LimitedByNonInterplanetary = false,
            });

            Assert.Equal(0.7, built!["supportedMassTons"]);
            Assert.Equal(12.5, built["vesselMassTons"]);
            Assert.Equal(false, built["limitedByNonInterplanetary"]);
        }

        /// <summary>
        /// The member NAME is what crosses over, because the value boxes as a type
        /// this assembly cannot name. Fed a bare string here for the same reason:
        /// <c>LevelOf</c> reaches its argument through <c>ToString()</c>, so a
        /// string exercises exactly the path RP-1's boxed enum takes.
        /// </summary>
        [Theory]
        [InlineData("Locked", Rp1LockLevel.Locked)]
        [InlineData("Axial", Rp1LockLevel.Axial)]
        [InlineData("Unlocked", Rp1LockLevel.Unlocked)]
        public void RP1s_own_member_name_maps_to_the_level_it_means(string name, Rp1LockLevel expected) =>
            Assert.Equal(expected, Rp1AvionicsReflection.LevelOf(name));

        /// <summary>
        /// A level added by a future RP-1 release is not silently folded into one
        /// of the three this build knows, and neither is an undefined value, which
        /// an enum stringifies as its own number. Both read as no verdict, and the
        /// payload then carries no <c>lockLevel</c> rather than a guess.
        /// </summary>
        [Theory]
        [InlineData("Suspended")]
        [InlineData("3")]
        [InlineData("")]
        public void An_unrecognised_level_reads_as_no_verdict(string name)
        {
            Assert.Null(Rp1AvionicsReflection.LevelOf(name));
            Assert.Null(Rp1AvionicsCapture.LevelName(Rp1AvionicsReflection.LevelOf(name)));
        }

        /// <summary>
        /// The pin that matters most, stated as a test rather than left to the
        /// reader: matching by name is what makes a REORDERED <c>LockLevel</c>
        /// fail loudly on the compatibility guard instead of quietly swapping the
        /// two verdicts at the ends. An ordinal match would read a swapped enum as
        /// a craft under full control.
        /// </summary>
        [Fact]
        public void The_level_is_matched_by_name_and_never_by_ordinal()
        {
            Assert.Null(Rp1AvionicsReflection.LevelOf(0));
            Assert.Null(Rp1AvionicsReflection.LevelOf(2));
        }

        [Fact]
        public void A_verdict_that_did_not_come_back_reads_as_no_verdict() =>
            Assert.Null(Rp1AvionicsReflection.LevelOf(null));

        /// <summary>
        /// Nothing resolves on a stock install, so the reader answers with no
        /// reading rather than throwing, and the Uplink's other channels are
        /// unaffected.
        /// </summary>
        [Fact]
        public void With_no_RP1_loaded_the_reader_is_unavailable_and_reads_nothing()
        {
            var reflection = new Rp1AvionicsReflection();

            Assert.False(reflection.IsAvailable);
            Assert.Null(reflection.Read(new object()));
            Assert.Null(reflection.Read(null));
        }

        /// <summary>
        /// The channel is the one on this Uplink whose subject is a craft, so it
        /// is the one that must ride the reveal gate. Declared here rather than
        /// left to a reader of the manifest: a channel silently reclassified
        /// TrueNow would show an operator on a delayed link a control state the
        /// signal has not brought them.
        /// </summary>
        [Fact]
        public void The_avionics_channel_is_delayed_and_announces_its_absence()
        {
            var channel = new Rp1ScUplink().Manifest.Channels
                .Single(c => c.Topic == Rp1ScUplink.AvionicsTopic);

            Assert.Equal(Sitrep.Contract.DelayRole.Delayed, channel.Delay);
            Assert.True(channel.AbsenceIsData);
        }

    }
}
