using System;
using System.Collections.Generic;
using System.Text.Json;
using Sitrep.Propagation;

namespace Sitrep.CaptureAnalysis;

/// <summary>
/// The interval between consecutive samples, MEASURED rather than assumed.
///
/// <para>Assuming 1 Hz is one of the mistakes that produced a wrong answer here.
/// The stream's cadence is a UT cadence, and UT advances at the time-warp rate,
/// so "one sample per second" is a statement about the wall clock and says
/// nothing about how much orbit passed between two frames.</para>
/// </summary>
public sealed class Cadence
{
    public Cadence(string source, double medianSeconds, double minSeconds, double maxSeconds, int intervalCount)
    {
        Source = source;
        MedianSeconds = medianSeconds;
        MinSeconds = minSeconds;
        MaxSeconds = maxSeconds;
        IntervalCount = intervalCount;
    }

    /// <summary>Which field the intervals were taken from, named so the reader can judge it.</summary>
    public string Source { get; }

    public double MedianSeconds { get; }

    public double MinSeconds { get; }

    public double MaxSeconds { get; }

    public int IntervalCount { get; }
}

/// <summary>The orbital elements a capture carried, plus what follows from them alone.</summary>
public sealed class CapturedOrbit
{
    public CapturedOrbit(OrbitElements elements, int referenceBodyIndex, string? referenceBodyName, double firstEpochUt, double lastEpochUt)
    {
        Elements = elements;
        ReferenceBodyIndex = referenceBodyIndex;
        ReferenceBodyName = referenceBodyName;
        FirstEpochUt = firstEpochUt;
        LastEpochUt = lastEpochUt;
    }

    /// <summary>Angles converted to radians, which is what <see cref="KeplerProvider"/> wants; the wire carries degrees for everything except the mean anomaly.</summary>
    public OrbitElements Elements { get; }

    public int ReferenceBodyIndex { get; }

    public string? ReferenceBodyName { get; }

    public double FirstEpochUt { get; }

    public double LastEpochUt { get; }

    public double PeriodSeconds =>
        2.0 * Math.PI * Math.Sqrt(Elements.Sma * Elements.Sma * Elements.Sma / Elements.Mu);

    public double ApoapsisRadiusMeters => Elements.Sma * (1.0 + Elements.Ecc);

    public double PeriapsisRadiusMeters => Elements.Sma * (1.0 - Elements.Ecc);
}

/// <summary>The shape of a comms path at one instant, reduced to what distinguishes one state from the next.</summary>
public sealed class PathState : IEquatable<PathState>
{
    public PathState(int hopCount, bool isDirect, string? homeEndpoint)
    {
        HopCount = hopCount;
        IsDirect = isDirect;
        HomeEndpoint = homeEndpoint;
    }

    public int HopCount { get; }

    /// <summary>A single hop that terminates at a home node: vessel straight to the ground, nothing relaying.</summary>
    public bool IsDirect { get; }

    /// <summary>The name of the home node the path terminates at, or null when it terminates nowhere.</summary>
    public string? HomeEndpoint { get; }

    public bool Equals(PathState? other)
    {
        return other is not null
            && HopCount == other.HopCount
            && IsDirect == other.IsDirect
            && HomeEndpoint == other.HomeEndpoint;
    }

    public override bool Equals(object? obj) => Equals(obj as PathState);

    public override int GetHashCode() => HashCode.Combine(HopCount, IsDirect, HomeEndpoint);

    public string Describe()
    {
        if (HopCount == 0)
        {
            return "no path";
        }

        string shape = IsDirect ? "DIRECT" : $"{HopCount} hops";
        return HomeEndpoint is null ? $"{shape}, no home endpoint" : $"{shape} to {HomeEndpoint}";
    }
}

/// <summary>
/// A stretch of capture over which the path state did not change, measured in UT
/// rather than in samples. Sample counts are meaningless across a warp change and
/// were part of an earlier wrong reading.
/// </summary>
public sealed class PathSegment
{
    public PathSegment(PathState state, double startUt, double endUt, int sampleCount)
    {
        State = state;
        StartUt = startUt;
        EndUt = endUt;
        SampleCount = sampleCount;
    }

    public PathState State { get; }

    public double StartUt { get; }

    /// <summary>The UT of the last sample in this run, not of the first sample of the next one.</summary>
    public double EndUt { get; }

    public int SampleCount { get; }

    public double DurationSeconds => EndUt - StartUt;
}

/// <summary>A moment the direct-to-ground link appeared or disappeared, with the separation at which it happened.</summary>
public sealed class DirectLinkEvent
{
    public DirectLinkEvent(bool acquired, double ut, string? homeEndpoint, double? separationMeters, string previousState)
    {
        Acquired = acquired;
        Ut = ut;
        HomeEndpoint = homeEndpoint;
        SeparationMeters = separationMeters;
        PreviousState = previousState;
    }

    public bool Acquired { get; }

    /// <summary>
    /// The UT of the FIRST sample in the new state. The true transition lies
    /// somewhere in the preceding sample interval, which is why the cadence is
    /// reported alongside: it is the resolution of every observed time here.
    /// </summary>
    public double Ut { get; }

    public string? HomeEndpoint { get; }

    /// <summary>The last hop's distance at the moment of the change, which is what a predicted acquisition distance gets compared against.</summary>
    public double? SeparationMeters { get; }

    public string PreviousState { get; }
}

/// <summary>Pulls the facts above out of a parsed capture. No interpretation, no prediction.</summary>
public static class CaptureFacts
{
    public const string OrbitTopic = "vessel.orbit";
    public const string PathTopic = "comms.path";
    public const string DelayTopic = "comms.delay";
    public const string LinkTopic = "comms.link";
    public const string IdentityTopic = "vessel.identity";
    public const string OcclusionTopic = "comms.occlusion";

    /// <summary>
    /// Sample spacing, preferring <c>vessel.orbit</c>'s own epoch because that is
    /// the game's timestamp for the state it describes. Falls back to the frame's
    /// <c>meta.validAt</c>, naming the fallback in <see cref="Cadence.Source"/> so
    /// the reader knows which they got.
    /// </summary>
    public static Cadence? MeasureCadence(Capture capture)
    {
        var epochs = new List<double>();
        foreach (CaptureRecord record in capture.TimestampedSamples(OrbitTopic))
        {
            if (TryReadDouble(record.Payload!.Value, "epoch", out double epoch))
            {
                epochs.Add(epoch);
            }
        }

        if (epochs.Count >= 2)
        {
            return FromSeries("vessel.orbit.epoch", epochs);
        }

        var stamps = new List<double>();
        foreach (CaptureRecord record in capture.TimestampedSamples(PathTopic))
        {
            stamps.Add(record.ValidAtUt!.Value);
        }

        return stamps.Count >= 2 ? FromSeries("comms.path meta.validAt", stamps) : null;
    }

    /// <summary>
    /// The orbit as of the capture's FIRST orbit sample. Elements drift a little
    /// over a capture (drag, a burn, plain numerical wander), so the last epoch is
    /// carried too and a caller can see how far apart they are.
    /// </summary>
    public static CapturedOrbit? ReadOrbit(Capture capture)
    {
        IReadOnlyList<CaptureRecord> samples = capture.TimestampedSamples(OrbitTopic);
        if (samples.Count == 0)
        {
            return null;
        }

        JsonElement first = samples[0].Payload!.Value;
        if (!TryReadDouble(first, "sma", out double sma)
            || !TryReadDouble(first, "mu", out double mu)
            || !TryReadDouble(first, "epoch", out double epoch)
            || sma <= 0.0
            || mu <= 0.0)
        {
            return null;
        }

        TryReadDouble(first, "ecc", out double ecc);
        TryReadDouble(first, "inc", out double incDeg);
        TryReadDouble(first, "lan", out double lanDeg);
        TryReadDouble(first, "argPe", out double argPeDeg);
        TryReadDouble(first, "meanAnomalyAtEpoch", out double meanAnomaly);

        double lastEpoch = epoch;
        JsonElement last = samples[samples.Count - 1].Payload!.Value;
        if (TryReadDouble(last, "epoch", out double tailEpoch))
        {
            lastEpoch = tailEpoch;
        }

        int bodyIndex = TryReadDouble(first, "referenceBodyIndex", out double index) ? (int)index : -1;
        string? bodyName = ReadReferenceBodyName(first);

        // The wire carries inc/lan/argPe in DEGREES and meanAnomalyAtEpoch in
        // RADIANS (Sitrep.Contract's OrbitPatch says so field by field, matching
        // KSP's own Orbit). Mixing those two up silently rotates the orbit, which
        // is not the sort of error that announces itself downstream.
        var elements = OrbitElements.FromKspDegrees(
            sma: sma,
            ecc: ecc,
            incDegrees: incDeg,
            lanDegrees: lanDeg,
            argPeDegrees: argPeDeg,
            meanAnomalyAtEpochRadians: meanAnomaly,
            epoch: epoch,
            mu: mu);

        return new CapturedOrbit(elements, bodyIndex, bodyName, epoch, lastEpoch);
    }

    public static string? ReadVesselName(Capture capture)
    {
        foreach (CaptureRecord record in capture.TimestampedSamples(IdentityTopic))
        {
            if (record.Payload!.Value.TryGetProperty("name", out JsonElement name)
                && name.ValueKind == JsonValueKind.String)
            {
                return name.GetString();
            }
        }

        return null;
    }

    /// <summary>The path state at every <c>comms.path</c> sample, run-length encoded.</summary>
    public static IReadOnlyList<PathSegment> PathTimeline(Capture capture)
    {
        var segments = new List<PathSegment>();
        PathState? current = null;
        double segmentStart = 0.0;
        double segmentEnd = 0.0;
        int samplesInSegment = 0;

        foreach (CaptureRecord record in capture.TimestampedSamples(PathTopic))
        {
            PathState state = ReadPathState(record.Payload!.Value);
            double ut = record.ValidAtUt!.Value;

            if (current is null || !current.Equals(state))
            {
                if (current is not null)
                {
                    segments.Add(new PathSegment(current, segmentStart, segmentEnd, samplesInSegment));
                }

                current = state;
                segmentStart = ut;
                samplesInSegment = 0;
            }

            segmentEnd = ut;
            samplesInSegment++;
        }

        if (current is not null)
        {
            segments.Add(new PathSegment(current, segmentStart, segmentEnd, samplesInSegment));
        }

        return segments;
    }

    /// <summary>
    /// Every acquisition and loss of a DIRECT link, taken off the timeline. The
    /// separation attached to an acquisition is the new link's own distance; the
    /// one attached to a loss is the distance on the last sample that still had
    /// the link, because that is the last moment the geometry is known to have
    /// permitted it.
    /// </summary>
    public static IReadOnlyList<DirectLinkEvent> DirectLinkEvents(Capture capture)
    {
        var events = new List<DirectLinkEvent>();
        IReadOnlyList<CaptureRecord> samples = capture.TimestampedSamples(PathTopic);

        PathState? previousState = null;
        double? previousDirectSeparation = null;

        foreach (CaptureRecord record in samples)
        {
            JsonElement payload = record.Payload!.Value;
            PathState state = ReadPathState(payload);
            double? separation = ReadLastHopDistance(payload);

            if (previousState is not null && previousState.IsDirect != state.IsDirect)
            {
                events.Add(state.IsDirect
                    ? new DirectLinkEvent(true, record.ValidAtUt!.Value, state.HomeEndpoint, separation, previousState.Describe())
                    : new DirectLinkEvent(false, record.ValidAtUt!.Value, previousState.HomeEndpoint, previousDirectSeparation, previousState.Describe()));
            }

            previousState = state;
            if (state.IsDirect)
            {
                previousDirectSeparation = separation;
            }
        }

        return events;
    }

    /// <summary>Every distinct home node the capture ever terminated a path at.</summary>
    public static IReadOnlyList<string> HomeEndpoints(Capture capture)
    {
        var endpoints = new List<string>();
        foreach (CaptureRecord record in capture.TimestampedSamples(PathTopic))
        {
            string? endpoint = ReadPathState(record.Payload!.Value).HomeEndpoint;
            if (endpoint is not null && !endpoints.Contains(endpoint))
            {
                endpoints.Add(endpoint);
            }
        }

        return endpoints;
    }

    /// <summary>
    /// Candidate occluding radii the capture declared for itself, off
    /// <c>comms.occlusion</c>. Both the bare and the resolved radius are taken:
    /// the comparison worth running is between what the rock measures and what
    /// the elected backend treats it as.
    /// </summary>
    public static IReadOnlyList<OcclusionCandidate> OcclusionCandidates(Capture capture, int bodyIndex)
    {
        var candidates = new List<OcclusionCandidate>();

        foreach (CaptureRecord record in capture.TimestampedSamples(OcclusionTopic))
        {
            JsonElement payload = record.Payload!.Value;
            string modelId = payload.TryGetProperty("modelId", out JsonElement id) && id.ValueKind == JsonValueKind.String
                ? id.GetString() ?? "unknown"
                : "unknown";

            if (!payload.TryGetProperty("bodies", out JsonElement bodies) || bodies.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (JsonElement body in bodies.EnumerateArray())
            {
                if (!TryReadDouble(body, "index", out double index) || (int)index != bodyIndex)
                {
                    continue;
                }

                string bodyName = body.TryGetProperty("name", out JsonElement name) && name.ValueKind == JsonValueKind.String
                    ? name.GetString() ?? "?"
                    : "?";

                if (TryReadDouble(body, "radiusMeters", out double bare))
                {
                    AddCandidate(candidates, new OcclusionCandidate($"{bodyName} bare radius", bare));
                }

                if (TryReadDouble(body, "occludingRadiusMeters", out double occluding))
                {
                    AddCandidate(candidates, new OcclusionCandidate($"{modelId} occluding radius", occluding));
                }
            }
        }

        return candidates;
    }

    private static void AddCandidate(List<OcclusionCandidate> candidates, OcclusionCandidate candidate)
    {
        foreach (OcclusionCandidate existing in candidates)
        {
            if (existing.Label == candidate.Label && existing.RadiusMeters == candidate.RadiusMeters)
            {
                return;
            }
        }

        candidates.Add(candidate);
    }

    private static PathState ReadPathState(JsonElement payload)
    {
        if (!payload.TryGetProperty("hops", out JsonElement hops) || hops.ValueKind != JsonValueKind.Array)
        {
            return new PathState(0, false, null);
        }

        int hopCount = hops.GetArrayLength();
        if (hopCount == 0)
        {
            return new PathState(0, false, null);
        }

        JsonElement lastHop = default;
        foreach (JsonElement hop in hops.EnumerateArray())
        {
            lastHop = hop;
        }

        bool toIsHome = lastHop.TryGetProperty("toIsHome", out JsonElement isHome) && isHome.ValueKind == JsonValueKind.True;
        string? endpoint = toIsHome && lastHop.TryGetProperty("to", out JsonElement to) && to.ValueKind == JsonValueKind.String
            ? to.GetString()
            : null;

        return new PathState(hopCount, hopCount == 1 && toIsHome, endpoint);
    }

    private static double? ReadLastHopDistance(JsonElement payload)
    {
        if (!payload.TryGetProperty("hops", out JsonElement hops) || hops.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        double? distance = null;
        foreach (JsonElement hop in hops.EnumerateArray())
        {
            distance = TryReadDouble(hop, "distanceMeters", out double value) ? value : null;
        }

        return distance;
    }

    private static string? ReadReferenceBodyName(JsonElement orbit)
    {
        if (orbit.TryGetProperty("patches", out JsonElement patches) && patches.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement patch in patches.EnumerateArray())
            {
                if (patch.TryGetProperty("referenceBody", out JsonElement body) && body.ValueKind == JsonValueKind.String)
                {
                    return body.GetString();
                }
            }
        }

        return null;
    }

    private static Cadence FromSeries(string source, List<double> series)
    {
        var intervals = new List<double>();
        for (int i = 1; i < series.Count; i++)
        {
            intervals.Add(series[i] - series[i - 1]);
        }

        intervals.Sort();
        double median = intervals.Count % 2 == 1
            ? intervals[intervals.Count / 2]
            : (intervals[(intervals.Count / 2) - 1] + intervals[intervals.Count / 2]) * 0.5;

        return new Cadence(source, median, intervals[0], intervals[intervals.Count - 1], intervals.Count);
    }

    private static bool TryReadDouble(JsonElement element, string name, out double value)
    {
        if (element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty(name, out JsonElement property)
            && property.ValueKind == JsonValueKind.Number)
        {
            value = property.GetDouble();
            return true;
        }

        value = 0.0;
        return false;
    }
}

/// <summary>One occluding radius to score the capture against, with the name of where it came from.</summary>
public sealed class OcclusionCandidate
{
    public OcclusionCandidate(string label, double radiusMeters)
    {
        Label = label;
        RadiusMeters = radiusMeters;
    }

    public string Label { get; }

    public double RadiusMeters { get; }
}
