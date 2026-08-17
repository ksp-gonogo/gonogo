using System;
using System.IO;
using System.Linq;
using Xunit;

namespace Sitrep.CaptureAnalysis.Tests;

/// <summary>
/// The two captures that three earlier analyses drew wrong conclusions from.
/// Neither can settle the occluding-radius question, and the tests below pin
/// down that the tool says so, and says WHY, rather than producing a number.
/// </summary>
public class RealCaptureTests
{
    private static Capture Load(string name)
    {
        string path = Path.Combine(AppContext.BaseDirectory, "fixtures", name);
        Assert.True(File.Exists(path), $"missing fixture: {path}");
        return CaptureReader.ReadFile(path);
    }

    private static Capture RelayToDirect() => Load("kerbin-lko-relay-to-direct.ndjson");

    private static Capture OrbitOnly() => Load("kerbin-lko-orbit-only.ndjson");

    private static bool Blocks(CaptureReport report, string questionFragment)
    {
        return report.Blockers.Any(b => b.Question.Contains(questionFragment, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void TheRelayToDirectCaptureCannotConcludeBecauseItCarriesNoOrbit()
    {
        // Recording began during a scene load, so vessel.orbit was subscribed but
        // never delivered a payload. This is the exact failure an earlier analysis
        // walked straight past.
        CaptureReport report = CaptureAnalyser.Analyse(RelayToDirect(), new AnalysisOptions());

        Assert.Null(report.Orbit);
        Assert.True(Blocks(report, "Vessel orbit"));
        Assert.Empty(report.Predictions);
        Assert.False(report.ReachedAVerdict);
    }

    [Fact]
    public void TheRelayToDirectCaptureRefusesToPickOneOfItsTwoGroundStations()
    {
        // The capture hands over from the KSC to Harvester Massif mid-pass. Those
        // are different points on Kerbin with different horizons, so scoring both
        // events against a single station would be answering two questions with
        // one geometry.
        CaptureReport report = CaptureAnalyser.Analyse(RelayToDirect(), new AnalysisOptions());

        Assert.Equal(
            new[] { "Kerbal Space Center", "Harvester Massif Station" },
            report.HomeEndpoints);
        Assert.True(Blocks(report, "Which ground station"));
    }

    [Fact]
    public void TheRelayToDirectCaptureStillReportsEverythingItDoesEstablish()
    {
        // Refusing a verdict is not refusing to work: the cadence, the timeline
        // and the one observed acquisition are all real findings.
        CaptureReport report = CaptureAnalyser.Analyse(RelayToDirect(), new AnalysisOptions());

        Assert.NotNull(report.Cadence);
        Assert.Equal("comms.path meta.validAt", report.Cadence!.Source);
        Assert.Equal(1.02, report.Cadence.MedianSeconds, 3);

        Assert.Equal(3, report.PathTimeline.Count);
        Assert.Equal("no path", report.PathTimeline[0].State.Describe());
        Assert.Equal("2 hops to Kerbal Space Center", report.PathTimeline[1].State.Describe());
        Assert.Equal("DIRECT to Harvester Massif Station", report.PathTimeline[2].State.Describe());

        DirectLinkEvent acquisition = Assert.Single(report.DirectLinkEvents);
        Assert.True(acquisition.Acquired);
        Assert.Equal("Harvester Massif Station", acquisition.HomeEndpoint);
        Assert.Equal(146_285.6, acquisition.Ut, 1);
        Assert.Equal(389_687.2, acquisition.SeparationMeters!.Value, 1);
    }

    [Fact]
    public void ThePreFlightFramesAtUtZeroAreExcludedFromTheCadence()
    {
        // Three frames arrive stamped UT 0 before the game has a clock. Counted as
        // intervals they would put a 146,000 s gap in a 1 s series, which reads
        // exactly like a time-warp change that never happened.
        CaptureReport report = CaptureAnalyser.Analyse(RelayToDirect(), new AnalysisOptions());

        Assert.Equal(3, report.PreGameSamples);
        Assert.Equal(1.02, report.Cadence!.MaxSeconds, 3);
        Assert.Equal(1.02, report.Cadence.MinSeconds, 3);
    }

    [Fact]
    public void TheOrbitOnlyCaptureCannotConcludeBecauseNothingEverHappenedInIt()
    {
        // The opposite gap: a good orbit for 1,720 s of UT, and no comms.path at
        // all. comms.link is there and never leaves "connected", so the capture
        // does not merely lack the detail of an event, it contains no event.
        CaptureReport report = CaptureAnalyser.Analyse(OrbitOnly(), new AnalysisOptions());

        Assert.NotNull(report.Orbit);
        Assert.Empty(report.PathTimeline);
        Assert.Empty(report.DirectLinkEvents);
        Assert.False(report.ReachedAVerdict);

        Blocker blocker = report.Blockers.First(b => b.Question.Contains("Observed link timeline"));
        Assert.Contains("no comms.path samples", blocker.Reason);
        Assert.Contains("reports connected on all 1687 samples", blocker.Reason);
    }

    [Fact]
    public void TheOrbitOnlyCaptureMeasuresItsCadenceRatherThanAssumingOneHertz()
    {
        CaptureReport report = CaptureAnalyser.Analyse(OrbitOnly(), new AnalysisOptions());

        Assert.Equal("vessel.orbit.epoch", report.Cadence!.Source);
        Assert.Equal(1.02, report.Cadence.MedianSeconds, 3);
        Assert.Equal(1686, report.Cadence.IntervalCount);
        Assert.Equal(1719.72, report.UtSpanSeconds!.Value, 2);
    }

    [Fact]
    public void TheOrbitOnlyCaptureDerivesItsPeriodFromSmaAndMu()
    {
        CaptureReport report = CaptureAnalyser.Analyse(OrbitOnly(), new AnalysisOptions());

        Assert.Equal("Kerbin", report.Orbit!.ReferenceBodyName);
        Assert.Equal(1, report.Orbit.ReferenceBodyIndex);
        Assert.Equal(686_749.2, report.Orbit.Elements.Sma, 1);
        Assert.Equal(1902.79, report.Orbit.PeriodSeconds!.Value, 2);

        // The wire carries lan/argPe in degrees; if that were read as radians the
        // orbit would be rotated by hundreds of degrees and nothing downstream
        // would say so.
        Assert.Equal(356.0109, report.Orbit.Elements.Lan * 180.0 / Math.PI, 3);
        Assert.Equal(13.4345, report.Orbit.Elements.ArgPe * 180.0 / Math.PI, 4);
    }

    [Fact]
    public void TheWarpFactorIsBlockedUntilTheWallDurationIsSupplied()
    {
        CaptureReport withoutWall = CaptureAnalyser.Analyse(OrbitOnly(), new AnalysisOptions());

        Assert.Null(withoutWall.ImpliedWarpFactor);
        Assert.True(Blocks(withoutWall, "time-warp"));

        CaptureReport withWall = CaptureAnalyser.Analyse(
            OrbitOnly(), new AnalysisOptions { WallClockSeconds = 1_720.0 });

        Assert.Equal(1.0, withWall.ImpliedWarpFactor!.Value, 2);
        Assert.False(Blocks(withWall, "time-warp"));
    }

    [Fact]
    public void NeitherRealCaptureCanBeTalkedIntoAVerdictBySupplyingTheRest()
    {
        // Even handed a station, a body and both candidate radii, both captures
        // still refuse: one has no orbit to propagate and the other has no
        // observed event to score against. The missing pieces are in the data,
        // not in the invocation.
        var options = new AnalysisOptions
        {
            BodyRadiusMeters = 600_000.0,
            RotationPeriodSeconds = 21_549.425,
            StationLatitudeDeg = -0.0972,
            StationLongitudeDeg = -74.5577,
            WallClockSeconds = 1_720.0,
        };
        options.Candidates.Add(new OcclusionCandidate("RealAntennas bare radius", 600_000.0));
        options.Candidates.Add(new OcclusionCandidate("stock CommNet atmospheric", 450_000.0));

        Assert.False(CaptureAnalyser.Analyse(RelayToDirect(), options).ReachedAVerdict);
        Assert.False(CaptureAnalyser.Analyse(OrbitOnly(), options).ReachedAVerdict);
    }
}
