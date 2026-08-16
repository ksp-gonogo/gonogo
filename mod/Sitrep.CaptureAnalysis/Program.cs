using System;
using System.Globalization;
using System.IO;

namespace Sitrep.CaptureAnalysis;

/// <summary>
/// <c>dotnet run --project mod/Sitrep.CaptureAnalysis -- capture.ndjson [options]</c>
///
/// <para>Exit code 0 when the report reached a verdict, 1 when it could not, 2
/// for a usage or file error. The distinction is the point: a capture that
/// cannot settle the question is not a crash and not a success, and a script
/// looping over captures should be able to tell the three apart.</para>
/// </summary>
public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length == 0 || args[0] == "--help" || args[0] == "-h")
        {
            Console.Error.WriteLine(Usage);
            return 2;
        }

        string path = args[0];
        if (!File.Exists(path))
        {
            Console.Error.WriteLine($"no such capture: {path}");
            return 2;
        }

        AnalysisOptions options;
        try
        {
            options = ParseOptions(args, 1);
        }
        catch (ArgumentException error)
        {
            Console.Error.WriteLine(error.Message);
            Console.Error.WriteLine();
            Console.Error.WriteLine(Usage);
            return 2;
        }

        CaptureReport report = CaptureAnalyser.Analyse(CaptureReader.ReadFile(path), options);
        Console.Write(ReportWriter.Write(report));
        return report.ReachedAVerdict ? 0 : 1;
    }

    public static AnalysisOptions ParseOptions(string[] args, int startIndex)
    {
        var options = new AnalysisOptions();

        for (int i = startIndex; i < args.Length; i++)
        {
            string flag = args[i];
            switch (flag)
            {
                case "--wall-seconds":
                    options.WallClockSeconds = Number(args, ref i, flag);
                    break;
                case "--body-radius":
                    options.BodyRadiusMeters = Number(args, ref i, flag);
                    break;
                case "--rotation-period":
                    options.RotationPeriodSeconds = Number(args, ref i, flag);
                    break;
                case "--station-lat":
                    options.StationLatitudeDeg = Number(args, ref i, flag);
                    break;
                case "--station-lon":
                    options.StationLongitudeDeg = Number(args, ref i, flag);
                    break;
                case "--station-alt":
                    options.StationAltitudeMeters = Number(args, ref i, flag);
                    break;
                case "--step":
                    options.SweepStepSeconds = Number(args, ref i, flag);
                    break;
                case "--radius":
                    options.Candidates.Add(ParseCandidate(Value(args, ref i, flag)));
                    break;
                default:
                    throw new ArgumentException($"unknown option: {flag}");
            }
        }

        return options;
    }

    private static OcclusionCandidate ParseCandidate(string value)
    {
        int separator = value.IndexOf('=');
        if (separator <= 0 || separator == value.Length - 1)
        {
            throw new ArgumentException($"--radius wants <label>=<metres>, got: {value}");
        }

        string label = value.Substring(0, separator);
        string metres = value.Substring(separator + 1);
        if (!double.TryParse(metres, NumberStyles.Float, CultureInfo.InvariantCulture, out double radius))
        {
            throw new ArgumentException($"--radius {label}= wants a number, got: {metres}");
        }

        return new OcclusionCandidate(label, radius);
    }

    private static double Number(string[] args, ref int index, string flag)
    {
        string raw = Value(args, ref index, flag);
        if (!double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out double value))
        {
            throw new ArgumentException($"{flag} wants a number, got: {raw}");
        }

        return value;
    }

    private static string Value(string[] args, ref int index, string flag)
    {
        if (index + 1 >= args.Length)
        {
            throw new ArgumentException($"{flag} needs a value");
        }

        index++;
        return args[index];
    }

    private const string Usage = """
        usage: dotnet run --project mod/Sitrep.CaptureAnalysis -- <capture.ndjson> [options]

        Reports what a live Sitrep capture does and does not establish about which
        occluding radius the comms backend uses.

          --wall-seconds <s>        how long the capture ran by the wall clock, the
                                    only way to recover the time-warp factor
          --radius <label>=<m>      a candidate occluding radius, repeatable; used
                                    when the capture has no comms.occlusion frames
          --body-radius <m>         the parent body's bare mean radius
          --rotation-period <s>     the parent body's sidereal rotation period, read
                                    live (KSP overwrites it for tidally-locked bodies)
          --station-lat <deg>       ground station latitude
          --station-lon <deg>       ground station longitude, INERTIAL, at the
                                    capture's first orbit epoch
          --station-alt <m>         ground station altitude, default 0
          --step <s>                sweep step, default period/720

        Exit code: 0 verdict reached, 1 cannot conclude, 2 usage error.
        """;
}
