using System;
using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// Everything <c>realantennas.antenna.target</c> decides BEFORE it touches
    /// the game: which mode was asked for, whether the antenna has earned it,
    /// whether the numbers are in range, and what the <c>TARGET</c> node should
    /// therefore contain. KSP-free, so every branch of it is reachable
    /// headlessly (<c>GonogoRealAntennasUplink.Tests</c>).
    ///
    /// <para>The node this produces is described as name/value pairs rather than
    /// built here, because a <c>ConfigNode</c> is KSP's. <see cref="RaTargeting"/>
    /// walks the pairs into one. The VALUES are already in RealAntennas' own
    /// persisted spelling, invariant-culture formatted: a comma decimal
    /// separator would turn a three-component vector into six components and
    /// the target would load somewhere else entirely.</para>
    /// </summary>
    public static class RaTargetPlan
    {
        /// <summary>Aim at the named vessel.</summary>
        public const string ModeVessel = "Vessel";

        /// <summary>
        /// Aim at the centre of a body. Not a stored kind: it lowers to
        /// <see cref="ModeBodyLatLonAlt"/> at latitude 0, longitude 0, altitude
        /// minus the body's radius, which is what RealAntennas' own "Body
        /// Center" button writes. It keeps its own name here because the
        /// tech-level gate is declared against it.
        /// </summary>
        public const string ModeBodyCenter = "BodyCenter";

        /// <summary>Aim at a fixed point on a body.</summary>
        public const string ModeBodyLatLonAlt = "BodyLatLonAlt";

        /// <summary>Aim along an azimuth and elevation measured from the antenna's own craft.</summary>
        public const string ModeAzEl = "AzEl";

        /// <summary>Aim at a deflection from the antenna's own craft's prograde.</summary>
        public const string ModeOrbitRelative = "OrbitRelative";

        /// <summary>
        /// The five mode names RealAntennas' <c>TargetMode</c> enum declares, in
        /// its own order. Four of them name a stored target class;
        /// <see cref="ModeBodyCenter"/> is the fifth name and stores as
        /// <see cref="ModeBodyLatLonAlt"/>.
        /// </summary>
        public static readonly string[] AllModes =
        {
            ModeVessel,
            ModeBodyCenter,
            ModeBodyLatLonAlt,
            ModeAzEl,
            ModeOrbitRelative,
        };

        /// <summary>Whether <paramref name="mode"/> is one of the five RealAntennas declares.</summary>
        public static bool IsKnownMode(string? mode) => Array.IndexOf(AllModes, mode ?? "") >= 0;

        /// <summary>
        /// The kind actually stored for a requested mode: everything is itself
        /// except <see cref="ModeBodyCenter"/>, which stores as
        /// <see cref="ModeBodyLatLonAlt"/>.
        /// </summary>
        public static string StoredKind(string mode) =>
            mode == ModeBodyCenter ? ModeBodyLatLonAlt : mode;

        /// <summary>
        /// The tech-level check RealAntennas declares but does not enforce: only
        /// its own targeting window filters the mode list, while the property
        /// setter, <c>LoadFromConfig</c> and <c>SetDefaultTarget</c> check
        /// nothing. A caller that does not go through that window can set a mode
        /// the antenna has not earned, so this Uplink re-imposes it.
        ///
        /// <para>Passes when the mode is not in <paramref name="modeTechLevels"/>
        /// at all. The table is loaded from config at scenario start, so an
        /// absent entry means the install does not declare that mode rather than
        /// that the mode is forbidden, and refusing on a missing row would
        /// disable targeting entirely on an install whose table had not loaded
        /// yet.</para>
        /// </summary>
        public static bool ModeIsUnlocked(
            string mode,
            int? antennaTechLevel,
            IReadOnlyDictionary<string, int> modeTechLevels,
            out int requiredTechLevel)
        {
            requiredTechLevel = 0;
            if (!modeTechLevels.TryGetValue(mode, out var required))
            {
                return true;
            }
            requiredTechLevel = required;
            return antennaTechLevel == null || antennaTechLevel.Value >= required;
        }

        /// <summary>
        /// Whether an antenna of this SHAPE can be aimed, and the refusal when it
        /// cannot. Three answers rather than two, because
        /// <c>RaReflection.Steerable</c> has three: a dish proceeds, an omni is
        /// refused as an omni, and an antenna whose shape did not read is refused
        /// as unread.
        ///
        /// <para>The third arm is <see cref="CommandErrorCode.Unreadable"/> and
        /// deliberately not <see cref="CommandErrorCode.CapabilityMismatch"/>,
        /// which the omni arm above it earns by having been told so. A failed
        /// read establishes nothing about the hardware, and folding it into the
        /// omni arm reported a dish as an omni on the strength of a reflection
        /// call that failed.</para>
        /// </summary>
        public static bool TrySteerable(
            bool? steerable,
            string? antennaName,
            out CommandErrorCode error,
            out string? detail)
        {
            error = CommandErrorCode.None;
            detail = null;
            var name = antennaName ?? "";
            if (steerable == true)
            {
                return true;
            }
            if (steerable == false)
            {
                error = CommandErrorCode.CapabilityMismatch;
                detail = "'" + name + "' is an omni antenna and cannot be aimed.";
                return false;
            }
            error = CommandErrorCode.Unreadable;
            detail = "Could not read whether '" + name
                + "' can be aimed, so nothing was sent. It may or may not be an omni.";
            return false;
        }

        /// <summary>
        /// The mode names an antenna at <paramref name="antennaTechLevel"/> has
        /// earned, for <c>RealAntennasAntennaState.AvailableTargetModes</c>.
        /// Ordered as <see cref="AllModes"/> is, so a client's picker does not
        /// reorder itself between ticks; a mode the install does not declare is
        /// left out entirely, because the client cannot offer what
        /// <c>LoadFromConfig</c> would then not build.
        /// </summary>
        public static string[] UnlockedModes(
            int? antennaTechLevel,
            IReadOnlyDictionary<string, int> modeTechLevels)
        {
            var unlocked = new List<string>(AllModes.Length);
            foreach (var mode in AllModes)
            {
                if (modeTechLevels.TryGetValue(mode, out var required)
                    && (antennaTechLevel == null || antennaTechLevel.Value >= required))
                {
                    unlocked.Add(mode);
                }
            }
            return unlocked.ToArray();
        }

        /// <summary>
        /// The <c>TARGET</c> node's contents for a validated request, or a
        /// refusal. <paramref name="ownVesselId"/> is the antenna's own craft,
        /// which <see cref="ModeAzEl"/> and <see cref="ModeOrbitRelative"/>
        /// measure their angles from; <paramref name="bodyRadiusMetres"/> is the
        /// radius of the resolved body, needed only to lower
        /// <see cref="ModeBodyCenter"/>.
        ///
        /// <para>Out-of-range angles are REFUSED rather than clamped.
        /// RealAntennas' own window clamps them silently, but a window shows the
        /// operator the clamped number back; a command that clamped would report
        /// success for an aim point nobody asked for, minutes after they asked.</para>
        ///
        /// <para>An ABSENT angle is refused on the same ground, and it is the
        /// likelier case: the client's form starts every coordinate box empty and
        /// parses an empty or unreadable one to absent, so an operator who picks
        /// a mode and presses AIM without typing arrives here with nothing.
        /// Substituting zero aimed the dish at 0N 0E, or due north on the
        /// horizon, and reported success. <see cref="RealAntennasTargetArgs.Altitude"/>
        /// is the single exception: its default is a stated one.</para>
        /// </summary>
        public static bool TryBuild(
            RealAntennasTargetArgs args,
            string? ownVesselId,
            string? resolvedBodyName,
            double bodyRadiusMetres,
            out Dictionary<string, string> values,
            out CommandErrorCode error,
            out string? detail)
        {
            values = new Dictionary<string, string>();
            error = CommandErrorCode.None;
            detail = null;

            var mode = args.Mode ?? "";
            if (!IsKnownMode(mode))
            {
                error = CommandErrorCode.Range;
                detail = "Unknown target mode '" + mode + "'. Expected one of: " + string.Join(", ", AllModes) + ".";
                return false;
            }

            values["name"] = StoredKind(mode);

            switch (mode)
            {
                case ModeVessel:
                    if (!Guid.TryParse(args.VesselId ?? "", out var targetVessel))
                    {
                        error = CommandErrorCode.Range;
                        detail = "Vessel targeting needs a vesselId, and RealAntennas parses it as a Guid.";
                        return false;
                    }
                    values["vesselId"] = targetVessel.ToString();
                    return true;

                case ModeBodyCenter:
                    if (string.IsNullOrEmpty(resolvedBodyName))
                    {
                        error = CommandErrorCode.NotFound;
                        detail = "No body named '" + (args.BodyName ?? "") + "'.";
                        return false;
                    }
                    values["bodyName"] = resolvedBodyName!;
                    // Latitude 0, longitude 0, altitude minus the radius: RealAntennas'
                    // own spelling of a body's centre, in both its "Body Center" button
                    // and the default it gives an untargeted dish.
                    values["latLonAlt"] = VectorText(0.0, 0.0, -bodyRadiusMetres);
                    return true;

                case ModeBodyLatLonAlt:
                {
                    if (string.IsNullOrEmpty(resolvedBodyName))
                    {
                        error = CommandErrorCode.NotFound;
                        detail = "No body named '" + (args.BodyName ?? "") + "'.";
                        return false;
                    }
                    if (args.Latitude == null || args.Longitude == null)
                    {
                        error = CommandErrorCode.Range;
                        detail = "A surface point needs both a latitude and a longitude"
                            + Missing(("latitude", args.Latitude), ("longitude", args.Longitude))
                            + ". Aiming at 0, 0 instead would slew the dish off whatever it is currently hearing.";
                        return false;
                    }
                    var latitude = args.Latitude.Value;
                    var longitude = args.Longitude.Value;
                    if (!InRange(latitude, -90.0, 90.0))
                    {
                        error = CommandErrorCode.Range;
                        detail = "Latitude must be between -90 and 90.";
                        return false;
                    }
                    if (!InRange(longitude, -180.0, 360.0))
                    {
                        error = CommandErrorCode.Range;
                        detail = "Longitude must be between -180 and 360.";
                        return false;
                    }
                    values["bodyName"] = resolvedBodyName!;
                    // Altitude is the one coordinate with a default, and the
                    // contract field states it: a lat/lon with no altitude is a
                    // point on the surface. RealAntennas stores three components
                    // and has no spelling for a missing one, so the choice is
                    // between a stated default and refusing a request whose
                    // meaning is not in doubt.
                    values["latLonAlt"] = VectorText(latitude, longitude, args.Altitude ?? 0.0);
                    return true;
                }

                case ModeAzEl:
                {
                    if (string.IsNullOrEmpty(ownVesselId))
                    {
                        error = CommandErrorCode.NoVessel;
                        detail = "Azimuth/elevation is measured from the antenna's own craft, which could not be identified.";
                        return false;
                    }
                    if (args.Azimuth == null || args.Elevation == null)
                    {
                        error = CommandErrorCode.Range;
                        detail = "An azimuth/elevation aim needs both angles"
                            + Missing(("azimuth", args.Azimuth), ("elevation", args.Elevation))
                            + ". Aiming at 0, 0 instead would put the dish due north on the horizon.";
                        return false;
                    }
                    var azimuth = args.Azimuth.Value;
                    var elevation = args.Elevation.Value;
                    if (!InRange(azimuth, 0.0, 360.0))
                    {
                        error = CommandErrorCode.Range;
                        detail = "Azimuth must be between 0 and 360.";
                        return false;
                    }
                    if (!InRange(elevation, -90.0, 90.0))
                    {
                        error = CommandErrorCode.Range;
                        detail = "Elevation must be between -90 and 90.";
                        return false;
                    }
                    values["vesselId"] = ownVesselId!;
                    values["azimuth"] = Number(azimuth);
                    values["elevation"] = Number(elevation);
                    return true;
                }

                case ModeOrbitRelative:
                {
                    if (string.IsNullOrEmpty(ownVesselId))
                    {
                        error = CommandErrorCode.NoVessel;
                        detail = "Orbit-relative aim is measured from the antenna's own craft, which could not be identified.";
                        return false;
                    }
                    if (args.Forward == null || args.Elevation == null)
                    {
                        error = CommandErrorCode.Range;
                        detail = "An orbit-relative aim needs both angles"
                            + Missing(("deflection", args.Forward), ("elevation", args.Elevation))
                            + ". Aiming at 0, 0 instead would put the dish straight down the prograde vector.";
                        return false;
                    }
                    var forward = args.Forward.Value;
                    var elevation = args.Elevation.Value;
                    if (!InRange(forward, -180.0, 180.0))
                    {
                        error = CommandErrorCode.Range;
                        detail = "Deflection must be between -180 and 180.";
                        return false;
                    }
                    if (!InRange(elevation, -90.0, 90.0))
                    {
                        error = CommandErrorCode.Range;
                        detail = "Elevation must be between -90 and 90.";
                        return false;
                    }
                    values["vesselId"] = ownVesselId!;
                    values["forward"] = Number(forward);
                    values["elevation"] = Number(elevation);
                    return true;
                }
            }

            error = CommandErrorCode.Range;
            detail = "Unhandled target mode '" + mode + "'.";
            return false;
        }

        /// <summary>
        /// Names which of the mode's angles were absent, as " (no azimuth)" or
        /// " (no azimuth, no elevation)". Empty when both arrived, so the caller
        /// can concatenate it unconditionally.
        /// </summary>
        private static string Missing(params (string Name, double? Value)[] fields)
        {
            var absent = new List<string>(fields.Length);
            foreach (var field in fields)
            {
                if (field.Value == null)
                {
                    absent.Add("no " + field.Name);
                }
            }
            return absent.Count == 0 ? "" : " (" + string.Join(", ", absent) + ")";
        }

        /// <summary>Rejects NaN and the infinities as well as anything outside the bounds.</summary>
        private static bool InRange(double value, double low, double high) =>
            !double.IsNaN(value) && !double.IsInfinity(value) && value >= low && value <= high;

        /// <summary>
        /// Plain decimal, never exponent notation: RealAntennas reads these back
        /// through KSP's own float parse, and "1E-05" is not a number KSP writes
        /// for a persisted field.
        /// </summary>
        private static string Number(double value) =>
            value.ToString("0.##########", CultureInfo.InvariantCulture);

        private static string VectorText(double x, double y, double z) =>
            Number(x) + "," + Number(y) + "," + Number(z);
    }
}
