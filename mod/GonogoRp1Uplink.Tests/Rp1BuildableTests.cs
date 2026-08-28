using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// The buildable preview: every saved craft measured against every complex,
    /// which is the half of this feature a widget needs BEFORE the press.
    ///
    /// <para>The cases that matter most are the two about UNCERTAINTY, not the
    /// two about limits. This preview is measured from a craft file rather than
    /// from a loaded craft, so some of RP-1's own conditions cannot be answered
    /// at all, and a preview that refused on those would draw a control dark for
    /// a reason nobody could establish. That is the same dead end the whole
    /// feature exists to remove, so an unanswerable arm PERMITS here and the
    /// command asks RP-1 itself. The opposite of the direction the command takes
    /// on money, and deliberately: only one of the two spends anything.</para>
    /// </summary>
    public class Rp1BuildableTests
    {
        private static CraftFileRecord Craft(
            string file = "Atlas",
            KspEditorFacility facility = KspEditorFacility.VAB,
            double? mass = 120.0,
            double? totalMass = null,
            double? sizeY = 20.0)
        {
            return new CraftFileRecord
            {
                File = file,
                ShipName = file,
                Facility = facility,
                PartCount = 42,
                Mass = totalMass ?? mass,
                MassExcludingClamps = mass,
                SizeX = 3.0,
                SizeY = sizeY,
                SizeZ = 3.0,
                Cost = 40_000.0,
                MissingParts = new string[0],
                LockedParts = new string[0],
                UnpurchasedParts = new string[0],
            };
        }

        private static Rp1ComplexRaw Complex(
            string lcId = "lc-1",
            string type = "Pad",
            bool operational = true,
            double? massMin = 6.0,
            double? massMax = 180.0,
            double? sizeMaxY = 40.0,
            bool humanRated = false)
        {
            return new Rp1ComplexRaw
            {
                KscName = "Cape",
                LcId = lcId,
                Name = "LC-1",
                LcType = type,
                IsOperational = operational,
                MassMin = massMin,
                MassMax = massMax,
                SizeMaxX = 20.0,
                SizeMaxY = sizeMaxY,
                SizeMaxZ = 20.0,
                HumanRated = humanRated,
            };
        }

        private static Rp1BuildableComplexRaw Verdict(
            CraftFileRecord craft, Rp1ComplexRaw complex)
        {
            var rows = Rp1Buildable.Rows(new[] { craft }, new[] { complex });
            return Assert.Single(Assert.Single(rows).Complexes);
        }

        [Fact]
        public void Refuses_a_craft_too_heavy_for_the_complex_and_names_both_figures()
        {
            var verdict = Verdict(Craft(mass: 2_900.0), Complex(massMax: 180.0));

            Assert.False(verdict.Eligible);
            var reason = Assert.Single(verdict.Refusals);
            // Both numbers, because "too heavy" alone does not tell an operator
            // whether the answer is a bigger complex or a smaller rocket.
            Assert.Contains("2,900.0", reason);
            Assert.Contains("180.0", reason);
        }

        [Fact]
        public void Refuses_a_craft_below_the_complexs_floor()
        {
            // RP-1's mass MINIMUM, which stock has no concept of: a complex rated
            // for a Saturn V cannot usefully integrate a sounding rocket.
            var verdict = Verdict(Craft(mass: 3.0), Complex(massMin: 40.0));

            Assert.False(verdict.Eligible);
            Assert.Contains("too light", Assert.Single(verdict.Refusals));
        }

        [Fact]
        public void Names_the_axis_a_craft_is_too_large_on()
        {
            var verdict = Verdict(Craft(sizeY: 60.0), Complex(sizeMaxY: 40.0));

            Assert.False(verdict.Eligible);
            // The axis, because "too large" does not say whether the problem is
            // height or width, and only one of those is fixed by a shorter stack.
            Assert.Contains("y axis", Assert.Single(verdict.Refusals));
        }

        [Fact]
        public void Refuses_a_spaceplane_at_a_launch_complex_and_a_rocket_at_the_hangar()
        {
            var plane = Verdict(Craft(facility: KspEditorFacility.SPH), Complex(type: "Pad"));
            Assert.False(plane.Eligible);
            Assert.Contains("hangar", Assert.Single(plane.Refusals));

            var rocket = Verdict(Craft(facility: KspEditorFacility.VAB), Complex(type: "Hangar"));
            Assert.False(rocket.Eligible);
            Assert.Contains("launch complex", Assert.Single(rocket.Refusals));
        }

        [Fact]
        public void Gives_the_complexs_own_state_before_measuring_the_craft_against_it()
        {
            // A complex still being built refuses everything, and saying "too
            // heavy" about one would send an operator to redesign a craft that
            // was never the problem.
            var verdict = Verdict(Craft(mass: 2_900.0), Complex(operational: false));

            Assert.False(verdict.Eligible);
            Assert.Contains("being built or renovated", Assert.Single(verdict.Refusals));
        }

        [Fact]
        public void Refuses_a_clamped_craft_at_the_hangar()
        {
            // Clamps are inferred from the two masses, which is the whole reason
            // the catalogue measures both: their difference IS the clamps.
            var verdict = Verdict(
                Craft(facility: KspEditorFacility.SPH, mass: 12.0, totalMass: 15.0),
                Complex(type: "Hangar", massMin: 1.0));

            Assert.False(verdict.Eligible);
            Assert.Contains("launch clamps", Assert.Single(verdict.Refusals));
        }

        [Fact]
        public void Permits_when_the_craft_could_not_be_weighed_at_all()
        {
            // The direction that matters. An unmeasured mass makes NO comparison
            // rather than one against zero: a zero would be refused for being
            // under every complex's floor, and the control would be dark for a
            // reason that is not about the craft.
            var craft = Craft();
            craft.Mass = null;
            craft.MassExcludingClamps = null;

            var verdict = Verdict(craft, Complex(massMin: 40.0, massMax: 180.0));

            Assert.True(verdict.Eligible);
            Assert.Empty(verdict.Refusals);
        }

        [Fact]
        public void Permits_a_crewed_craft_at_a_complex_that_is_not_human_rated()
        {
            // RP-1 derives human-rating from part TAGS through its own
            // effective-cost walk over loaded parts, and a craft file does not
            // say. So the arm is not applied here at all and the command, which
            // holds a measured vehicle, is the one that refuses. Permissive on
            // purpose: a refusal an operator reads at the press beats a control
            // they cannot press.
            var verdict = Verdict(Craft(), Complex(humanRated: false));

            Assert.True(verdict.Eligible);
            Assert.Empty(verdict.Refusals);
        }

        [Fact]
        public void Keeps_a_craft_no_complex_will_take_rather_than_dropping_it()
        {
            // An operator who saved a craft and cannot find it in the list would
            // go looking for a fault in the Uplink. It is listed, with the reason.
            var rows = Rp1Buildable.Rows(
                new[] { Craft(mass: 2_900.0) },
                new[] { Complex(lcId: "lc-1"), Complex(lcId: "lc-2") });

            var row = Assert.Single(rows);
            Assert.Equal(2, row.Complexes.Count);
            Assert.All(row.Complexes, c => Assert.False(c.Eligible));
        }

        [Fact]
        public void Lists_a_craft_with_no_complexes_at_all()
        {
            // A career that has not built a launch complex yet. The craft is real
            // and the missing thing is the complex, which a row with no verdicts
            // says and an absent row does not.
            var rows = Rp1Buildable.Rows(new[] { Craft() }, new List<Rp1ComplexRaw>());

            Assert.Empty(Assert.Single(rows).Complexes);
        }

        [Fact]
        public void Drops_a_craft_with_no_file_name_because_no_command_could_address_it()
        {
            var craft = Craft();
            craft.File = null;

            Assert.Empty(Rp1Buildable.Rows(new[] { craft }, new[] { Complex() }));
        }

        [Fact]
        public void Publishes_nothing_rather_than_guessing_when_there_is_no_catalogue()
        {
            Assert.Empty(Rp1Buildable.Rows(null, new[] { Complex() }));
        }

        [Fact]
        public void Carries_the_craft_file_and_the_editor_the_command_needs()
        {
            var row = Assert.Single(
                Rp1Buildable.Rows(new[] { Craft(facility: KspEditorFacility.SPH) }, new[] { Complex() }));

            // Both are command arguments, and the ordinal rather than the name
            // because a name would have to be matched against a hand-written set
            // at the far end.
            Assert.Equal("Atlas", row.CraftFile);
            Assert.Equal((int)KspEditorFacility.SPH, row.FacilityOrdinal);
        }

        [Fact]
        public void Publishes_the_clamps_excluded_mass_because_that_is_what_rp1_measures()
        {
            var row = Assert.Single(
                Rp1Buildable.Rows(
                    new[] { Craft(mass: 12.0, totalMass: 15.0) }, new[] { Complex() }));

            Assert.Equal(12.0, row.Mass);
        }
    }
}
