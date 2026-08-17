using System;
using System.Collections.Generic;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;

namespace Sitrep.CaptureAnalysis;

/// <summary>
/// Turns a live capture into a report, and refuses to turn it into a verdict the
/// data cannot support.
///
/// <para>The structure of every section below is the same: gather the inputs,
/// and if any is missing, record a <see cref="Blocker"/> and produce nothing for
/// that section. Nothing here falls back to a default, substitutes a nominal
/// value, or carries on with a partial input, because that is precisely how the
/// three earlier readings of these captures went wrong.</para>
/// </summary>
public static class CaptureAnalyser
{
    /// <summary>
    /// How far either side of an observed event to hunt for the matching
    /// predicted one. An orbit each way: a candidate radius whose prediction is
    /// more than a whole revolution out has not mispredicted the event, it has
    /// predicted a different one, and pairing them would invent a small error out
    /// of a total mismatch.
    /// </summary>
    private const double SearchWindowInPeriods = 1.0;

    public static CaptureReport Analyse(Capture capture, AnalysisOptions options)
    {
        var report = new CaptureReport
        {
            CapturePath = capture.Path,
            TotalLines = capture.TotalLines,
            UnparseableLines = capture.UnparseableLines,
            PreGameSamples = capture.PreGameSampleCount,
        };

        foreach (string topic in capture.TopicsPresent)
        {
            report.SamplesByTopic[topic] = capture.SampleCount(topic);
        }

        report.VesselName = CaptureFacts.ReadVesselName(capture);
        report.UtSpanSeconds = MeasureUtSpan(capture);

        AddCadence(capture, options, report);
        CapturedOrbit? orbit = AddOrbit(capture, report);
        AddPathTimeline(capture, report);
        IReadOnlyList<OcclusionCandidate> candidates = AddCandidates(capture, options, orbit, report);
        RotatingGroundStation? station = AddStation(options, orbit, report);

        AddPredictions(orbit, station, candidates, options, report);

        return report;
    }

    private static double? MeasureUtSpan(Capture capture)
    {
        double? first = null;
        double? last = null;

        foreach (CaptureRecord record in capture.Records)
        {
            if (!record.IsTimestampedSample)
            {
                continue;
            }

            first ??= record.ValidAtUt!.Value;
            last = record.ValidAtUt!.Value;
        }

        return first.HasValue && last.HasValue ? last.Value - first.Value : null;
    }

    private static void AddCadence(Capture capture, AnalysisOptions options, CaptureReport report)
    {
        report.Cadence = CaptureFacts.MeasureCadence(capture);

        if (report.Cadence is null)
        {
            report.Blockers.Add(new Blocker(
                "Sample cadence",
                "fewer than two timestamped samples, so no interval exists to measure",
                "capture for longer, or subscribe to a topic that streams (vessel.orbit or comms.path)"));
            return;
        }

        if (options.WallClockSeconds.HasValue && options.WallClockSeconds.Value > 0.0 && report.UtSpanSeconds.HasValue)
        {
            report.ImpliedWarpFactor = report.UtSpanSeconds.Value / options.WallClockSeconds.Value;
        }
        else
        {
            report.Blockers.Add(new Blocker(
                "Implied time-warp factor",
                "capture frames carry UT only; capture-sitrep-ws.mjs stamps no wall clock, so UT per wall second cannot be recovered from the file",
                "re-run with --wall-seconds <the duration the capture harness was given>"));
        }
    }

    private static CapturedOrbit? AddOrbit(Capture capture, CaptureReport report)
    {
        CapturedOrbit? orbit = CaptureFacts.ReadOrbit(capture);
        report.Orbit = orbit;

        if (orbit is not null)
        {
            return orbit;
        }

        bool subscribed = report.SamplesByTopic.ContainsKey(CaptureFacts.OrbitTopic);
        report.Blockers.Add(new Blocker(
            "Vessel orbit, and everything geometric that depends on it",
            subscribed
                ? "vessel.orbit appears in the capture but never carried usable elements (sma/mu/epoch)"
                : "the capture carries no vessel.orbit sample at all, which is what a capture started during a scene load looks like",
            "re-capture with vessel.orbit subscribed and recording begun after the flight scene is up"));
        return null;
    }

    private static void AddPathTimeline(Capture capture, CaptureReport report)
    {
        if (!report.SamplesByTopic.ContainsKey(CaptureFacts.PathTopic))
        {
            report.Blockers.Add(new Blocker(
                "Observed link timeline and every separation distance",
                "the capture carries no comms.path samples, so there are no hops, no home endpoints and no distances to observe"
                    + DescribeCoarseLink(capture, report),
                $"re-capture with {CaptureFacts.PathTopic} in the topic list"));
            return;
        }

        report.PathTimeline.AddRange(CaptureFacts.PathTimeline(capture));
        report.DirectLinkEvents.AddRange(CaptureFacts.DirectLinkEvents(capture));
        report.HomeEndpoints.AddRange(CaptureFacts.HomeEndpoints(capture));

        if (report.DirectLinkEvents.Count == 0)
        {
            report.Blockers.Add(new Blocker(
                "Observed DIRECT-link acquisition and loss",
                report.PathTimeline.Count <= 1
                    ? "the path state never changed across the whole capture, so no acquisition or loss was observed"
                    : "the path changed shape but never crossed into or out of a DIRECT (single-hop-to-home) state",
                "capture across a horizon crossing: start before the pass and run past the reacquisition"));
        }

        AddEndpointAmbiguity(report);
    }

    /// <summary>
    /// When <c>comms.path</c> is missing, <c>comms.link</c>'s bare connected flag
    /// is the only remaining witness, and whether IT ever changed decides how bad
    /// the gap is. A capture that stayed connected throughout did not merely fail
    /// to record the hops of an event, it contains no event: no amount of
    /// re-reading it will produce one.
    /// </summary>
    private static string DescribeCoarseLink(Capture capture, CaptureReport report)
    {
        if (!report.SamplesByTopic.TryGetValue(CaptureFacts.LinkTopic, out int linkSamples) || linkSamples == 0)
        {
            return "";
        }

        int transitions = 0;
        bool? previous = null;
        bool connectedThroughout = true;

        foreach (CaptureRecord record in capture.TimestampedSamples(CaptureFacts.LinkTopic))
        {
            if (!record.Payload!.Value.TryGetProperty("connected", out System.Text.Json.JsonElement connected))
            {
                continue;
            }

            bool value = connected.ValueKind == System.Text.Json.JsonValueKind.True;
            connectedThroughout &= value;
            if (previous.HasValue && previous.Value != value)
            {
                transitions++;
            }

            previous = value;
        }

        return transitions == 0
            ? $"; comms.link is present and reports {(connectedThroughout ? "connected" : "disconnected")} on all {linkSamples} samples, so not even a coarse connect/disconnect was observed"
            : $"; comms.link did change state {transitions} time(s), so the capture spans a real event whose geometry it simply did not record";
    }

    /// <summary>
    /// A prediction is made against ONE ground station. If the capture terminated
    /// its paths at several, or at a node whose name says nothing about which it
    /// was, then the observed events do not all belong to the same geometry and
    /// scoring them against a single station's horizon would be comparing two
    /// different questions.
    /// </summary>
    private static void AddEndpointAmbiguity(CaptureReport report)
    {
        if (report.HomeEndpoints.Count > 1)
        {
            report.Blockers.Add(new Blocker(
                "Which ground station the observed events belong to",
                $"the capture terminates at {report.HomeEndpoints.Count} distinct home nodes ({string.Join(", ", report.HomeEndpoints)}), each with its own position and horizon",
                "analyse one station at a time: split the capture at the handover, or re-capture a pass that stays with a single station"));
            return;
        }

        foreach (string endpoint in report.HomeEndpoints)
        {
            if (string.Equals(endpoint, "home", StringComparison.OrdinalIgnoreCase))
            {
                report.Blockers.Add(new Blocker(
                    "Which ground station the observed events belong to",
                    "every home node is reported as the literal string \"home\", which is the older telemetry's placeholder: several distinct stations are indistinguishable under it",
                    "re-capture against a mod build that names home nodes, or supply the station explicitly and accept that the capture cannot confirm the choice"));
            }
        }
    }

    private static IReadOnlyList<OcclusionCandidate> AddCandidates(
        Capture capture,
        AnalysisOptions options,
        CapturedOrbit? orbit,
        CaptureReport report)
    {
        if (orbit is not null && report.SamplesByTopic.ContainsKey(CaptureFacts.OcclusionTopic))
        {
            IReadOnlyList<OcclusionCandidate> declared =
                CaptureFacts.OcclusionCandidates(capture, orbit.ReferenceBodyIndex);
            if (declared.Count > 0)
            {
                report.Candidates.AddRange(declared);
                return report.Candidates;
            }
        }

        if (options.Candidates.Count > 0)
        {
            report.Candidates.AddRange(options.Candidates);
            return report.Candidates;
        }

        report.Blockers.Add(new Blocker(
            "Which occluding radius the backend used",
            "the capture carries no comms.occlusion frames declaring the elected model, and none were supplied",
            "re-capture with comms.occlusion subscribed (it is a keyframe, so it costs nothing), or pass --radius <label>=<metres> once per candidate"));
        return report.Candidates;
    }

    private static RotatingGroundStation? AddStation(AnalysisOptions options, CapturedOrbit? orbit, CaptureReport report)
    {
        if (options.HasStation)
        {
            return RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: options.StationLatitudeDeg!.Value,
                longitudeDegAtReferenceUt: options.StationLongitudeDeg!.Value,
                referenceUt: orbit?.FirstEpochUt ?? 0.0,
                rotationPeriodSeconds: options.RotationPeriodSeconds!.Value,
                bodyRadiusMeters: options.BodyRadiusMeters!.Value,
                altitudeMeters: options.StationAltitudeMeters);
        }

        var missing = new List<string>();
        if (!options.StationLatitudeDeg.HasValue)
        {
            missing.Add("--station-lat");
        }

        if (!options.StationLongitudeDeg.HasValue)
        {
            missing.Add("--station-lon");
        }

        if (!options.BodyRadiusMeters.HasValue)
        {
            missing.Add("--body-radius");
        }

        if (!options.RotationPeriodSeconds.HasValue)
        {
            missing.Add("--rotation-period");
        }

        report.Blockers.Add(new Blocker(
            "Predicted acquisition and loss",
            "the ground station's position is not in the capture: comms.path names the home node but carries no coordinates for it, and the body's rotation period is not on the wire either",
            $"supply {string.Join(" ", missing)} (the rotation period read live from the body, since KSP overwrites it for tidally-locked ones)"));
        return null;
    }

    private static void AddPredictions(
        CapturedOrbit? orbit,
        RotatingGroundStation? station,
        IReadOnlyList<OcclusionCandidate> candidates,
        AnalysisOptions options,
        CaptureReport report)
    {
        if (orbit is null || station is null || candidates.Count == 0 || report.DirectLinkEvents.Count == 0)
        {
            return;
        }

        if (orbit.PeriodSeconds == null)
        {
            // No repeating cycle means no scale to sweep at, and this tool exists
            // to compare a prediction against an observation rather than to invent
            // one. Skip the occlusion sweep rather than choose a step arbitrarily.
            return;
        }

        double period = orbit.PeriodSeconds.Value;

        // Half a degree of relative arc by default, which the predictor spec puts
        // at 3-6 s for every low orbit. Tightened to the capture's own cadence
        // when that is finer: a prediction resolved more coarsely than the
        // observation it is being compared against would have its error dominated
        // by the sweep rather than by the candidate radius under test.
        double step = options.SweepStepSeconds
            ?? (report.Cadence is not null
                ? Math.Min(period / 720.0, report.Cadence.MedianSeconds)
                : period / 720.0);

        foreach (OcclusionCandidate candidate in candidates)
        {
            var geometry = new OrbitToGroundStationGeometry(orbit.Elements, station.Value, candidate.RadiusMeters);

            foreach (DirectLinkEvent observed in report.DirectLinkEvents)
            {
                double windowStart = observed.Ut - (SearchWindowInPeriods * period);
                double windowEnd = observed.Ut + (SearchWindowInPeriods * period);

                VisibilitySweepResult sweep = VisibilitySweep.Run(geometry, windowStart, windowEnd, step, 0.01);

                VisibilityChange? nearest = null;
                foreach (VisibilityChange change in sweep.Changes)
                {
                    if (change.BecameClear != observed.Acquired)
                    {
                        continue;
                    }

                    if (nearest is null
                        || Math.Abs(change.Ut - observed.Ut) < Math.Abs(nearest.Ut - observed.Ut))
                    {
                        nearest = change;
                    }
                }

                report.Predictions.Add(new PredictionComparison(
                    candidate,
                    observed,
                    nearest?.Ut,
                    nearest is null ? null : geometry.SeparationAt(nearest.Ut)));
            }
        }
    }
}
