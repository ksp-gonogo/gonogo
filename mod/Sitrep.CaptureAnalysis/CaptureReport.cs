using System.Collections.Generic;

namespace Sitrep.CaptureAnalysis;

/// <summary>One observed link change set beside what a candidate occluding radius predicts for it.</summary>
public sealed class PredictionComparison
{
    public PredictionComparison(
        OcclusionCandidate candidate,
        DirectLinkEvent observed,
        double? predictedUt,
        double? predictedSeparationMeters)
    {
        Candidate = candidate;
        Observed = observed;
        PredictedUt = predictedUt;
        PredictedSeparationMeters = predictedSeparationMeters;
    }

    public OcclusionCandidate Candidate { get; }

    public DirectLinkEvent Observed { get; }

    /// <summary>Null when the sweep found no crossing of the observed kind anywhere in the search window, which is itself a result.</summary>
    public double? PredictedUt { get; }

    public double? PredictedSeparationMeters { get; }

    public double? DeltaSeconds => PredictedUt.HasValue ? PredictedUt.Value - Observed.Ut : null;

    public double? DeltaSeparationMeters =>
        PredictedSeparationMeters.HasValue && Observed.SeparationMeters.HasValue
            ? PredictedSeparationMeters.Value - Observed.SeparationMeters.Value
            : null;
}

/// <summary>Everything the analysis concluded, and everything it declined to.</summary>
public sealed class CaptureReport
{
    public string CapturePath { get; set; } = "";

    public int TotalLines { get; set; }

    public int UnparseableLines { get; set; }

    /// <summary>Samples that arrived before the game had a clock, excluded from every interval and timeline; see <see cref="CaptureRecord.IsTimestampedSample"/>.</summary>
    public int PreGameSamples { get; set; }

    public Dictionary<string, int> SamplesByTopic { get; } = new();

    public string? VesselName { get; set; }

    public Cadence? Cadence { get; set; }

    /// <summary>UT span from the first sample to the last, whichever topic carried them.</summary>
    public double? UtSpanSeconds { get; set; }

    /// <summary>UT seconds per wall second. Only ever set when the wall duration was supplied.</summary>
    public double? ImpliedWarpFactor { get; set; }

    public CapturedOrbit? Orbit { get; set; }

    public List<PathSegment> PathTimeline { get; } = new();

    public List<DirectLinkEvent> DirectLinkEvents { get; } = new();

    public List<string> HomeEndpoints { get; } = new();

    public List<OcclusionCandidate> Candidates { get; } = new();

    public List<PredictionComparison> Predictions { get; } = new();

    public List<Blocker> Blockers { get; } = new();

    /// <summary>
    /// True when nothing stood in the way of the comparison the tool exists to
    /// make. A caller that wants an exit code has one: a report with blockers is
    /// not a verdict.
    /// </summary>
    public bool ReachedAVerdict => Blockers.Count == 0 && Predictions.Count > 0;
}
