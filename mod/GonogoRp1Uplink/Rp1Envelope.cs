// What a launch complex will and will not take, as pure arithmetic over
// measurements somebody else made.
//
// WHY IT IS ITS OWN FILE. RP-1's envelope was already written down twice in this
// assembly: Rp1LaunchGate reproduces it from a live VesselProject and a live
// LaunchComplex, and Rp1ScReflection.RolloutRefusals reproduces it again to say
// why a finished vehicle cannot leave. Both had to reproduce rather than invoke,
// because VesselProject.MeetsFacilityRequirements MEMOISES mass, size and clamp
// state onto [Persistent] fields and a telemetry read must not edit a save.
//
// A craft FILE needs the same comparison a third time, against measurements that
// come from a file rather than from a vehicle, so the arithmetic moved here and
// RolloutRefusals now calls it. The launch gate still carries its own copy: it
// is load-bearing for every launch and its inputs are live RP-1 objects rather
// than numbers, and the test that runs one fixture through both and asserts they
// agree (Rp1RolloutEligibilityTests) is what keeps the two honest.
//
// NOTHING IS READ AND NOTHING IS INVOKED here. Every input is a double, a bool
// or a string that a caller already established, which is what lets the whole
// comparison be exercised with no RP-1, no KSP and no game.
//
// ABSENCE IS NOT ZERO, and that rule decides every arm. A figure nobody measured
// arrives as null and makes NO comparison at all: an invented zero mass would
// refuse a real vehicle for being too light, and an invented zero limit would
// refuse every vehicle there is. The consequence is deliberate and stated where
// it is used: a comparison that cannot be made permits, and the command that
// spends the money asks RP-1 itself.
using System.Collections.Generic;
using System.Globalization;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// One craft measured against one launch complex, in RP-1's own terms.
    /// </summary>
    public static class Rp1Envelope
    {
        /// <summary>RP-1's <c>LaunchComplexType</c> name for a complex that builds spaceplanes.</summary>
        public const string HangarType = "Hangar";

        /// <summary>The same, for one that builds rockets.</summary>
        public const string PadType = "Pad";

        /// <summary>
        /// Every reason this complex would refuse this craft, or an empty list
        /// when it has none.
        /// </summary>
        /// <param name="mass">Tonnes, clamps excluded, or null when unmeasured.</param>
        /// <param name="sizeX">Metres on each axis, or null when unmeasured.</param>
        /// <param name="humanRated">
        /// Whether the craft carries crew, or null when nobody worked it out.
        /// Null makes no comparison, which is the permissive direction: a
        /// complex that is not human-rated will refuse the craft at the press,
        /// and being told so then beats a control that was dark for a reason
        /// nobody could establish.
        /// </param>
        /// <param name="hasClamps">Whether it has launch clamps or GSE, or null when unknown.</param>
        /// <param name="lcMassMin">The complex's floor in tonnes, or null for none.</param>
        /// <param name="lcMassMax">Its ceiling, or null for a complex with no limit.</param>
        /// <param name="lcSizeX">Its size envelope per axis, or null per axis for no limit.</param>
        /// <param name="lcHumanRated">Whether it is rated to build crewed vehicles, or null when unknown.</param>
        /// <param name="lcType">Its <c>LaunchComplexType</c> name.</param>
        public static List<string> Refusals(
            double? mass,
            double? sizeX,
            double? sizeY,
            double? sizeZ,
            bool? humanRated,
            bool? hasClamps,
            double? lcMassMin,
            double? lcMassMax,
            double? lcSizeX,
            double? lcSizeY,
            double? lcSizeZ,
            bool? lcHumanRated,
            string? lcType)
        {
            var reasons = new List<string>();

            if (mass != null && mass > 0.0 && lcMassMax != null && mass > lcMassMax)
            {
                reasons.Add("too heavy for the complex at " + Tonnes(mass.Value)
                    + " t, limit " + Tonnes(lcMassMax.Value) + " t");
            }
            if (mass != null && mass > 0.0 && lcMassMin != null && mass < lcMassMin)
            {
                // RP-1's floor, which stock has no concept of: a complex rated
                // for a Saturn V cannot usefully integrate a sounding rocket.
                reasons.Add("too light for the complex at " + Tonnes(mass.Value)
                    + " t, minimum " + Tonnes(lcMassMin.Value) + " t");
            }

            var axis = ExceededAxis(sizeX, sizeY, sizeZ, lcSizeX, lcSizeY, lcSizeZ);
            if (axis != null)
            {
                reasons.Add("too large for the complex on its " + axis + " axis");
            }

            if (humanRated == true && lcHumanRated == false)
            {
                reasons.Add("human-rated, and the complex is not");
            }

            if (hasClamps == true && lcType == HangarType)
            {
                reasons.Add("has launch clamps or GSE, and a hangar craft taxis to the runway");
            }

            return reasons;
        }

        /// <summary>
        /// Why this complex is the wrong KIND for a craft from this editor, or
        /// null when it is the right one.
        ///
        /// <para>Separate from <see cref="Refusals"/> because it is not part of
        /// RP-1's envelope: <c>MeetsFacilityRequirements</c> never asks it, and
        /// RP-1 catches it one layer up, in the editor, with a popup of its own.
        /// It has to be asked somewhere, because a vehicle whose project type
        /// does not match its complex is a state RP-1's own constructor logs an
        /// error about and then produces anyway.</para>
        /// </summary>
        public static string? WrongComplexKind(bool spaceplane, string? lcType)
        {
            if (lcType == null)
            {
                return null;
            }
            if (spaceplane && lcType == PadType)
            {
                return "it was built in the SPH and a launch complex integrates rockets, "
                    + "so it belongs at the hangar";
            }
            if (!spaceplane && lcType == HangarType)
            {
                return "it was built in the VAB and the hangar integrates spaceplanes, "
                    + "so it belongs at a launch complex";
            }
            return null;
        }

        /// <summary>
        /// The first axis on which the craft exceeds the complex, named rather
        /// than counted because "too large" does not tell an operator whether the
        /// problem is height or width.
        /// </summary>
        private static string? ExceededAxis(
            double? x, double? y, double? z,
            double? maxX, double? maxY, double? maxZ)
        {
            if (Exceeds(x, maxX)) return "x";
            if (Exceeds(y, maxY)) return "y";
            if (Exceeds(z, maxZ)) return "z";
            return null;
        }

        private static bool Exceeds(double? extent, double? allowed) =>
            extent != null && extent > 0.0 && allowed != null && extent > allowed;

        private static string Tonnes(double value) =>
            value.ToString("N1", CultureInfo.InvariantCulture);
    }
}
