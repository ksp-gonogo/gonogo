using System;
using System.Linq;
using Xunit;

namespace Sitrep.CaptureAnalysis.Tests;

/// <summary>
/// The other half of the contract: given a capture that carries everything, the
/// tool must reach a verdict, and the verdict must identify the radius the
/// capture was actually generated with.
/// </summary>
public class VerdictTests
{
    private static AnalysisOptions FullyEquipped()
    {
        var options = new AnalysisOptions
        {
            BodyRadiusMeters = SyntheticCapture.KerbinRadius,
            RotationPeriodSeconds = SyntheticCapture.KerbinRotationPeriod,
            StationLatitudeDeg = 0.0,
            StationLongitudeDeg = 0.0,
            WallClockSeconds = 4_000.0,
        };
        options.Candidates.Add(new OcclusionCandidate("RealAntennas bare radius", 600_000.0));
        options.Candidates.Add(new OcclusionCandidate("stock CommNet atmospheric", 450_000.0));
        return options;
    }

    [Fact]
    public void ACaptureCarryingEverythingReachesAVerdict()
    {
        Capture capture = SyntheticCapture.Build(truthRadiusMeters: 600_000.0, durationSeconds: 4_000.0);

        CaptureReport report = CaptureAnalyser.Analyse(capture, FullyEquipped());

        Assert.Empty(report.Blockers);
        Assert.NotEmpty(report.Predictions);
        Assert.True(report.ReachedAVerdict);
    }

    [Fact]
    public void TheRadiusTheCaptureWasGeneratedWithIsTheOneThatMatches()
    {
        // A capture whose links really do open and close on a 600 km occluder.
        // The right candidate has to land within the sample interval, and the
        // wrong one has to be visibly, unmistakably out: that gap is the entire
        // basis on which the live question gets settled.
        Capture capture = SyntheticCapture.Build(truthRadiusMeters: 600_000.0, durationSeconds: 4_000.0);

        CaptureReport report = CaptureAnalyser.Analyse(capture, FullyEquipped());

        double worstBare = WorstAbsoluteDelta(report, "RealAntennas bare radius");
        double worstStock = WorstAbsoluteDelta(report, "stock CommNet atmospheric");

        Assert.True(
            worstBare <= SyntheticCapture.CadenceSeconds,
            $"the true radius should predict every event to within one sample interval, worst was {worstBare:F2} s");
        Assert.True(
            worstStock > 60.0,
            $"the wrong radius should be obviously wrong, worst was only {worstStock:F2} s");
    }

    [Fact]
    public void TheOtherRadiusIsTheOneThatMatchesWhenTheCaptureIsGeneratedWithIt()
    {
        // The mirror image, so the test above cannot be passing because 600 km
        // happens to be the answer to everything.
        Capture capture = SyntheticCapture.Build(truthRadiusMeters: 450_000.0, durationSeconds: 4_000.0);

        CaptureReport report = CaptureAnalyser.Analyse(capture, FullyEquipped());

        Assert.True(WorstAbsoluteDelta(report, "stock CommNet atmospheric") <= SyntheticCapture.CadenceSeconds);
        Assert.True(WorstAbsoluteDelta(report, "RealAntennas bare radius") > 60.0);
    }

    [Fact]
    public void PredictedSeparationIsReportedBesideTheObservedOne()
    {
        Capture capture = SyntheticCapture.Build(truthRadiusMeters: 600_000.0, durationSeconds: 4_000.0);

        CaptureReport report = CaptureAnalyser.Analyse(capture, FullyEquipped());

        PredictionComparison match = report.Predictions
            .First(p => p.Candidate.Label == "RealAntennas bare radius" && !p.Observed.Acquired);

        Assert.NotNull(match.Observed.SeparationMeters);
        Assert.NotNull(match.PredictedSeparationMeters);

        // Both endpoints are moving fast at a horizon crossing, so a sample
        // interval of timing error is a few kilometres of range error.
        Assert.True(
            Math.Abs(match.DeltaSeparationMeters!.Value) < 10_000.0,
            $"predicted separation was {match.DeltaSeparationMeters.Value:F0} m from the observed one");
    }

    [Fact]
    public void ACaptureThatDeclaresItsOwnOcclusionModelNeedsNoRadiusArgument()
    {
        // comms.occlusion is the channel that exists so nobody has to supply this
        // by hand. When it is there, both the bare and the resolved radius come
        // off the capture itself.
        Capture capture = SyntheticCapture.Build(600_000.0, 4_000.0, declareOcclusion: true);

        var options = new AnalysisOptions
        {
            BodyRadiusMeters = SyntheticCapture.KerbinRadius,
            RotationPeriodSeconds = SyntheticCapture.KerbinRotationPeriod,
            StationLatitudeDeg = 0.0,
            StationLongitudeDeg = 0.0,
            WallClockSeconds = 4_000.0,
        };

        CaptureReport report = CaptureAnalyser.Analyse(capture, options);

        Assert.Contains(report.Candidates, c => c.Label == "Kerbin bare radius" && c.RadiusMeters == 600_000.0);
        Assert.Contains(report.Candidates, c => c.Label.Contains("realantennas-bare-radius"));
        Assert.True(report.ReachedAVerdict);
    }

    [Fact]
    public void BothTheLossAndTheAcquisitionAreScored()
    {
        Capture capture = SyntheticCapture.Build(600_000.0, 4_000.0);

        CaptureReport report = CaptureAnalyser.Analyse(capture, FullyEquipped());

        Assert.Contains(report.DirectLinkEvents, e => !e.Acquired);
        Assert.Contains(report.DirectLinkEvents, e => e.Acquired);
        Assert.Contains(report.Predictions, p => !p.Observed.Acquired && p.PredictedUt.HasValue);
        Assert.Contains(report.Predictions, p => p.Observed.Acquired && p.PredictedUt.HasValue);
    }

    [Fact]
    public void APlaceholderHomeNodeIsCalledOutRatherThanTreatedAsOneStation()
    {
        // The older telemetry reported every home node as the literal string
        // "home". Several distinct stations collapse into one under that, so a
        // capture carrying it cannot confirm which station a prediction is about.
        var lines = SyntheticCapture.Lines(600_000.0, 4_000.0)
            .Select(line => line.Replace("Kerbal Space Center", "home"))
            .ToList();

        CaptureReport report = CaptureAnalyser.Analyse(CaptureReader.Read("placeholder", lines), FullyEquipped());

        Assert.Equal(new[] { "home" }, report.HomeEndpoints);
        Blocker blocker = Assert.Single(report.Blockers, b => b.Question.Contains("Which ground station"));
        Assert.Contains("literal string", blocker.Reason);
        Assert.False(report.ReachedAVerdict);
    }

    private static double WorstAbsoluteDelta(CaptureReport report, string candidateLabel)
    {
        double worst = 0.0;
        foreach (PredictionComparison prediction in report.Predictions.Where(p => p.Candidate.Label == candidateLabel))
        {
            if (prediction.DeltaSeconds is null)
            {
                return double.PositiveInfinity;
            }

            worst = Math.Max(worst, Math.Abs(prediction.DeltaSeconds.Value));
        }

        return worst;
    }
}
