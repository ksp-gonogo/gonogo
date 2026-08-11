using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using Gonogo.KerbalismUplink;
using Xunit;

/// <summary>
/// The POCO-to-wire PARITY gate for the Kerbalism value tree: every property
/// declared on a <c>GonogoKerbalismUplink.Contract</c> payload type must be a
/// key that <see cref="KerbalismCapture"/> actually emits. A field declared and
/// never mapped reaches the generated TS SDK (produced from the C# shape) and
/// never reaches the wire, so a widget codes against something permanently
/// undefined with nothing red anywhere.
///
/// <para>These types are hand-flattened to nested
/// <c>Dictionary&lt;string, object?&gt;</c> / <c>List&lt;object&gt;</c> trees
/// before Publish, so no serializer reflects them and nothing else checks the
/// two shapes still agree. <c>KerbalismCaptureTests</c> is the behavioural
/// suite next door: it asserts particular values are mapped correctly, never
/// that the property SET is complete, which is the gap this closes.</para>
///
/// <para>The core-side siblings, covering the same bug class for the other
/// payload families, are
/// <c>Sitrep.Core.Tests.JsonWriterFlattenerParityTests</c> (raw-published
/// POCOs), <c>Sitrep.Host.Tests.ScienceContractShapeTests</c> /
/// <c>BreakingGroundContractShapeTests</c> (the science and deployed families)
/// and <c>VesselViewProviderTests</c> (<c>vessel.*</c>).</para>
///
/// <para><b>Polarity: everything IN by default.</b> The required set is not a
/// list, it is the transitive closure of the five <c>[SitrepTopic]</c> payload
/// roots over their own property types. A new nested shape hung off any payload
/// enrols itself, and must then either be located in a built tree below or be
/// given a documented reason in <see cref="NoWireInstance"/>. That is also why
/// <c>KerbalismResource</c> needs no entry: nothing references it any more, so
/// the closure does not reach it, which is the same fact
/// <c>KerbalismCaptureTests.KerbalismLifeSupport_declares_no_per_resource_property</c>
/// asserts from the other direction.</para>
/// </summary>
public class KerbalismWireParityTests
{
    /// <summary>
    /// Payload types that are reachable from a Topic root but have NO emitted
    /// instance anywhere in the capture, with the reason. Same polarity and same
    /// rule as <c>Sitrep.Core.Tests.WirePayloadCoverageTests</c>'s
    /// <c>FlattenedByProducer</c>: in by default, every exclusion argued for in
    /// one line.
    /// </summary>
    private static readonly Dictionary<string, string> NoWireInstance = new()
    {
        // Declared ahead of its producer, in its own words: "NOT YET POPULATED
        // by GonogoKerbalismUplink's capture pipeline as of this field's
        // addition, reflecting Kerbalism's Greenhouses(Vessel) API into the wire
        // capture is separate mod-side work. This field defines the honest
        // forward-looking wire shape so the widget-side augment can be built and
        // fixture-tested against it now." BuildLifeSupport therefore emits no
        // "greenhouses" key and there is no entry to check the element shape
        // against. Both halves of that go when the capture lands.
        ["KerbalismLifeSupport.Greenhouses"] =
            "declared ahead of its producer (see the field's own doc comment); no Greenhouses(Vessel) capture yet",
        ["KerbalismGreenhouseEntry"] =
            "the element type of KerbalismLifeSupport.Greenhouses, which is not populated yet",
    };

    /// <summary>
    /// One emitted wire value per payload type: where an instance of that type
    /// actually lands in the built trees. This is the one thing reflection
    /// cannot derive, so it is written out, and the completeness assertion below
    /// makes forgetting an entry a failure rather than a silent gap.
    /// </summary>
    private static Dictionary<Type, object?> LocatedInstances()
    {
        var spaceWeather = KerbalismCapture.BuildSpaceWeather(
            Snapshot(),
            new[] { new StarInfoRaw { Star = "Sun", DirX = 1, DirY = 0, DirZ = 0, Distance = 1.3e11 } },
            new[] { new StormEntryRaw { Star = "Sun", StormState = 2, StormTime = 120, StormDuration = 3600, Dist = 1.0e10 } },
            stormEjectionSpeed: 1.2e6);

        var lifeSupport = KerbalismCapture.BuildLifeSupport(
            Snapshot(),
            new List<ProcessRaw>
            {
                new ProcessRaw
                {
                    Resource = "_Scrubber", Title = "Scrubber", Capacity = 1.0,
                    Running = true, Broken = false, FlightId = 42, ValveIndex = 0, EnvModifier = 1.0,
                },
            },
            rates: new Dictionary<string, double> { ["Food"] = -0.001 },
            ruleEnvModifiers: new Dictionary<string, double> { ["radiation"] = 1.0 });

        var crew = KerbalismCapture.BuildCrew(
            new[]
            {
                new KerbalRulesRaw
                {
                    Name = "Valentina Kerman", Trait = "Pilot",
                    Rules = new Dictionary<string, double> { ["radiation"] = 0.0001 },
                },
            },
            new Dictionary<string, RuleConstants>
            {
                ["radiation"] = new RuleConstants { DegenPerSec = 1.0e-05, FatalThreshold = 1.0 },
            });

        var features = KerbalismCapture.BuildFeatures(new Dictionary<string, bool>
        {
            ["Reliability"] = true, ["Radiation"] = true, ["SpaceWeather"] = true,
            ["Shielding"] = true, ["LivingSpace"] = true, ["Comfort"] = true,
            ["Poisoning"] = true, ["Pressure"] = true, ["Habitat"] = true,
            ["Supplies"] = true, ["Science"] = true, ["Automation"] = true, ["Deploy"] = true,
        });

        var profile = KerbalismCapture.BuildProfile(Profile());

        var crewEntry = Entry(crew, 0);
        var contract = typeof(GonogoKerbalismUplink.KerbalismLifeSupport).Assembly;

        Type T(string name) => contract.GetType("GonogoKerbalismUplink." + name, throwOnError: true)!;

        return new Dictionary<Type, object?>
        {
            [T("KerbalismSpaceWeather")] = spaceWeather,
            [T("KerbalismStarInfo")] = Entry(spaceWeather["stars"], 0),
            [T("KerbalismStormEntry")] = Entry(spaceWeather["storms"], 0),

            [T("KerbalismLifeSupport")] = lifeSupport,
            [T("KerbalismHabitat")] = lifeSupport["habitat"],
            [T("KerbalismProcessEntry")] = Entry(lifeSupport["processes"], 0),

            [T("KerbalismCrewEntry")] = crewEntry,
            [T("KerbalismCrewRule")] = Entry(Dict(crewEntry)["rules"], 0),

            [T("KerbalismFeatures")] = features,

            [T("KerbalismProfile")] = profile,
            [T("KerbalismResourceDef")] = Dict(profile["resources"]).Values.First(),
            [T("KerbalismRuleDef")] = Entry(profile["rules"], 0),
            [T("KerbalismProcessDef")] = Entry(profile["processes"], 0),
        };
    }

    [Fact]
    public void EveryPayloadTypeReachableFromATopicRootIsEitherEmittedOrExcused()
    {
        var located = LocatedInstances().Keys.Select(t => t.Name).ToHashSet(StringComparer.Ordinal);

        var unaccounted = RequiredTypes()
            .Select(t => t.Name)
            .Where(name => !located.Contains(name) && !NoWireInstance.ContainsKey(name))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        Assert.True(
            unaccounted.Length == 0,
            "These payload types hang off a kerbalism Topic root but no emitted wire value was located for them, so "
                + "their shape is unchecked: " + string.Join(", ", unaccounted)
                + ". Add them to LocatedInstances (pointing at where KerbalismCapture emits one), or to NoWireInstance "
                + "with a reason if the capture genuinely does not produce one yet.");
    }

    [Fact]
    public void EveryPublicReadablePropertyIsEmittedByTheCapture()
    {
        var failures = new List<string>();

        foreach (var (type, value) in LocatedInstances())
        {
            var emitted = Dict(value);

            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (!property.CanRead || NoWireInstance.ContainsKey(type.Name + "." + property.Name))
                {
                    continue;
                }

                var key = CamelCase(property.Name);
                if (!emitted.ContainsKey(key))
                {
                    failures.Add($"{type.Name}.{property.Name} (no \"{key}\" key)");
                }
            }
        }

        Assert.True(
            failures.Count == 0,
            "These properties are declared on a kerbalism payload type but never emitted by KerbalismCapture, so they "
                + "are in the generated TS SDK and permanently undefined on the wire: " + string.Join(", ", failures)
                + ". Map the field, or (only if it is knowingly declared ahead of its producer) add "
                + "\"Type.Property\" to NoWireInstance with a reason.");
    }

    /// <summary>
    /// Pins the one allowlisted omission to the ONE reason it is allowed for. If
    /// the greenhouse capture lands, <c>greenhouses</c> starts being emitted and
    /// this fails, which is the prompt to delete both entries rather than leave a
    /// stale excuse behind.
    /// </summary>
    [Fact]
    public void TheGreenhousesOmissionIsStillTheOnlyOne()
    {
        Assert.Equal(
            new[] { "KerbalismGreenhouseEntry", "KerbalismLifeSupport.Greenhouses" },
            NoWireInstance.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());

        var lifeSupport = KerbalismCapture.BuildLifeSupport(Snapshot(), new List<ProcessRaw>());
        Assert.False(
            lifeSupport.ContainsKey("greenhouses"),
            "BuildLifeSupport now emits \"greenhouses\": drop both NoWireInstance entries so the element shape gets "
                + "gated like every other nested type.");
    }

    // ----------------------------------------------------------------
    // the required set: the Topic roots, transitively closed
    // ----------------------------------------------------------------

    private static IEnumerable<Type> RequiredTypes()
    {
        var contract = typeof(GonogoKerbalismUplink.KerbalismLifeSupport).Assembly;
        var roots = new[]
        {
            "KerbalismSpaceWeather", "KerbalismLifeSupport", "KerbalismCrewEntry",
            "KerbalismFeatures", "KerbalismProfile",
        }.Select(n => contract.GetType("GonogoKerbalismUplink." + n, throwOnError: true)!);

        var seen = new HashSet<Type>();
        var pending = new Stack<Type>(roots);

        while (pending.Count > 0)
        {
            var type = pending.Pop();
            if (!seen.Add(type))
            {
                continue;
            }

            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                foreach (var candidate in ContractTypesIn(property.PropertyType, contract))
                {
                    pending.Push(candidate);
                }
            }
        }

        return seen;
    }

    /// <summary>
    /// The payload types a property's type carries: itself, or the element /
    /// value types of the list and map shapes these payloads use. Deliberately
    /// only reports types from the kerbalism contract assembly, so
    /// <c>Sitrep.Contract</c> shapes it borrows (Vec3) stay that assembly's
    /// business.
    /// </summary>
    private static IEnumerable<Type> ContractTypesIn(Type type, Assembly contract)
    {
        if (type.IsGenericType)
        {
            foreach (var argument in type.GetGenericArguments())
            {
                foreach (var nested in ContractTypesIn(argument, contract))
                {
                    yield return nested;
                }
            }
            yield break;
        }

        if (type.IsClass && !type.IsAbstract && type.Assembly == contract && type != typeof(string))
        {
            yield return type;
        }
    }

    // ----------------------------------------------------------------
    // fixtures + tree navigation
    // ----------------------------------------------------------------

    /// <summary>
    /// Every field filled, none left at its default: a mapper that emits a key
    /// only for a non-default reading would otherwise pass on an empty snapshot
    /// and hide the omission.
    /// </summary>
    private static KerbalismSnapshot Snapshot() => new KerbalismSnapshot
    {
        Radiation = 3.9e-06, HabitatRadiation = 3.9e-06,
        ShieldingAmount = 1.0, ShieldingCapacity = 3.3,
        Magnetosphere = true, InnerBelt = true, OuterBelt = true,
        StormIncoming = true, StormInProgress = true, Blackout = true, InSunlight = true,
        Pressure = 1.0, Poisoning = 0.1, Shielding = 0.5, LivingSpace = 0.9,
        Comfort = 0.8, Volume = 12.0, Surface = 30.0,
        Rates = new Dictionary<string, double> { ["Food"] = -0.001 },
    };

    private static ProfileRaw Profile() => new ProfileRaw
    {
        Name = "Kerbalism CRP",
        Rules = new List<RuleDefRaw>
        {
            new RuleDefRaw
            {
                Name = "food", Input = "Food", Output = "Waste", Rate = 0.0001, Interval = 0,
                Degeneration = 1.0e-05, FatalThreshold = 1.0, Breakdown = false,
                Modifiers = new List<string> { "_Scrubber" },
            },
        },
        Processes = new List<ProcessDefRaw>
        {
            new ProcessDefRaw
            {
                Name = "scrubber",
                Inputs = new Dictionary<string, double> { ["ElectricCharge"] = 0.025 },
                Outputs = new Dictionary<string, double> { ["Oxygen"] = 0.001 },
                Modifiers = new List<string> { "_Scrubber" },
                DumpValves = new List<string> { "Waste" },
            },
        },
        Supplies = new List<SupplyDefRaw> { new SupplyDefRaw { Resource = "Food", LowThreshold = 0.15 } },
        Resources = new Dictionary<string, ResourceDefRaw>
        {
            ["Food"] = new ResourceDefRaw { Name = "Food", DisplayName = "Food", FlowMode = "ALL_VESSEL", Density = 0.001 },
        },
    };

    private static IDictionary<string, object?> Dict(object? value) =>
        Assert.IsAssignableFrom<IDictionary<string, object?>>(value);

    private static object? Entry(object? list, int index)
    {
        var items = Assert.IsAssignableFrom<IEnumerable>(list).Cast<object?>().ToList();
        Assert.True(items.Count > index, $"the fixture emitted {items.Count} entries, expected more than {index}");
        return items[index];
    }

    private static string CamelCase(string name) =>
        string.IsNullOrEmpty(name)
            ? name
            : char.ToLower(name[0], CultureInfo.InvariantCulture) + name.Substring(1);
}
