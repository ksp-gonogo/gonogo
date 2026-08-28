// The buildable preview: every saved craft file measured against every launch
// complex, so a widget can offer a build control that is dark with its reason
// rather than one that can only refuse.
//
// PURE. Nothing here reads RP-1, KSP or Unity. The craft measurements arrive
// from core's craft catalogue (a capability, because opening a craft file
// instantiates Unity parts and an Uplink may not name a Unity type), the complex
// limits arrive from the space-centre walk, and this is the comparison between
// them, run through Rp1Envelope so the same arithmetic answers here and on the
// rollout channel.
//
// WHY THE PREVIEW IS DELIBERATELY MORE PERMISSIVE THAN THE COMMAND. Two arms of
// RP-1's MeetsFacilityRequirements cannot be answered from a craft file:
//
//   humanRated       RP-1 derives it from part tags, through its own effective-cost
//                    walk over the loaded parts. A craft file does not say.
//   ResourcesOK      compares the craft's resourceAmounts against the complex's
//                    resourcesHandled, and the exemption arm needs a KSP resource
//                    density lookup.
//
// Neither is applied, so a craft that would be refused for one of them shows as
// eligible here and is refused by rp1.build.start, which asks RP-1 itself. That
// direction is chosen rather than tolerated: this channel exists because a
// surface with no way to start a build is a dead end, and a control drawn dark
// for a reason nobody could establish is the same dead end with a label on it. A
// refusal an operator reads at the press, in RP-1's own words, is strictly better
// than a control they cannot press.
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Turns the craft catalogue's listing plus the complexes read this tick into
    /// the <c>rp1.buildable</c> rows.
    /// </summary>
    public static class Rp1Buildable
    {
        /// <summary>
        /// One row per craft file, each carrying one verdict per complex.
        ///
        /// <para>Craft with no complexes to judge them still get a row: the
        /// listing is what tells an operator the career HAS designs saved, and a
        /// new career with no launch complex built yet needs to be told that the
        /// complex is what is missing rather than the craft.</para>
        /// </summary>
        public static List<Rp1BuildableRaw> Rows(
            IReadOnlyList<CraftFileRecord>? craft,
            IReadOnlyList<Rp1ComplexRaw>? complexes)
        {
            var rows = new List<Rp1BuildableRaw>();
            if (craft == null)
            {
                return rows;
            }

            foreach (var file in craft)
            {
                if (file == null || string.IsNullOrEmpty(file.File))
                {
                    // A craft with no address cannot be built by any command, so
                    // offering it would be offering a control that must refuse.
                    continue;
                }

                var row = new Rp1BuildableRaw
                {
                    CraftFile = file.File,
                    ShipName = file.ShipName,
                    FacilityOrdinal = file.Facility == null ? (int?)null : (int)file.Facility.Value,
                    PartCount = file.PartCount,
                    // The clamps-excluded figure, because that is the one RP-1
                    // measures against a complex; the total is not on this wire
                    // because nothing compares against it.
                    Mass = file.MassExcludingClamps ?? file.Mass,
                    Cost = file.Cost,
                    MissingParts = file.MissingParts,
                    LockedParts = file.LockedParts,
                    UnpurchasedParts = file.UnpurchasedParts,
                };

                var spaceplane = file.Facility == KspEditorFacility.SPH;
                var hasClamps = HasClamps(file);

                foreach (var complex in complexes ?? new List<Rp1ComplexRaw>())
                {
                    row.Complexes.Add(Verdict(file, complex, spaceplane, hasClamps));
                }

                rows.Add(row);
            }

            return rows;
        }

        /// <summary>One complex's answer, in the order an operator would want to hear the reasons.</summary>
        private static Rp1BuildableComplexRaw Verdict(
            CraftFileRecord file, Rp1ComplexRaw complex, bool spaceplane, bool? hasClamps)
        {
            var refusals = new List<string>();

            var kind = Rp1Envelope.WrongComplexKind(spaceplane, complex.LcType);
            if (kind != null)
            {
                // First, because it is the reason that makes every other one
                // beside the point: a spaceplane's mass against a launch pad's
                // limit is a comparison nobody asked for.
                refusals.Add(kind);
            }
            else if (!complex.IsOperational)
            {
                refusals.Add("the complex is being built or renovated");
            }
            else
            {
                refusals.AddRange(Rp1Envelope.Refusals(
                    mass: file.MassExcludingClamps ?? file.Mass,
                    sizeX: file.SizeX,
                    sizeY: file.SizeY,
                    sizeZ: file.SizeZ,
                    // Not answerable from a craft file; see the file header for
                    // why its absence permits rather than refuses.
                    humanRated: null,
                    hasClamps: hasClamps,
                    lcMassMin: complex.MassMin,
                    lcMassMax: complex.MassMax,
                    lcSizeX: complex.SizeMaxX,
                    lcSizeY: complex.SizeMaxY,
                    lcSizeZ: complex.SizeMaxZ,
                    lcHumanRated: complex.HumanRated,
                    lcType: complex.LcType));
            }

            return new Rp1BuildableComplexRaw
            {
                LcId = complex.LcId,
                Name = complex.Name,
                KscName = complex.KscName,
                Eligible = refusals.Count == 0,
                Refusals = refusals.ToArray(),
            };
        }

        /// <summary>
        /// Whether the craft carries launch clamps, inferred from the two masses
        /// the catalogue measured, or null when it measured neither.
        ///
        /// <para>Inferred rather than asked, because the difference between a
        /// total mass and a clamps-excluded one IS the clamps: a craft where the
        /// two agree has none. Null when either figure is missing, which makes no
        /// comparison at all rather than claiming a craft has no clamps because
        /// nobody weighed it.</para>
        /// </summary>
        private static bool? HasClamps(CraftFileRecord file)
        {
            if (file.Mass == null || file.MassExcludingClamps == null)
            {
                return null;
            }
            return file.Mass.Value > file.MassExcludingClamps.Value;
        }
    }
}
