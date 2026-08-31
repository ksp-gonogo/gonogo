using System;
using System.Collections.Generic;

// The facility-upgrade half of the stand-in graph, in two namespaces because the
// path itself is in two: the construction PROJECT is RP-1's, and the FACILITY it
// is priced from is KSP's own. Every name, accessibility and shape below was
// taken from an ilspycmd disassembly of the SHIPPED RP-1 v4.6.0.0 RP0.dll and of
// the installed Assembly-CSharp, so a rename on either side makes these tests
// wrong in the same direction it makes production wrong.
//
// TWO ACCESSIBILITIES ARE LOAD-BEARING HERE and are not an accident of copying:
//
//   GetTechGate is PRIVATE, exactly as RP-1 declares it, so the production
//   lookup has to ask for a non-public method to find it at all. Declared public
//   here, the test would pass with a public-only lookup and production would
//   refuse every upgrade on the rig.
//
//   UpgradeableObject.upgradeLevels is PROTECTED and UpgradeLevels is the public
//   property over it, exactly as KSP declares them, so a walk that reached the
//   field directly is not silently rewarded.
//
// What this CANNOT do is stated plainly rather than implied: it proves the walk
// reads the members it claims to and takes RP-1's own steps in RP-1's own order,
// and it proves nothing whatever about the VALUES a running RP-1 would hold.
namespace RP0
{
    /// <summary>
    /// RP-1's event bus, cut down to the one event a facility enqueue fires.
    /// </summary>
    /// <remarks>
    /// A static field of KSP's own single-argument <c>EventData</c>, which is
    /// what RP-1 declares and is a different generic arity from the
    /// <c>EventData&lt;T1, T2&gt;</c> the confidence tests use. Both exist here
    /// for that reason: a fixture carrying only the two-argument form would let a
    /// one-argument <c>Fire</c> lookup pass by arity against the wrong shape.
    /// </remarks>
    public static class SCMEvents
    {
        public static EventData<FacilityUpgradeProject> OnFacilityUpgradeQueued =
            new EventData<FacilityUpgradeProject>("OnKctFacilityUpgradeQueued");
    }
}

namespace RP0.Harmony
{
    /// <summary>
    /// The Harmony patch class that owns RP-1's facility tech gate.
    ///
    /// <para>Present for ONE member, and that member is <c>private static</c>
    /// here because it is <c>private static</c> on the shipped assembly. It is
    /// the single non-public thing this Uplink reaches, and the most fragile pin
    /// it has: a patch class is implementation detail rather than API.</para>
    /// </summary>
    public static class PatchKSCFacilityContextMenu
    {
        /// <summary>
        /// The gatings a test arranges, keyed the way RP-1 keys its own dictionary:
        /// the full facility id, then the TARGET level, to the techID required.
        /// </summary>
        public static readonly Dictionary<string, Dictionary<int, string>> Gatings =
            new Dictionary<string, Dictionary<int, string>>();

        /// <summary>Set by a test that needs the gate itself to throw.</summary>
        public static bool ThrowOnLookup;

        /// <summary>
        /// The facilities RP-1 refuses to upgrade as buildings, standing in for
        /// <c>Database.LockedFacilities</c>. On the shipped install these are the
        /// five whose config carries <c>upgrades = 1, 1, 1</c> under RP-1's own
        /// comment "Cosmetic only - level set by code to match other buildings":
        /// VAB, SPH, Launch Pad, Runway and R&amp;D.
        /// </summary>
        public static readonly List<SpaceCenterFacility> LockedFacilities = new List<SpaceCenterFacility>();

        /// <summary>
        /// RP-1's own predicate, and it matches by case-insensitive SUBSTRING of
        /// the id rather than by the enum, which is reproduced here because a
        /// stand-in that matched exactly would let a test pass on a walk that
        /// disagreed with RP-1 about a modded site.
        /// </summary>
        private static bool IsUpgradeable(UpgradeableFacility facility)
        {
            foreach (var locked in LockedFacilities)
            {
                if (facility.id.IndexOf(locked.ToString(), StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return false;
                }
            }
            return true;
        }

        /// <summary>Keeps the compiler from calling the private member above unused.</summary>
        public static bool UpgradeableForTest(UpgradeableFacility facility) => IsUpgradeable(facility);

        /// <summary>
        /// The same lookup shape RP-1's has: a miss at either level answers null,
        /// which means ungated rather than blocked.
        /// </summary>
        private static string? GetTechGate(string facId, int level)
        {
            if (ThrowOnLookup)
            {
                throw new InvalidOperationException("tech gatings unreadable");
            }
            return Gatings.TryGetValue(facId, out var levels) && levels.TryGetValue(level, out var tech)
                ? tech
                : null;
        }

        /// <summary>
        /// Kept so the compiler does not warn the private member above is unused,
        /// and so a test can assert the fixture's own gate agrees with what
        /// production reads through reflection.
        /// </summary>
        public static string? GateForTest(string facId, int level) => GetTechGate(facId, level);

        public static void Reset()
        {
            Gatings.Clear();
            LockedFacilities.Clear();
            ThrowOnLookup = false;
        }
    }
}

/// <summary>
/// KSP's upgradeable base, carrying the level table a facility upgrade is priced
/// and timed from.
/// </summary>
public abstract class UpgradeableObject
{
    /// <summary>One tier's entry in the table; only its cost matters here.</summary>
    public class UpgradeLevel
    {
        public float levelCost;
    }

    public string id = "";

    /// <summary>PROTECTED on the real type; see this file's header.</summary>
    protected UpgradeLevel[] upgradeLevels = new UpgradeLevel[0];

    /// <summary>PROTECTED on the real type, and read through <see cref="FacilityLevel"/>.</summary>
    protected int facilityLevel;

    public UpgradeLevel[] UpgradeLevels
    {
        get => upgradeLevels;
        set => upgradeLevels = value;
    }

    public int FacilityLevel => facilityLevel;

    /// <summary>The TOP tier's own index, not a count: 2 for a three-tier facility.</summary>
    public int MaxLevel => upgradeLevels.Length - 1;

    public void SetLevelForTest(int level) => facilityLevel = level;
}

/// <summary>
/// KSP's facility, whose live instance is the only source of a tier and a price.
/// </summary>
public class UpgradeableFacility : UpgradeableObject
{
    /// <summary>
    /// The next tier's price, which is what <c>ProcessUpgrade</c> puts on the
    /// project. Reproduces the real one's two properties that matter: the
    /// career's funds multiplier is applied, and a facility already at its top
    /// tier is free rather than an index out of range.
    /// </summary>
    public float GetUpgradeCost() =>
        facilityLevel == MaxLevel
            ? 0f
            : upgradeLevels[facilityLevel + 1].levelCost
              * (HighLogic.LoadedSceneIsGame ? HighLogic.CurrentGame.Parameters.Career.FundsLossMultiplier : 1f);
}

/// <summary>
/// KSP's game-state statics, present for the two the cumulative level cost turns
/// on. <c>ProcessUpgrade</c> multiplies that sum by the career's funds multiplier
/// only while a game is loaded, and both halves of that condition are read rather
/// than assumed.
/// </summary>
public static class HighLogic
{
    public static bool LoadedSceneIsGame = true;

    public static Game CurrentGame = new Game();

    public static void Reset()
    {
        LoadedSceneIsGame = true;
        CurrentGame = new Game();
    }
}

public class Game
{
    public GameParameters Parameters = new GameParameters();

    /// <summary>The save's kerbals, which is what an enrolment resolves names against.</summary>
    public KerbalRoster CrewRoster = new KerbalRoster();
}

/// <summary>
/// KSP's roster. Two indexers, as KSP declares them, and that pair is the point:
/// the string one returns NULL for a name it does not hold rather than throwing,
/// and a lookup that matched by arity alone could take the int one and index the
/// roster by a hash.
/// </summary>
public class KerbalRoster
{
    private readonly System.Collections.Generic.List<ProtoCrewMember> _kerbals =
        new System.Collections.Generic.List<ProtoCrewMember>();

    public ProtoCrewMember? this[string name]
    {
        get
        {
            foreach (var kerbal in _kerbals)
            {
                if (kerbal.name == name)
                {
                    return kerbal;
                }
            }
            return null;
        }
    }

    public ProtoCrewMember this[int index] => _kerbals[index];

    public KerbalRoster With(params ProtoCrewMember[] kerbals)
    {
        _kerbals.AddRange(kerbals);
        return this;
    }
}

public class GameParameters
{
    public CareerParams Career = new CareerParams();
}

public class CareerParams
{
    public float FundsLossMultiplier = 1f;
}

/// <summary>
/// KSP's single-argument event, which is the shape RP-1 declares
/// <c>OnFacilityUpgradeQueued</c> at.
/// </summary>
public class EventData<T>
{
    private readonly List<Action<T>> _handlers = new List<Action<T>>();

    public EventData(string name)
    {
        Name = name;
    }

    public string Name { get; }

    /// <summary>Every value this event has carried, so a test can pin that the queue was announced and announced once.</summary>
    public List<T> Fired { get; } = new List<T>();

    public void Add(Action<T> handler) => _handlers.Add(handler);

    public void Remove(Action<T> handler) => _handlers.Remove(handler);

    public void Fire(T value)
    {
        Fired.Add(value);
        foreach (var handler in _handlers.ToArray())
        {
            handler(value);
        }
    }
}
