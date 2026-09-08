using System;
using System.Collections.Generic;
using Gonogo.KerbalismUplink;
using Xunit;

/// <summary>
/// Absence is not zero, on the channels that describe whether a crew can
/// survive.
///
/// <para>Kerbalism is reached by reflection, one API method at a time
/// (<c>KerbalismReflection.Api</c> looks each name up in its own dictionary and
/// swallows the invoke), so ONE reading going unanswered while its neighbours
/// answer is the ordinary failure: a Kerbalism version that renamed or dropped
/// that method. The capture used to substitute, and each substitution was a
/// claim: zero radiation is "clean", zero poisoning is "breathable", zero
/// pressure is "the cabin is at vacuum", and a zero net RATE is read by
/// <see cref="KerbalismDeathClock"/> as a rule in balance, which takes it out of
/// the deadline entirely.</para>
///
/// <para>The wire can say all of this already: every field these map to is
/// declared nullable on the Contract, and <c>KerbalismLifeSupport.Rates</c>
/// declares an absent KEY as its spelling for "no rate reported", distinct from
/// a present zero. The dishonesty was only ever in the capture.</para>
/// </summary>
public class KerbalismAbsenceIsNotZeroTests
{
    /// <summary>A reflection layer that answers for everything, so a test can silence one reading.</summary>
    private static KerbalismSnapshot Snapshot(
        Func<string, double?>? api = null,
        Func<string, bool?>? apiBool = null,
        Func<string, double?>? amount = null,
        Func<string, double?>? capacity = null,
        IEnumerable<string>? rateResources = null,
        Func<string, double?>? rate = null) =>
        KerbalismCapture.BuildSnapshot(
            api ?? (_ => 1.0),
            apiBool ?? (_ => true),
            amount ?? (_ => 2.0),
            capacity ?? (_ => 3.0),
            rateResources ?? new[] { "Food", "Oxygen" },
            rate ?? (_ => -0.5));

    [Theory]
    [InlineData("Radiation", "radiationRadPerSecond")]
    [InlineData("HabitatRadiation", "habitatRadiationRadPerSecond")]
    public void An_unanswered_radiation_read_reaches_the_wire_as_null(string method, string wireKey)
    {
        var snap = Snapshot(api: name => name == method ? (double?)null : 1.0);
        var weather = KerbalismCapture.BuildSpaceWeather(snap);
        Assert.True(weather.ContainsKey(wireKey));
        Assert.Null(weather[wireKey]);
    }

    /// <summary>
    /// The habitat block, which is the one an operator reads to decide whether
    /// the crew is in trouble. A zero here does not read as "unknown" on any of
    /// them: pressure zero is a vented cabin, poisoning zero is clean air, and
    /// living space zero is a crew packed into nothing.
    /// </summary>
    [Theory]
    [InlineData("Pressure", "pressure")]
    [InlineData("Poisoning", "poisoning")]
    [InlineData("Shielding", "shielding")]
    [InlineData("LivingSpace", "livingSpace")]
    [InlineData("Comfort", "comfort")]
    [InlineData("Volume", "volume")]
    [InlineData("Surface", "surface")]
    public void An_unanswered_habitat_read_reaches_the_wire_as_null(string method, string wireKey)
    {
        var snap = Snapshot(api: name => name == method ? (double?)null : 1.0);
        var lifeSupport = KerbalismCapture.BuildLifeSupport(snap, processes: null);
        var habitat = Assert.IsType<Dictionary<string, object?>>(lifeSupport["habitat"]);
        Assert.True(habitat.ContainsKey(wireKey));
        Assert.Null(habitat[wireKey]);
    }

    /// <summary>
    /// The storm flags. False is not "we did not ask": it is the pill that tells
    /// an operator no CME is inbound, and the belt flags beside it are what the
    /// space-weather board colours itself from.
    /// </summary>
    [Theory]
    [InlineData("StormIncoming", "stormIncoming")]
    [InlineData("StormInProgress", "stormInProgress")]
    [InlineData("InnerBelt", "innerBelt")]
    [InlineData("OuterBelt", "outerBelt")]
    [InlineData("Magnetosphere", "magnetosphere")]
    [InlineData("Blackout", "blackout")]
    [InlineData("InSunlight", "inSunlight")]
    public void An_unanswered_flag_reaches_the_wire_as_null(string method, string wireKey)
    {
        var snap = Snapshot(apiBool: name => name == method ? (bool?)null : true);
        var weather = KerbalismCapture.BuildSpaceWeather(snap);
        Assert.True(weather.ContainsKey(wireKey));
        Assert.Null(weather[wireKey]);
    }

    /// <summary>
    /// Shielding is a FRACTION on the client, amount over capacity, so a
    /// substituted capacity is a denominator nobody measured and a substituted
    /// amount reads as an unshielded craft.
    /// </summary>
    [Fact]
    public void An_unanswered_shielding_amount_or_capacity_reaches_the_wire_as_null()
    {
        var noAmount = KerbalismCapture.BuildSpaceWeather(Snapshot(amount: _ => null));
        Assert.Null(noAmount["shieldingAmount"]);
        Assert.Equal(3.0, noAmount["shieldingCapacity"]);

        var noCapacity = KerbalismCapture.BuildSpaceWeather(Snapshot(capacity: _ => null));
        Assert.Equal(2.0, noCapacity["shieldingAmount"]);
        Assert.Null(noCapacity["shieldingCapacity"]);
    }

    /// <summary>
    /// The rate map's absence is the KEY, not a null value:
    /// <c>KerbalismLifeSupport.Rates</c> declares a present zero to be a real,
    /// measured balance and every emission to be the full map, so a key that
    /// disappears is itself a statement.
    /// </summary>
    [Fact]
    public void A_resource_kerbalism_reports_no_rate_for_is_omitted_rather_than_zeroed()
    {
        var snap = Snapshot(
            rateResources: new[] { "Food", "Oxygen" },
            rate: name => name == "Oxygen" ? (double?)null : -0.25);

        Assert.Equal(new[] { "Food" }, new List<string>(snap.Rates.Keys).ToArray());
        Assert.Equal(-0.25, snap.Rates["Food"]);
    }

    /// <summary>
    /// A rule input whose amount could not be read is omitted for the same
    /// reason, and a different one: a zero is not "unknown" to the death clock,
    /// it is an EMPTY TANK.
    /// </summary>
    [Fact]
    public void A_rule_input_whose_amount_could_not_be_read_is_omitted()
    {
        var profile = new ProfileRaw
        {
            Rules =
            {
                new RuleDefRaw { Name = "eating", Input = "Food" },
                new RuleDefRaw { Name = "breathing", Input = "Oxygen" },
            },
        };

        var amounts = KerbalismCapture.RuleInputAmounts(
            profile, name => name == "Oxygen" ? (double?)null : 40.0);

        Assert.True(amounts.ContainsKey("Food"));
        Assert.False(amounts.ContainsKey("Oxygen"));
    }

    // ── What the substitution cost, measured at the consumer ─────────────────
    //
    // KerbalismDeathClock already answers "not derivable" on a missing rate or a
    // missing amount, and both guards were UNREACHABLE from the live capture,
    // because the producer filled every key. These two cases are the reason the
    // guards exist; before this they could only be reached by a hand-built map.

    [Fact]
    public void A_rule_whose_rate_could_not_be_read_makes_the_death_clock_say_it_does_not_know()
    {
        var snap = Snapshot(rateResources: new[] { "Oxygen" }, rate: _ => null);

        Assert.Null(KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(),
            Rules(),
            ruleEnvModifiers: null,
            resourceAmounts: new Dictionary<string, double> { ["Oxygen"] = 40.0 },
            resourceRates: snap.Rates));
    }

    /// <summary>
    /// The claim the old behaviour made, kept beside the fix so the difference
    /// is on the record rather than in a commit message: a substituted zero is
    /// "in balance", and the clock drops the rule out of the deadline. A crew
    /// running out of oxygen then had no deadline at all.
    /// </summary>
    [Fact]
    public void A_substituted_zero_rate_would_have_read_as_a_rule_in_balance()
    {
        Assert.Null(KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(),
            Rules(),
            ruleEnvModifiers: null,
            resourceAmounts: new Dictionary<string, double> { ["Oxygen"] = 40.0 },
            resourceRates: new Dictionary<string, double> { ["Oxygen"] = 0.0 }));

        // ...and the same crew with a rate that WAS read has a deadline, so the
        // two above are not both null for want of anything to compute.
        Assert.NotNull(KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(),
            Rules(),
            ruleEnvModifiers: null,
            resourceAmounts: new Dictionary<string, double> { ["Oxygen"] = 40.0 },
            resourceRates: new Dictionary<string, double> { ["Oxygen"] = -0.5 }));
    }

    [Fact]
    public void A_rule_input_whose_amount_could_not_be_read_makes_the_death_clock_say_it_does_not_know()
    {
        var profile = new ProfileRaw { Rules = { new RuleDefRaw { Name = "breathing", Input = "Oxygen" } } };
        var amounts = KerbalismCapture.RuleInputAmounts(profile, _ => null);

        Assert.Null(KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(),
            Rules(),
            ruleEnvModifiers: null,
            resourceAmounts: amounts,
            resourceRates: new Dictionary<string, double> { ["Oxygen"] = -0.5 }));
    }

    /// <summary>
    /// The star card draws this through <c>&lt;Unit&gt;</c>, which has an
    /// absence placeholder of its own and could never reach it: a substituted
    /// zero read as a craft sitting on the star's surface.
    /// </summary>
    [Fact]
    public void A_star_whose_distance_could_not_be_read_carries_null_to_the_wire()
    {
        var weather = KerbalismCapture.BuildSpaceWeather(
            Snapshot(),
            stars: new[] { new StarInfoRaw { Star = "Kerbol", Distance = null } });

        var stars = Assert.IsType<List<object>>(weather["stars"]);
        var star = Assert.IsType<Dictionary<string, object?>>(Assert.Single(stars));
        Assert.True(star.ContainsKey("distance"));
        Assert.Null(star["distance"]);
    }

    /// <summary>
    /// Zero is a real density (a massless resource has one), so it cannot also
    /// mean "the profile carries no definition for this resource".
    /// </summary>
    [Fact]
    public void A_resource_the_profile_defines_no_density_for_carries_null()
    {
        var profile = new ProfileRaw
        {
            Rules = { new RuleDefRaw { Name = "eating", Input = "Food" } },
        };

        var built = KerbalismCapture.BuildProfile(profile);
        var resources = Assert.IsType<Dictionary<string, object?>>(built["resources"]);
        var food = Assert.IsType<Dictionary<string, object?>>(resources["Food"]);
        Assert.True(food.ContainsKey("density"));
        Assert.Null(food["density"]);
    }

    private static KerbalRulesRaw Kerbal() =>
        new KerbalRulesRaw { Name = "Jebediah Kerman", Rules = { ["breathing"] = 0.0 } };

    private static List<RuleDefRaw> Rules() =>
        new List<RuleDefRaw>
        {
            new RuleDefRaw
            {
                Name = "breathing",
                Input = "Oxygen",
                Degeneration = 0.002,
                FatalThreshold = 1.0,
            },
        };
}
