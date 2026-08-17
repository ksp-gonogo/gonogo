using System;
using System.Collections.Generic;
using System.Globalization;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;

namespace Sitrep.CaptureAnalysis.Tests;

/// <summary>
/// A capture in the wire's own shape, generated from a geometry the test picked,
/// so that the answer is known before the analyser is asked for it.
///
/// <para>The real fixtures can only ever demonstrate refusal, because neither of
/// them carries what a verdict needs. Without a capture that DOES support one,
/// "always says cannot conclude" would pass every test in the suite while being
/// completely useless, so this exists to close that hole from the other side.</para>
/// </summary>
public static class SyntheticCapture
{
    public const double KerbinMu = 3.5316e12;
    public const double KerbinRadius = 600_000.0;
    public const double KerbinRotationPeriod = 21_549.425;
    public const double FirstUt = 1_000.0;
    public const double CadenceSeconds = 1.02;

    /// <summary>Kerbin, as an index the synthetic craft and its frame agree on; no body table is involved in a same-body case.</summary>
    public const int KerbinIndex = 0;

    public static OrbitElements LowOrbit()
    {
        return new OrbitElements(
            sma: KerbinRadius + 100_000.0,
            ecc: 0.0,
            inc: 0.0,
            lan: 0.0,
            argPe: 0.0,
            meanAnomalyAtEpoch: 0.0,
            epoch: FirstUt,
            mu: KerbinMu);
    }

    public static RotatingGroundStation Station()
    {
        return RotatingGroundStation.FromLatitudeLongitude(
            latitudeDeg: 0.0,
            longitudeDegAtReferenceUt: 0.0,
            referenceUt: FirstUt,
            rotationPeriodSeconds: KerbinRotationPeriod,
            bodyRadiusMeters: KerbinRadius,
            altitudeMeters: 0.0);
    }

    /// <summary>
    /// Frames for one vessel over <paramref name="durationSeconds"/>, with the
    /// comms path DIRECT exactly while <paramref name="truthRadiusMeters"/> says
    /// the horizon is clear. Optionally declares that same radius on
    /// <c>comms.occlusion</c>, which is how a real capture would tell the analyser
    /// what to score against.
    /// </summary>
    public static IReadOnlyList<string> Lines(
        double truthRadiusMeters,
        double durationSeconds,
        bool declareOcclusion = false)
    {
        OrbitElements orbit = LowOrbit();
        var geometry = new OrbitToGroundStationGeometry(
            PropagationTarget.Vessel("synthetic-craft", KerbinIndex, orbit), Station(), truthRadiusMeters);
        double meanMotion = Math.Sqrt(orbit.Mu / (orbit.Sma * orbit.Sma * orbit.Sma));

        var lines = new List<string>();
        int sequence = 0;

        for (double ut = FirstUt; ut <= FirstUt + durationSeconds; ut += CadenceSeconds)
        {
            sequence++;

            // Elements re-stated at each sample's own epoch, exactly as the host
            // does: the same orbit, with the mean anomaly wound forward.
            double meanAnomaly = orbit.MeanAnomalyAtEpoch + (meanMotion * (ut - orbit.Epoch));
            lines.Add(OrbitFrame(ut, orbit, meanAnomaly, sequence));

            bool clear = ChordOcclusion.Unobstructed(geometry.MarginAt(ut));
            lines.Add(PathFrame(ut, clear, geometry.SeparationAt(ut), sequence));

            if (declareOcclusion && sequence == 1)
            {
                lines.Add(OcclusionFrame(ut, truthRadiusMeters, sequence));
            }
        }

        return lines;
    }

    public static Capture Build(double truthRadiusMeters, double durationSeconds, bool declareOcclusion = false)
    {
        return CaptureReader.Read("synthetic", Lines(truthRadiusMeters, durationSeconds, declareOcclusion));
    }

    private static string OrbitFrame(double ut, OrbitElements orbit, double meanAnomaly, int sequence)
    {
        return "{\"type\":\"stream-data\",\"topic\":\"vessel.orbit\",\"payload\":{"
            + "\"referenceBodyIndex\":1,"
            + $"\"sma\":{Number(orbit.Sma)},"
            + $"\"ecc\":{Number(orbit.Ecc)},"
            + "\"inc\":0,\"lan\":0,\"argPe\":0,"
            + $"\"meanAnomalyAtEpoch\":{Number(meanAnomaly)},"
            + $"\"epoch\":{Number(ut)},"
            + $"\"mu\":{Number(orbit.Mu)},"
            + "\"patches\":[{\"referenceBody\":\"Kerbin\"}]"
            + "}," + Meta(ut, sequence) + "}";
    }

    private static string PathFrame(double ut, bool clear, double separationMeters, int sequence)
    {
        string hops = clear
            ? "[{\"from\":\"probe\",\"to\":\"Kerbal Space Center\",\"fromIsHome\":false,\"toIsHome\":true,"
                + $"\"kind\":0,\"distanceMeters\":{Number(separationMeters)}}}]"
            : "[]";

        return "{\"type\":\"stream-data\",\"topic\":\"comms.path\",\"payload\":{\"hops\":" + hops + "},"
            + Meta(ut, sequence) + "}";
    }

    private static string OcclusionFrame(double ut, double occludingRadius, int sequence)
    {
        return "{\"type\":\"stream-data\",\"topic\":\"comms.occlusion\",\"payload\":{"
            + "\"modelId\":\"realantennas-bare-radius\",\"modelName\":\"RealAntennas\",\"bodies\":["
            + "{\"index\":1,\"name\":\"Kerbin\","
            + $"\"radiusMeters\":{Number(KerbinRadius)},\"hasAtmosphere\":true,"
            + $"\"occludingRadiusMeters\":{Number(occludingRadius)}}}"
            + "]}," + Meta(ut, sequence) + "}";
    }

    private static string Meta(double ut, int sequence)
    {
        return $"\"meta\":{{\"source\":\"system\",\"validAt\":{Number(ut)},\"seq\":{sequence}}}";
    }

    private static string Number(double value)
    {
        return value.ToString("R", CultureInfo.InvariantCulture);
    }
}
