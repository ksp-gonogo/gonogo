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
    /// RP-1's event bus, in the events this Uplink's writes fire.
    /// </summary>
    /// <remarks>
    /// <para>Static fields of KSP's own single-argument <c>EventData</c>, which is
    /// what RP-1 declares and is a different generic arity from the
    /// <c>EventData&lt;T1, T2&gt;</c> the confidence tests use. Both exist here
    /// for that reason: a fixture carrying only the two-argument form would let a
    /// one-argument <c>Fire</c> lookup pass by arity against the wrong shape.</para>
    ///
    /// <para>Declared beside the facility fixture because that was the first write
    /// to need it, and kept as ONE class rather than split per concern because
    /// RP-1 declares one: two partial halves would let the two disagree about the
    /// bus's shape, which is the drift a stand-in exists to prevent.</para>
    ///
    /// <para>The two dismantle events start NULL rather than constructed, on
    /// purpose. RP-1 creates its whole bus in its own start-up, so an Uplink acting
    /// before that runs finds null, and both dismantles have to complete through
    /// it. Call <see cref="CreateLifecycleEvents"/> in a test that wants to observe
    /// a firing.</para>
    /// </remarks>
    public static class SCMEvents
    {
        public static EventData<FacilityUpgradeProject> OnFacilityUpgradeQueued =
            new EventData<FacilityUpgradeProject>("OnKctFacilityUpgradeQueued");

        public static EventData<LaunchComplex>? OnLCDismantled;
        public static EventData<LCLaunchPad>? OnPadDismantled;
        public static EventData<LCConstructionProject, LaunchComplex>? OnLCConstructionQueued;
        public static EventData<PadConstructionProject, LCLaunchPad>? OnPadConstructionQueued;

        /// <summary>Constructs the four launch-complex events, as RP-1's own start-up does.</summary>
        public static void CreateLifecycleEvents()
        {
            OnLCDismantled = new EventData<LaunchComplex>("OnKctLCDismantled");
            OnPadDismantled = new EventData<LCLaunchPad>("OnKctPadDismantled");
            OnLCConstructionQueued = new EventData<LCConstructionProject, LaunchComplex>("OnKctLCConstructionQueued");
            OnPadConstructionQueued = new EventData<PadConstructionProject, LCLaunchPad>("OnKctPadConstructionQueued");
        }

        /// <summary>Puts the four back to the unconstructed state a fresh game starts in.</summary>
        public static void ResetLifecycleEvents()
        {
            OnLCDismantled = null;
            OnPadDismantled = null;
            OnLCConstructionQueued = null;
            OnPadConstructionQueued = null;
        }
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

    /// <summary>
    /// Flight, which RP-1's warp controller checks as its own bool before it
    /// bothers comparing scene ordinals.
    /// </summary>
    public static bool LoadedSceneIsFlight;

    /// <summary>
    /// The scene, compared against the SPACECENTER and TRACKSTATION ordinals. An
    /// ENUM here rather than an int, because production reads it through
    /// <c>Convert.ToInt32</c> and a fixture holding a plain int would skip the
    /// conversion the real member forces.
    /// </summary>
    public static GameScenes LoadedScene = GameScenes.SPACECENTER;

    public static void Reset()
    {
        LoadedSceneIsGame = true;
        CurrentGame = new Game();
        LoadedSceneIsFlight = false;
        LoadedScene = GameScenes.SPACECENTER;
    }
}

/// <summary>
/// KSP's scene enum, at the ORDINALS KSP assigns, because RP-1 compares against
/// the numbers rather than the names and so does this Uplink.
/// </summary>
public enum GameScenes
{
    LOADING = 0,
    LOADINGBUFFER = 1,
    MAINMENU = 2,
    SETTINGS = 3,
    CREDITS = 4,
    SPACECENTER = 5,
    EDITOR = 6,
    FLIGHT = 7,
    TRACKSTATION = 8,
    PSYSTEM = 9,
    MISSIONBUILDER = 10,
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

    /// <summary>The custom nodes a save carries, keyed by type as KSP keys them.</summary>
    public readonly System.Collections.Generic.Dictionary<System.Type, object> CustomNodes =
        new System.Collections.Generic.Dictionary<System.Type, object>();

    /// <summary>
    /// KSP's GENERIC accessor, which THROWS when the node is not registered.
    /// </summary>
    /// <remarks>
    /// Present so the overload choice is a real one: production deliberately takes
    /// the non-generic sibling below, both because reflection would need
    /// MakeGenericMethod for this one and because a throw crossing the Uplink
    /// boundary is worse than a refusal. A fixture carrying only the safe overload
    /// would make that decision untestable and let a reader that picked this one
    /// pass.
    /// </remarks>
    public T CustomParams<T>()
        where T : class
    {
        if (!CustomNodes.TryGetValue(typeof(T), out var node))
        {
            throw new System.ArgumentException($"Couldn't find custom parameter {typeof(T).Name}!");
        }
        return (T)node;
    }

    /// <summary>
    /// KSP's NON-GENERIC accessor, which RETURNS rather than throwing when the node
    /// is absent. Arity one, matched on its first parameter's type.
    /// </summary>
    public object? CustomParams(System.Type type)
    {
        if (type == null)
        {
            return null;
        }
        return CustomNodes.TryGetValue(type, out var node) ? node : null;
    }
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

    /// <summary>
    /// Makes <see cref="Fire"/> throw AFTER recording, which is the case RP-1
    /// itself swallows: a subscriber that throws must not make a completed write
    /// report failure.
    /// </summary>
    public bool Throws;

    public void Add(Action<T> handler) => _handlers.Add(handler);

    public void Remove(Action<T> handler) => _handlers.Remove(handler);

    public void Fire(T value)
    {
        Fired.Add(value);
        if (Throws)
        {
            throw new InvalidOperationException("a subscriber threw");
        }
        foreach (var handler in _handlers.ToArray())
        {
            handler(value);
        }
    }
}
