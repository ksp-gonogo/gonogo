using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;

// The research half of the stand-in graph: RP-1's research project and preset,
// and the KSP types this Uplink's research command AUTHORS against rather than
// merely reads. Same contract as Rp0Fixture, whose header states it: every name,
// accessibility and shape below was taken from an ilspycmd disassembly of the
// SHIPPED RP-1 v4.6.0.0 RP0.dll and of the installed Assembly-CSharp.dll, so a
// rename on either side makes these tests wrong in the same direction it makes
// production wrong.
//
// WHY THE PERSISTENCE IS REAL HERE AND NOT A SET OF EXPECTED KEYS. The whole
// case for the Load(ConfigNode) route is that its failure mode is a CHECKLIST:
// author every [Persistent] key or persist a default. A stand-in Load that read
// exactly the keys production writes would agree with whatever production wrote
// and prove none of that. So ConfigNode.LoadObjectFromConfig below is
// REIMPLEMENTED over the [Persistent] attribute, and ResearchProject.Load is
// RP-1's own two lines unchanged: a key production forgets leaves the field at
// its default, which is what the shipped game would do with it.
//
// The list is separately held to the SHIPPED assembly in
// Rp1InstalledCompatibilityTests, which reads RP0.ResearchProject's [Persistent]
// fields off the binary rather than trusting this file's copy of them.
namespace RP0
{
    /// <summary>RP-1's era table entry: the years that decide a node's research RATE.</summary>
    public class TechPeriod
    {
        public string id = "";
        public int startYear;
        public int endYear;
    }

    /// <summary>
    /// RP-1's general settings, whose three flags decide whether
    /// <c>Prefix_UnlockTech</c> queues a project at all or lets the stock instant
    /// unlock through.
    /// </summary>
    public class KCT_Preset_General
    {
        public bool Enabled = true;
        public bool BuildTimes = true;
        public bool TechUnlockTimes = true;
    }

    public class KCT_Preset
    {
        public KCT_Preset_General GeneralSettings = new KCT_Preset_General();
    }

    /// <summary>
    /// <c>ActivePreset</c> is a property over a private backing field on the real
    /// type, not a plain field, so the walk has to reach it as one.
    /// </summary>
    public class PresetManager
    {
        public static PresetManager? Instance;

        private KCT_Preset _activePreset = new KCT_Preset();

        public KCT_Preset ActivePreset
        {
            get { return _activePreset; }
            set { _activePreset = value; }
        }

        public static void Reset()
        {
            Instance = new PresetManager();
        }
    }
}

// ── KSP ──────────────────────────────────────────────────────────────────────

/// <summary>
/// KSP's own persistence marker. Global-namespaced because that is where KSP
/// declares it, and named without the <c>Attribute</c> suffix because that is
/// how KSP declares it: the compatibility check looks the type up in RP0.dll's
/// metadata BY NAME, and a stand-in called <c>PersistentAttribute</c> would put
/// this file and the shipped binary a suffix apart.
///
/// <para>Present at all because <c>ConfigNode.LoadObjectFromConfig</c> is driven
/// by it: which fields carry it IS the checklist this route stands on.</para>
/// </summary>
[AttributeUsage(AttributeTargets.Field | AttributeTargets.Property, AllowMultiple = false)]
public sealed class Persistent : Attribute
{
}

/// <summary>
/// KSP's config tree, with the four members RP-1's load path uses and the two a
/// test needs to read one back.
/// </summary>
public class ConfigNode
{
    private readonly List<KeyValuePair<string, string>> _values = new List<KeyValuePair<string, string>>();
    private readonly List<ConfigNode> _nodes = new List<ConfigNode>();

    public ConfigNode()
    {
    }

    public ConfigNode(string name)
    {
        this.name = name;
    }

    public string name { get; } = "";

    public void AddValue(string name, string value) =>
        _values.Add(new KeyValuePair<string, string>(name, value));

    public ConfigNode AddNode(string name)
    {
        var node = new ConfigNode(name);
        _nodes.Add(node);
        return node;
    }

    public bool HasValue(string name) => GetValue(name) != null;

    public string? GetValue(string name)
    {
        foreach (var pair in _values)
        {
            if (pair.Key == name)
            {
                return pair.Value;
            }
        }
        return null;
    }

    public string[] GetValues(string name)
    {
        var hits = new List<string>();
        foreach (var pair in _values)
        {
            if (pair.Key == name)
            {
                hits.Add(pair.Value);
            }
        }
        return hits.ToArray();
    }

    public ConfigNode? GetNode(string name)
    {
        foreach (var node in _nodes)
        {
            if (node.name == name)
            {
                return node;
            }
        }
        return null;
    }

    /// <summary>
    /// Every key this node carries, in the order it was written. Not a KSP
    /// member: the test half, so a check can hold the authored node to the
    /// shipped assembly's own [Persistent] field list.
    /// </summary>
    public IReadOnlyList<KeyValuePair<string, string>> Pairs => _values;

    /// <summary>
    /// KSP's own object loader, driven by <see cref="Persistent"/>: it
    /// writes only the fields the node has a value for and leaves the rest at
    /// whatever the constructor set. That silence is the failure this route has
    /// to be checked against, so it is reproduced rather than short-circuited.
    /// </summary>
    public static bool LoadObjectFromConfig(object obj, ConfigNode node)
    {
        foreach (var field in obj.GetType().GetFields(BindingFlags.Public | BindingFlags.Instance))
        {
            if (field.GetCustomAttribute<Persistent>() == null)
            {
                continue;
            }
            var raw = node.GetValue(field.Name);
            if (raw == null)
            {
                continue;
            }
            field.SetValue(obj, Parse(field.FieldType, raw));
        }
        return true;
    }

    private static object Parse(Type type, string raw)
    {
        if (type == typeof(string))
        {
            return raw;
        }
        if (type == typeof(int))
        {
            return int.Parse(raw, CultureInfo.InvariantCulture);
        }
        if (type == typeof(double))
        {
            return double.Parse(raw, CultureInfo.InvariantCulture);
        }
        if (type == typeof(float))
        {
            return float.Parse(raw, CultureInfo.InvariantCulture);
        }
        if (type == typeof(bool))
        {
            return bool.Parse(raw);
        }
        if (type.IsEnum)
        {
            return Enum.Parse(type, raw);
        }
        throw new NotSupportedException("no stand-in parse for " + type.FullName);
    }
}

/// <summary>KSP's tech node behaviour, present for its state enum alone.</summary>
public class RDTech
{
    public enum State
    {
        Unavailable,
        Available,
    }
}

/// <summary>KSP's part record, present for the one member a purchased part is written out by.</summary>
public class AvailablePart
{
    public string name = "";

    public AvailablePart(string name)
    {
        this.name = name;
    }
}

/// <summary>
/// KSP's per-node player state. The constructor is stock's, key for key: id,
/// state, cost and a repeated part, with a FRESH parts list every time, which is
/// why a project loaded from a node is detached from the live one.
/// </summary>
public class ProtoTechNode
{
    public string techID = "";
    public RDTech.State state;
    public int scienceCost;
    public List<AvailablePart> partsPurchased = new List<AvailablePart>();

    public ProtoTechNode()
    {
    }

    public ProtoTechNode(ConfigNode node)
    {
        if (node.HasValue("id"))
        {
            techID = node.GetValue("id")!;
        }
        if (node.HasValue("state"))
        {
            state = (RDTech.State)Enum.Parse(typeof(RDTech.State), node.GetValue("state")!);
        }
        if (node.HasValue("cost"))
        {
            scienceCost = int.Parse(node.GetValue("cost")!, CultureInfo.InvariantCulture);
        }
        partsPurchased = new List<AvailablePart>();
        foreach (var part in node.GetValues("part"))
        {
            partsPurchased.Add(new AvailablePart(part));
        }
    }
}

/// <summary>
/// KSP's tech tree asset. Its techs carry the CONFIG DEFAULT state, which is the
/// whole reason production sources a node's state from
/// <see cref="ResearchAndDevelopment.GetTechnologyState"/> instead: this
/// fixture's tree deliberately holds a state that disagrees with the live one, so
/// a walk that read the tree's would be caught rather than agreed with.
/// </summary>
public class RDTechTree
{
    public List<ProtoTechNode> Techs = new List<ProtoTechNode>();

    /// <summary>Made to throw, to pin that an unreadable tree refuses rather than queues.</summary>
    public bool ThrowOnGet;

    public ProtoTechNode[] GetTreeTechs()
    {
        if (ThrowOnGet)
        {
            throw new InvalidOperationException("the tech tree is not loaded");
        }
        return Techs.ToArray();
    }
}

public class AssetBase
{
    public static RDTechTree? RnDTechTree { get; set; }
}

/// <summary>
/// KSP's R&amp;D scenario module. <c>AddScience</c> stands in for the method RP-1
/// prefixes with its own body rather than for stock's, because the prefix is
/// what actually runs: it adds the delta and clamps at zero, and performs no
/// affordability test at all.
/// </summary>
public class ResearchAndDevelopment
{
    public static ResearchAndDevelopment? Instance { get; set; }

    public static readonly Dictionary<string, string> Titles = new Dictionary<string, string>();

    /// <summary>Made to throw, to pin what an operator is told when the charge itself fails.</summary>
    public bool ThrowOnAddScience;

    private readonly Dictionary<string, ProtoTechNode> _protoTechNodes = new Dictionary<string, ProtoTechNode>();

    public float science;

    public float Science => science;

    /// <summary>Every charge, in order, so a test can pin that a refusal took nothing.</summary>
    public List<KeyValuePair<float, TransactionReasons>> Charges { get; } =
        new List<KeyValuePair<float, TransactionReasons>>();

    public static void Reset()
    {
        Instance = new ResearchAndDevelopment();
        Titles.Clear();
    }

    public void SetTechState(string techID, ProtoTechNode node) => _protoTechNodes[techID] = node;

    public ProtoTechNode? GetTechState(string techID) =>
        _protoTechNodes.TryGetValue(techID, out var node) ? node : null;

    /// <summary>
    /// Stock's own fallback matters and is reproduced: with no R&amp;D instance the
    /// answer is <c>Available</c>, so a caller that did not check the instance
    /// first would read "already researched" off a sandbox save.
    /// </summary>
    public static RDTech.State GetTechnologyState(string techID)
    {
        if (Instance == null)
        {
            return RDTech.State.Available;
        }
        return Instance._protoTechNodes.TryGetValue(techID, out var node)
            ? node.state
            : RDTech.State.Unavailable;
    }

    /// <summary>The empty string on a miss, as stock answers, and the reason production falls back to the id.</summary>
    public static string GetTechnologyTitle(string techID) =>
        Titles.TryGetValue(techID, out var title) ? title : string.Empty;

    public void AddScience(float value, TransactionReasons reason)
    {
        if (ThrowOnAddScience)
        {
            throw new InvalidOperationException("the science ledger is closed");
        }
        Charges.Add(new KeyValuePair<float, TransactionReasons>(value, reason));
        science += value;
        if (science < 0f)
        {
            science = 0f;
        }
    }
}

/// <summary>KSP's difficulty curves, present for the science ceiling <c>ResearchTech</c> asks about.</summary>
public class GameVariables
{
    public static GameVariables? Instance { get; set; }

    /// <summary>The ceiling this stand-in returns, whatever level it is asked at.</summary>
    public float ScienceCostLimit = float.MaxValue;

    public static void Reset()
    {
        Instance = new GameVariables();
    }

    public virtual float GetScienceCostLimit(float RnDnormLevel) => ScienceCostLimit;
}

/// <summary>
/// KSP's facility-level scenario module. The STRING overload is the one
/// production resolves, because it is the one that needs no
/// <c>SpaceCenterFacility</c> value to be built by reflection first.
/// </summary>
public class ScenarioUpgradeableFacilities
{
    /// <summary>Normalised level, keyed by the facility's enum member NAME.</summary>
    public static readonly Dictionary<string, float> Levels = new Dictionary<string, float>();

    public static void Reset() => Levels.Clear();

    public static float GetFacilityLevel(string facilityId) =>
        Levels.TryGetValue(facilityId, out var level) ? level : 1f;
}
