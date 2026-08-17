using System;
using System.Globalization;
using System.Text;

namespace Sitrep.CaptureAnalysis;

/// <summary>
/// Renders a <see cref="CaptureReport"/> as text.
///
/// <para>The CANNOT CONCLUDE section is printed last and unconditionally, even
/// when it is empty, so a reader who scrolls to the bottom always learns whether
/// they are looking at a verdict or at a set of observations that fall short of
/// one. It is not an error channel and it is not a warning: it is the answer to
/// "may I draw a conclusion from this".</para>
/// </summary>
public static class ReportWriter
{
    public static string Write(CaptureReport report)
    {
        var text = new StringBuilder();

        text.AppendLine("CAPTURE");
        text.AppendLine($"  file           {report.CapturePath}");
        text.AppendLine($"  lines          {report.TotalLines}"
            + (report.UnparseableLines > 0 ? $" ({report.UnparseableLines} unparseable)" : ""));
        if (report.VesselName is not null)
        {
            text.AppendLine($"  vessel         {report.VesselName}");
        }

        if (report.PreGameSamples > 0)
        {
            text.AppendLine($"  pre-game       {report.PreGameSamples} samples stamped UT 0, excluded from every interval below");
        }

        foreach (var pair in report.SamplesByTopic)
        {
            text.AppendLine(pair.Value == 0
                ? $"  {pair.Key,-22} subscribed, no sample ever delivered"
                : $"  {pair.Key,-22} {pair.Value} samples");
        }

        text.AppendLine();
        text.AppendLine("CADENCE");
        if (report.Cadence is Cadence cadence)
        {
            text.AppendLine($"  measured from  {cadence.Source} ({cadence.IntervalCount} intervals)");
            text.AppendLine($"  median         {Seconds(cadence.MedianSeconds)} UT per sample");
            text.AppendLine($"  range          {Seconds(cadence.MinSeconds)} to {Seconds(cadence.MaxSeconds)} UT");
        }
        else
        {
            text.AppendLine("  not measurable");
        }

        if (report.UtSpanSeconds is double span)
        {
            text.AppendLine($"  UT span        {Seconds(span)}");
        }

        text.AppendLine(report.ImpliedWarpFactor is double warp
            ? $"  implied warp   {warp.ToString("F2", CultureInfo.InvariantCulture)}x UT per wall second"
            : "  implied warp   not derivable from this capture, see CANNOT CONCLUDE");

        text.AppendLine();
        text.AppendLine("ORBIT");
        if (report.Orbit is CapturedOrbit orbit)
        {
            text.AppendLine($"  parent         {orbit.ReferenceBodyName ?? "?"} (index {orbit.ReferenceBodyIndex})");
            text.AppendLine($"  sma            {Metres(orbit.Elements.Sma)}");
            text.AppendLine($"  ecc            {orbit.Elements.Ecc.ToString("G6", CultureInfo.InvariantCulture)}");
            text.AppendLine($"  inc            {Degrees(orbit.Elements.Inc)}");
            text.AppendLine($"  lan / argPe    {Degrees(orbit.Elements.Lan)} / {Degrees(orbit.Elements.ArgPe)}");
            text.AppendLine($"  mu             {orbit.Elements.Mu.ToString("G6", CultureInfo.InvariantCulture)}");
            text.AppendLine(orbit.PeriodSeconds == null
                ? "  period         none (the propagator reports no repeating cycle)"
                : $"  period         {Seconds(orbit.PeriodSeconds.Value)} (via the propagation provider)");
            text.AppendLine(orbit.RadiusExtremes == null
                ? "  radius range   none (the propagator reports no bound on this trajectory)"
                : $"  radius range   {Metres(orbit.RadiusExtremes.Value.ClosestMeters)}"
                    + $" to {Metres(orbit.RadiusExtremes.Value.FurthestMeters)} (via the propagation provider)");
            text.AppendLine($"  epoch span     {Seconds(orbit.LastEpochUt - orbit.FirstEpochUt)} of elements");
        }
        else
        {
            text.AppendLine("  absent, see CANNOT CONCLUDE");
        }

        text.AppendLine();
        text.AppendLine("PATH TIMELINE");
        if (report.PathTimeline.Count == 0)
        {
            text.AppendLine("  no comms.path samples");
        }
        else
        {
            foreach (PathSegment segment in report.PathTimeline)
            {
                text.AppendLine(
                    $"  UT {segment.StartUt.ToString("F1", CultureInfo.InvariantCulture)}"
                    + $" for {Seconds(segment.DurationSeconds)}"
                    + $" ({segment.SampleCount} samples): {segment.State.Describe()}");
            }
        }

        text.AppendLine();
        text.AppendLine("DIRECT-LINK EVENTS");
        if (report.DirectLinkEvents.Count == 0)
        {
            text.AppendLine("  none observed");
        }
        else
        {
            foreach (DirectLinkEvent linkEvent in report.DirectLinkEvents)
            {
                text.AppendLine(
                    $"  UT {linkEvent.Ut.ToString("F1", CultureInfo.InvariantCulture)}"
                    + $"  {(linkEvent.Acquired ? "ACQUIRED" : "LOST    ")}"
                    + $"  {linkEvent.HomeEndpoint ?? "(unnamed)"}"
                    + $"  separation {(linkEvent.SeparationMeters is double d ? Metres(d) : "unknown")}"
                    + $"  (from {linkEvent.PreviousState})");
            }
        }

        text.AppendLine();
        text.AppendLine("PREDICTION vs OBSERVATION");
        if (report.Predictions.Count == 0)
        {
            text.AppendLine("  not attempted, see CANNOT CONCLUDE");
        }
        else
        {
            foreach (PredictionComparison prediction in report.Predictions)
            {
                text.AppendLine(
                    $"  {prediction.Candidate.Label} ({Metres(prediction.Candidate.RadiusMeters)})"
                    + $" vs {(prediction.Observed.Acquired ? "acquisition" : "loss")}"
                    + $" at UT {prediction.Observed.Ut.ToString("F1", CultureInfo.InvariantCulture)}");

                if (prediction.PredictedUt is null)
                {
                    text.AppendLine("      no crossing of that kind anywhere within an orbit either side");
                    continue;
                }

                text.AppendLine(
                    $"      predicted UT {prediction.PredictedUt.Value.ToString("F1", CultureInfo.InvariantCulture)}"
                    + $"  delta {Signed(prediction.DeltaSeconds!.Value)} s");
                text.AppendLine(
                    $"      predicted separation {Metres(prediction.PredictedSeparationMeters!.Value)}"
                    + (prediction.DeltaSeparationMeters is double ds ? $"  delta {Signed(ds / 1000.0)} km" : "  (observed separation unknown)"));
            }
        }

        text.AppendLine();
        text.AppendLine("CANNOT CONCLUDE");
        if (report.Blockers.Count == 0)
        {
            text.AppendLine("  nothing: every question above was answered from the capture.");
        }
        else
        {
            foreach (Blocker blocker in report.Blockers)
            {
                text.AppendLine($"  {blocker.Question}");
                text.AppendLine($"      because  {blocker.Reason}");
                text.AppendLine($"      fix      {blocker.Remedy}");
            }
        }

        text.AppendLine();
        text.AppendLine(report.ReachedAVerdict
            ? "VERDICT REACHED: the comparison above rests on nothing this capture did not carry."
            : "NO VERDICT: the capture does not support a conclusion about the occluding radius.");

        return text.ToString();
    }

    private static string Seconds(double value)
    {
        return $"{value.ToString("F3", CultureInfo.InvariantCulture)} s";
    }

    private static string Metres(double value)
    {
        return Math.Abs(value) >= 1000.0
            ? $"{(value / 1000.0).ToString("F3", CultureInfo.InvariantCulture)} km"
            : $"{value.ToString("F1", CultureInfo.InvariantCulture)} m";
    }

    private static string Degrees(double radians)
    {
        return $"{(radians * 180.0 / Math.PI).ToString("F4", CultureInfo.InvariantCulture)} deg";
    }

    private static string Signed(double value)
    {
        return (value >= 0.0 ? "+" : "") + value.ToString("F2", CultureInfo.InvariantCulture);
    }
}
