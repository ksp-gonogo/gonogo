using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using GonogoRp1Uplink;
using Xunit;

/// <summary>
/// The mapper from captured data to the wire.
///
/// <para>The first group is the one that earns its keep: the payload types are
/// typing and codegen markers, the serializer walks the dicts this file builds,
/// and nothing else connects the two. A key renamed on one side and not the
/// other typechecks, builds, ships, and arrives at a client as an undefined
/// field. So every dict is checked against its declared shape, in both
/// directions.</para>
/// </summary>
public class Rp1ScCaptureTests
{
    [Fact]
    public void Centre_rows_carry_exactly_the_declared_shape() =>
        AssertKeysMatch<Rp1CentreEntry>(Rp1ScCapture.BuildCentres(Populated()));

    [Fact]
    public void Complex_rows_carry_exactly_the_declared_shape() =>
        AssertKeysMatch<Rp1ComplexEntry>(Rp1ScCapture.BuildComplexes(Populated()));

    [Fact]
    public void Build_queue_rows_carry_exactly_the_declared_shape() =>
        AssertKeysMatch<Rp1BuildItemEntry>(Rp1ScCapture.BuildQueue(Populated()));

    [Fact]
    public void Warehouse_rows_carry_exactly_the_declared_shape() =>
        AssertKeysMatch<Rp1WarehouseItemEntry>(Rp1ScCapture.BuildWarehouse(Populated()));

    [Fact]
    public void Pad_rows_carry_exactly_the_declared_shape() =>
        AssertKeysMatch<Rp1PadEntry>(Rp1ScCapture.BuildPads(Populated()));

    [Fact]
    public void Operation_rows_carry_exactly_the_declared_shape() =>
        AssertKeysMatch<Rp1OperationEntry>(Rp1ScCapture.BuildOperations(Populated()));

    [Fact]
    public void Research_rows_carry_exactly_the_declared_shape() =>
        AssertKeysMatch<Rp1ResearchEntry>(Rp1ScCapture.BuildResearch(Populated()));

    [Fact]
    public void Personnel_carries_exactly_the_declared_shape() =>
        AssertKeys<Rp1Personnel>(Rp1ScCapture.BuildPersonnel(Populated())!);

    [Fact]
    public void Rush_terms_carry_exactly_the_declared_shape() =>
        AssertKeys<Rp1RushTerms>(Rp1ScCapture.BuildRushTerms(Populated())!);

    [Fact]
    public void Unreadable_rush_settings_publish_nothing_rather_than_the_shipped_defaults()
    {
        // A client that received 1.5 and 2.0 here would quote a price to an
        // operator whose career may charge another one.
        Assert.Null(Rp1ScCapture.BuildRushTerms(new Rp1ScRaw { Available = true }));
    }

    [Fact]
    public void Confidence_carries_exactly_the_declared_shape() =>
        AssertKeys<Rp1Confidence>(Rp1ScCapture.BuildConfidence(Populated())!);

    [Fact]
    public void An_absent_rate_stays_absent_on_the_wire_rather_than_becoming_zero()
    {
        var raw = new Rp1ScRaw
        {
            BuildQueue = { new Rp1BuildItemRaw { ShipName = "Sputnik", Rate = null, Stalled = false } },
        };

        var row = (Dictionary<string, object?>)Rp1ScCapture.BuildQueue(raw)[0]!;
        Assert.Null(row["rate"]);
        Assert.Null(row["timeLeftSeconds"]);
        Assert.Equal(false, row["stalled"]);
    }

    [Fact]
    public void A_stalled_item_carries_a_zero_rate_and_the_flag_together()
    {
        var raw = new Rp1ScRaw
        {
            BuildQueue = { new Rp1BuildItemRaw { ShipName = "Atlas", Rate = 0.0, Stalled = true } },
        };

        var row = (Dictionary<string, object?>)Rp1ScCapture.BuildQueue(raw)[0]!;
        Assert.Equal(0.0, row["rate"]);
        Assert.Equal(true, row["stalled"]);
    }

    [Fact]
    public void Absent_confidence_and_personnel_publish_nothing_at_all()
    {
        // Not an object of zeroes. A client that receives one cannot tell a
        // career with no confidence left from an install that does not model it.
        var raw = new Rp1ScRaw();
        Assert.Null(Rp1ScCapture.BuildConfidence(raw));
        Assert.Null(Rp1ScCapture.BuildPersonnel(raw));
    }

    [Fact]
    public void An_unavailable_RP1_publishes_empty_lists_rather_than_nothing()
    {
        // Empty is a real answer and reaches the client as one; null would leave
        // the channel unborn and the client waiting.
        var raw = new Rp1ScRaw();
        Assert.Empty(Rp1ScCapture.BuildCentres(raw));
        Assert.Empty(Rp1ScCapture.BuildComplexes(raw));
        Assert.Empty(Rp1ScCapture.BuildQueue(raw));
        Assert.Empty(Rp1ScCapture.BuildWarehouse(raw));
        Assert.Empty(Rp1ScCapture.BuildPads(raw));
        Assert.Empty(Rp1ScCapture.BuildOperations(raw));
        Assert.Empty(Rp1ScCapture.BuildResearch(raw));
    }

    /// <summary>One of everything, so every mapper has a row to build.</summary>
    private static Rp1ScRaw Populated() => new Rp1ScRaw
    {
        Ut = 1000.0,
        Available = true,
        Centres = { new Rp1CentreRaw { KscName = "Cape" } },
        Complexes = { new Rp1ComplexRaw { KscName = "Cape", Name = "Pad A" } },
        BuildQueue = { new Rp1BuildItemRaw { KscName = "Cape", ShipName = "Vanguard" } },
        Warehouse = { new Rp1BuildItemRaw { KscName = "Cape", ShipName = "Ready One" } },
        Pads = { new Rp1PadRaw { KscName = "Cape", Name = "LP-1" } },
        Operations = { new Rp1OperationRaw { KscName = "Cape", Type = "Rollout" } },
        Research = { new Rp1ResearchRaw { TechId = "start" } },
        Personnel = new Rp1PersonnelRaw(),
        RushTerms = new Rp1RushTermsRaw(),
        Confidence = new Rp1ConfidenceRaw(),
    };

    private static void AssertKeysMatch<TPayload>(List<object?> rows)
    {
        var row = Assert.Single(rows.AsEnumerable());
        AssertKeys<TPayload>((Dictionary<string, object?>)row!);
    }

    private static void AssertKeys<TPayload>(Dictionary<string, object?> row)
    {
        var declared = typeof(TPayload)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => CamelCase(p.Name))
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();
        var published = row.Keys.OrderBy(n => n, StringComparer.Ordinal).ToArray();

        Assert.Equal(declared, published);
    }

    /// <summary>The same one-character transform codegen applies to a property name.</summary>
    private static string CamelCase(string name) =>
        string.IsNullOrEmpty(name) ? name : char.ToLowerInvariant(name[0]) + name.Substring(1);
}
