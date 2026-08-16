using System;
using Xunit;

namespace Sitrep.CaptureAnalysis.Tests;

public class CommandLineTests
{
    private static AnalysisOptions Parse(params string[] args)
    {
        return Program.ParseOptions(args, 0);
    }

    [Fact]
    public void NothingIsSuppliedByDefaultSoEveryGateStartsClosed()
    {
        AnalysisOptions options = Parse();

        Assert.Null(options.WallClockSeconds);
        Assert.Null(options.BodyRadiusMeters);
        Assert.Null(options.RotationPeriodSeconds);
        Assert.Empty(options.Candidates);
        Assert.False(options.HasStation);
    }

    [Fact]
    public void EveryStationFieldIsNeededBeforeAStationExists()
    {
        Assert.False(Parse("--station-lat", "0", "--station-lon", "0").HasStation);
        Assert.False(Parse("--station-lat", "0", "--station-lon", "0", "--body-radius", "600000").HasStation);
        Assert.True(Parse(
            "--station-lat", "-0.0972",
            "--station-lon", "-74.5577",
            "--body-radius", "600000",
            "--rotation-period", "21549.425").HasStation);
    }

    [Fact]
    public void RadiiAreLabelledSoTheReportCanSayWhichAssumptionItUsed()
    {
        AnalysisOptions options = Parse(
            "--radius", "RealAntennas bare=600000",
            "--radius", "stock atm=450000");

        Assert.Equal(2, options.Candidates.Count);
        Assert.Equal("RealAntennas bare", options.Candidates[0].Label);
        Assert.Equal(600_000.0, options.Candidates[0].RadiusMeters);
        Assert.Equal("stock atm", options.Candidates[1].Label);
        Assert.Equal(450_000.0, options.Candidates[1].RadiusMeters);
    }

    [Theory]
    [InlineData("--radius", "600000")]
    [InlineData("--radius", "label=")]
    [InlineData("--radius", "=600000")]
    [InlineData("--radius", "label=notanumber")]
    [InlineData("--body-radius", "wide")]
    public void AMalformedArgumentIsRejectedRatherThanQuietlyIgnored(string flag, string value)
    {
        Assert.Throws<ArgumentException>(() => Parse(flag, value));
    }

    [Fact]
    public void AFlagWithNoValueIsRejected()
    {
        Assert.Throws<ArgumentException>(() => Parse("--wall-seconds"));
    }

    [Fact]
    public void AnUnknownFlagIsRejectedSoATypoNeverSilentlyDropsAnInput()
    {
        // A misspelt --station-lon would otherwise leave the station unset and the
        // run would report "cannot conclude" for a reason that is not true.
        ArgumentException error = Assert.Throws<ArgumentException>(() => Parse("--station-long", "12"));
        Assert.Contains("--station-long", error.Message);
    }
}
