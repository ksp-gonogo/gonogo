using System.Collections.Generic;
using System.Linq;
using Gonogo.KerbalismUplink;
using Xunit;

/// <summary>
/// Which Kerbalism resources the life-support ledger carries: now every one the
/// LOADED PROFILE mentions, and nothing gonogo chose.
///
/// <para><b>What this file used to be.</b> A pin. <c>kerbalism.lifesupport</c>
/// named its consumables as four fixed properties, food/water/oxygen/
/// electricCharge, against a default profile that runs on twelve, and the four
/// were spelled out three times over: as properties on
/// <c>KerbalismLifeSupport</c>, as literal lookups in
/// <c>KerbalismUplink.CaptureOnMain</c>, and as fields on the widget's own
/// consumable type. Nothing about that set was wrong; what was wrong was that it
/// had never been written down as a choice, so a Kerbalism player wondering where
/// their CO2 reading went had to read three files to find out. This file wrote it
/// down, and listed the eight that were missing, so the omission was on the
/// record. It also carried instructions for carrying one more name by editing
/// four files.</para>
///
/// <para><b>Why those instructions are gone.</b> There is nothing to carry any
/// more. <c>rates</c> is a map keyed by resource name, and the names come from
/// <see cref="KerbalismCapture.ResourceNames"/> walking the loaded profile's own
/// rules, processes and supplies. Install ROKerbalism, or any profile, and the
/// ledger follows it without a line of gonogo changing. The static definitions
/// travel alongside on <c>kerbalism.profile</c>.</para>
///
/// <para><b>What is NOT lost, and never was.</b> Amounts and capacities reach the
/// app for every resource regardless: <c>vessel.resources</c> is a name-keyed map
/// and <c>KspHost.BuildPartResources</c> iterates every <c>PartResource</c> on
/// every part, so a tank of Nitrogen shows up there like any other. What was lost
/// was the RATE, because <c>ResourceAverageRate</c> is Kerbalism's own API, is
/// the one number the generic path cannot derive, and was called for exactly four
/// names. That is the gap this closed.</para>
///
/// <para><b>What this file is now.</b> A regression guard. The tests below fail
/// if a resource name reappears anywhere it can be hardcoded, or if the one
/// enumeration that drives both the profile payload and the rate lookups ever
/// splits into two.</para>
/// </summary>
public class LifeSupportResourceCoverageTests
{
    /// <summary>
    /// A profile fragment standing in for a loaded one. Deliberately mixes life
    /// support with a propellant and a pseudo-resource, because the enumeration
    /// has to handle all three without being told which is which.
    /// </summary>
    private static ProfileRaw Profile() => new()
    {
        Name = "Default",
        Rules =
        {
            new RuleDefRaw { Name = "eating", Input = "Food", Output = "Waste", Rate = 0.1312141885, Interval = 10800.0 },
            new RuleDefRaw { Name = "drinking", Input = "Water", Output = "WasteWater", Rate = 0.03359375, Interval = 5400.0 },
            new RuleDefRaw { Name = "breathing", Input = "Oxygen", Output = "WasteAtmosphere", Rate = 0.00172379825 },
            // An accumulator rule: no resource at either end. Must not
            // contribute an empty name to the enumeration.
            new RuleDefRaw { Name = "stress", Input = "", Output = "", Rate = 0.0 },
        },
        Processes =
        {
            new ProcessDefRaw
            {
                Name = "scrubber",
                Inputs = { ["ElectricCharge"] = 0.025, ["WasteAtmosphere"] = 0.00124579975 },
                Outputs = { ["CarbonDioxide"] = 0.00124579975 },
                Modifiers = { "_Scrubber" },
            },
            new ProcessDefRaw
            {
                Name = "water recycler",
                Inputs = { ["ElectricCharge"] = 0.0446, ["WasteWater"] = 0.00000619 },
                Outputs = { ["Water"] = 0.000005262975, ["Ammonia"] = 0.0000361969 },
                Modifiers = { "_WaterRecycler" },
            },
            new ProcessDefRaw
            {
                // A propellant the profile merely touches. It is enumerated
                // because Kerbalism moves it, not because we judged it to be
                // life support; that judgement is what `isSupply` records.
                Name = "hydrazine production",
                Inputs = { ["Ammonia"] = 4.72, ["Oxidizer"] = 0.00145 },
                Outputs = { ["MonoPropellant"] = 0.00085 },
                Modifiers = { "_HydrazineProduction" },
            },
        },
        Supplies =
        {
            new SupplyDefRaw { Resource = "Food", LowThreshold = 0.15 },
            new SupplyDefRaw { Resource = "Water", LowThreshold = 0.15 },
            new SupplyDefRaw { Resource = "Oxygen", LowThreshold = 0.15 },
        },
    };

    [Fact]
    public void TheLedgerCarriesEveryResourceTheProfileMentions()
    {
        var names = KerbalismCapture.ResourceNames(Profile());

        // Including all eight the old four-property shape dropped. This list is
        // not a decision, it is a consequence of the profile above.
        Assert.Equal(
            new[]
            {
                "Ammonia", "CarbonDioxide", "ElectricCharge", "Food",
                "MonoPropellant", "Oxidizer", "Oxygen", "Waste",
                "WasteAtmosphere", "WasteWater", "Water",
            },
            names);
    }

    [Fact]
    public void PseudoResourcesAndEmptyNamesAreExcluded()
    {
        var names = KerbalismCapture.ResourceNames(Profile());

        // "_Scrubber" and friends gate a process; they are plumbing, and asking
        // Kerbalism for their rate would give a permanently-zero readout that
        // looks exactly like a real measurement.
        Assert.DoesNotContain(names, n => n.StartsWith("_"));
        Assert.DoesNotContain(names, string.IsNullOrEmpty);
    }

    [Fact]
    public void OneEnumerationDrivesBothTheProfilePayloadAndTheRateLookups()
    {
        // If these ever diverge, the hardcoding is back wearing a different hat:
        // the app would be told about resources it never gets a rate for, or get
        // rates for resources it was never told about. Same call, both times.
        var profile = Profile();
        var declared = (Dictionary<string, object?>)KerbalismCapture.BuildProfile(profile)["resources"]!;

        Assert.Equal(
            KerbalismCapture.ResourceNames(profile),
            declared.Keys.OrderBy(k => k, System.StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public void SupplyStatusIsRecordedRatherThanAssumed()
    {
        var declared = (Dictionary<string, object?>)KerbalismCapture.BuildProfile(Profile())["resources"]!;

        // Which resources count as life support is the profile's call, carried
        // as data. It is no longer a set of names in our code, which is what
        // made "where did my CO2 reading go" a three-file question.
        var supplies = declared
            .Where(kv => ((Dictionary<string, object?>)kv.Value!)["isSupply"] as bool? == true)
            .Select(kv => kv.Key)
            .OrderBy(k => k, System.StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(new[] { "Food", "Oxygen", "Water" }, supplies);

        // MonoPropellant is enumerated and gets a rate, but is not life support.
        var mono = (Dictionary<string, object?>)declared["MonoPropellant"]!;
        Assert.Equal(false, mono["isSupply"]);
    }

    [Fact]
    public void ThePayloadNamesNoResourceOfItsOwn()
    {
        // The guard proper. Every key on the life-support payload is structural
        // (habitat, processes, greenhouses) or the rates map itself; none is a
        // resource. A fifth fixed consumable cannot be added without failing here.
        var payload = KerbalismCapture.BuildLifeSupport(
            new KerbalismSnapshot(), new List<ProcessRaw>());

        Assert.Equal(
            new[] { "habitat", "processes", "rates" },
            payload.Keys.OrderBy(k => k, System.StringComparer.Ordinal).ToArray());
    }
}
