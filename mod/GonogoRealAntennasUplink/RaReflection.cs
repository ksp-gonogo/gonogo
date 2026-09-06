using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// The arm's-length REFLECTION surface onto RealAntennas (comms-uplink-design.md
    /// §4.2/§4.3). NO compile-time reference to RA's assembly exists anywhere in this
    /// project: every RA member is reached by runtime reflection against the loaded
    /// <c>RealAntennas</c> assembly, so the CC-BY-SA-4.0 ShareAlike boundary is never
    /// crossed (§4.1): we USE the running mod's public API, we don't INCORPORATE its
    /// code.
    ///
    /// <para>Viability (source-verified §4.3): <c>RealAntenna</c>/<c>RealAntennaDigital</c>
    /// and <c>RACommLink</c> are public classes with public properties
    /// (<c>Gain</c>/<c>TxPower</c>/<c>SymbolRate</c>/<c>Frequency</c>;
    /// <c>FwdDataRate</c>/<c>RevDataRate</c>) reachable straightforwardly. Link margin
    /// is NOT stored publicly on the live graph, it is RE-DERIVED by
    /// <see cref="RaLinkBudget"/> from the public antenna props, not reflected.</para>
    ///
    /// <para>Fail-soft throughout: a missing type/member (an RA version whose surface
    /// moved) degrades to <c>null</c>/typed absence rather than throwing, the
    /// degrade path the brief asks for if the reflection surface doesn't hold up.</para>
    /// </summary>
    public sealed class RaReflection
    {
        public const string RaAssemblyName = "RealAntennas";

        private readonly Assembly _raAssembly;

        // RACommLink public data-rate + endpoint-antenna properties.
        private readonly PropertyInfo? _fwdDataRate;
        private readonly PropertyInfo? _revDataRate;
        private readonly PropertyInfo? _fwdAntennaTx;
        private readonly PropertyInfo? _fwdAntennaRx;
        private readonly PropertyInfo? _revAntennaTx;
        private readonly PropertyInfo? _revAntennaRx;

        // Runtime member cache for the property-or-field reads below. RA mixes
        // fields (RFBand, TechLevelInfo, modulator) and properties (RequiredCI,
        // AMWTemp, Encoder), and some reads are nested (RFBand.name), so a single
        // resolve-either-kind helper keyed by (type, name) is simpler than a
        // PropertyInfo per member. Main-thread only (capture-on-main), so a plain
        // Dictionary needs no synchronisation.
        private readonly Dictionary<string, MemberInfo?> _memberCache = new Dictionary<string, MemberInfo?>();

        // RealAntenna public link-budget property inputs (§4.3).
        private readonly PropertyInfo? _gain;
        private readonly PropertyInfo? _txPower;
        private readonly PropertyInfo? _frequency;
        private readonly PropertyInfo? _symbolRate;

        private RaReflection(Assembly raAssembly)
        {
            _raAssembly = raAssembly;
            var raCommLink = SafeGetType("RealAntennas.RACommLink");
            _fwdDataRate = raCommLink?.GetProperty("FwdDataRate", BindingFlags.Public | BindingFlags.Instance);
            _revDataRate = raCommLink?.GetProperty("RevDataRate", BindingFlags.Public | BindingFlags.Instance);
            _fwdAntennaTx = raCommLink?.GetProperty("FwdAntennaTx", BindingFlags.Public | BindingFlags.Instance);
            _fwdAntennaRx = raCommLink?.GetProperty("FwdAntennaRx", BindingFlags.Public | BindingFlags.Instance);
            _revAntennaTx = raCommLink?.GetProperty("RevAntennaTx", BindingFlags.Public | BindingFlags.Instance);
            _revAntennaRx = raCommLink?.GetProperty("RevAntennaRx", BindingFlags.Public | BindingFlags.Instance);

            var realAntenna = SafeGetType("RealAntennas.RealAntenna");
            _gain = realAntenna?.GetProperty("Gain", BindingFlags.Public | BindingFlags.Instance);
            _txPower = realAntenna?.GetProperty("TxPower", BindingFlags.Public | BindingFlags.Instance);
            _frequency = realAntenna?.GetProperty("Frequency", BindingFlags.Public | BindingFlags.Instance);
            _symbolRate = realAntenna?.GetProperty("SymbolRate", BindingFlags.Public | BindingFlags.Instance);
        }

        /// <summary>The forward-link transmit antenna of a RACommLink, or null.</summary>
        public object? ForwardTxAntenna(object commLink) => ReadObject(_fwdAntennaTx, commLink);

        /// <summary>The forward-link receive antenna of a RACommLink, or null.</summary>
        public object? ForwardRxAntenna(object commLink) => ReadObject(_fwdAntennaRx, commLink);

        /// <summary>Antenna gain (dBi), or null.</summary>
        public double? Gain(object antenna) => ReadDouble(_gain, antenna);

        /// <summary>Antenna transmit power (dBm), or null.</summary>
        public double? TxPower(object antenna) => ReadDouble(_txPower, antenna);

        /// <summary>Antenna centre frequency (Hz), or null.</summary>
        public double? Frequency(object antenna) => ReadDouble(_frequency, antenna);

        /// <summary>Antenna symbol rate (Hz), or null.</summary>
        public double? SymbolRate(object antenna) => ReadDouble(_symbolRate, antenna);

        /// <summary>The forward-link reverse transmit antenna of a RACommLink, or null.</summary>
        public object? ReverseTxAntenna(object commLink) => ReadObject(_revAntennaTx, commLink);

        /// <summary>The reverse-link receive antenna of a RACommLink, or null.</summary>
        public object? ReverseRxAntenna(object commLink) => ReadObject(_revAntennaRx, commLink);

        // ── The link-budget inputs RA actually exposes, previously hardcoded ──────
        //
        // The uplink used to hardcode 2.5 dB required Eb/N0 and 200 K receiver
        // noise. RA carries both per antenna, so these replace the constants with
        // the running install's own numbers (fail-soft to the constants when a read
        // returns null, the existing posture).

        /// <summary>
        /// Required Eb/N0 (dB) for the receiving antenna's active encoder:
        /// <c>RealAntenna.RequiredCI</c> (which equals <c>Encoder.RequiredEbN0</c>).
        /// Replaces the hardcoded 2.5 dB. Null when unreadable.
        /// </summary>
        public double? RequiredEbN0Db(object antenna) => ReadDoubleMember(antenna, "RequiredCI");

        /// <summary>
        /// The receiver's antenna microwave (system) noise temperature in kelvin:
        /// <c>RealAntenna.AMWTemp</c>, the per-antenna, tech-level-driven figure
        /// (TL0 ~27000 K, TL9 ~200 K). Replaces the flat hardcoded 200 K. Null when
        /// unreadable.
        /// </summary>
        public double? NoiseTemperatureKelvin(object antenna) => ReadDoubleMember(antenna, "AMWTemp");

        // ── The RA-only per-hop extras, read for the CommsHop extension bag ───────

        /// <summary>RF band name (L/S/X/K): <c>RealAntenna.RFBand.name</c>, or null.</summary>
        public string? BandName(object antenna) => ReadStringMember(ReadMember(antenna, "RFBand"), "name");

        /// <summary>Antenna tech level (0..9): <c>RealAntenna.TechLevelInfo.Level</c>, or null.</summary>
        public int? TechLevel(object antenna) => ReadIntMember(ReadMember(antenna, "TechLevelInfo"), "Level");

        /// <summary>
        /// Negotiated modulation order: <c>RealAntennaDigital.modulator.ModulationBits</c>.
        /// Null on a non-digital antenna (no <c>modulator</c> field) or when unreadable.
        /// </summary>
        public int? ModulationBits(object antenna) => ReadIntMember(ReadMember(antenna, "modulator"), "ModulationBits");

        /// <summary>Active FEC encoder name: <c>RealAntenna.Encoder.name</c>, or null.</summary>
        public string? EncoderName(object antenna) => ReadStringMember(ReadMember(antenna, "Encoder"), "name");

        /// <summary>Encoder coding rate (0..1): <c>RealAntenna.Encoder.CodingRate</c>, or null.</summary>
        public double? CodingRate(object antenna) => ReadDoubleMember(ReadMember(antenna, "Encoder"), "CodingRate");

        /// <summary>Antenna beamwidth (degrees): <c>RealAntenna.Beamwidth</c>, or null.</summary>
        public double? Beamwidth(object antenna) => ReadDoubleMember(antenna, "Beamwidth");

        /// <summary>
        /// Linear transmit EC draw (units/s): <c>RealAntenna.PowerDrawLinear</c>,
        /// the actual electric-charge draw rather than the log-scaled
        /// <c>PowerDraw</c>. Null when unreadable.
        /// </summary>
        public double? PowerDrawLinear(object antenna) => ReadDoubleMember(antenna, "PowerDrawLinear");

        // ── The NODE's own antennas, for a pair that is not currently linked ─────
        //
        // Every accessor above reaches an antenna through a LINK, which answers
        // "what is this hop doing" and cannot answer "how far could these two
        // reach". A reach rule is asked about pairs that are NOT connected (that
        // is the whole point of a prediction), so the antennas have to come off
        // the nodes instead.

        /// <summary>
        /// A node's antennas: <c>RACommNode.RAAntennaList</c>, a public
        /// <c>List&lt;RealAntenna&gt;</c>. Empty rather than null when the handle
        /// is not an RA node, the property has moved, or the list is unset, so a
        /// caller loops over nothing rather than branching on null.
        /// </summary>
        public IReadOnlyList<object> NodeAntennas(object? node)
        {
            var read = ReadMember(node, "RAAntennaList");
            if (read is not System.Collections.IEnumerable list)
            {
                return new object[0];
            }
            var antennas = new List<object>();
            try
            {
                foreach (var antenna in list)
                {
                    if (antenna != null)
                    {
                        antennas.Add(antenna);
                    }
                }
            }
            catch (Exception)
            {
                return new object[0];
            }
            return antennas;
        }

        // ── Antenna TARGETING: the read half ─────────────────────────────────────
        //
        // Every member below is public on RealAntennas' own types, so this stays
        // the same arm's-length reach the rest of the class is: nothing here
        // names an RA type at compile time, and the write half below builds its
        // argument out of a stock KSP ConfigNode.
        //
        // Two of the names read as the opposite of what they mean, so this class
        // renames them at the boundary rather than passing the confusion on.
        // RealAntennas' `CanTarget` is not "is able to be targeted", it is
        // "currently holds a target"; its `IsTracking` is "is a dish AND holds no
        // target". The capability question, "can this thing be aimed at all", is
        // `Shape != Omni`, which is what Steerable answers.

        /// <summary>
        /// The antenna's current target (an <c>AntennaTarget</c> component), or
        /// null when it holds none. Held as a bare <c>object</c>.
        /// </summary>
        public object? Target(object antenna) => ReadMember(antenna, "Target");

        /// <summary>
        /// Whether the antenna can hold a target at all: <c>Shape != Omni</c>,
        /// which RealAntennas derives from gain alone. Null when unreadable.
        /// </summary>
        public bool? Steerable(object antenna)
        {
            var shape = ReadMember(antenna, "Shape");
            if (shape == null)
            {
                return null;
            }
            var name = shape.ToString();
            return name != null && !name.Equals("Omni", StringComparison.Ordinal);
        }

        /// <summary>
        /// Whether the antenna currently holds a target:
        /// <c>RealAntenna.CanTarget</c>, renamed. Null when unreadable.
        /// </summary>
        public bool? Targeted(object antenna) => ReadMember(antenna, "CanTarget") as bool?;

        /// <summary>
        /// The near-field limit a tight beam imposes (metres):
        /// <c>RealAntenna.MinimumDistance</c>. Null when unreadable.
        /// </summary>
        public double? MinimumDistance(object antenna) => ReadDoubleMember(antenna, "MinimumDistance");

        /// <summary>The antenna's name, which is its part's title: <c>RealAntenna.Name</c>.</summary>
        public string? AntennaName(object antenna) => ReadMember(antenna, "Name") as string;

        /// <summary>
        /// The live <c>ModuleRealAntenna</c> behind this antenna, non-null only
        /// while its vessel is LOADED. Held as a bare <c>object</c>.
        /// </summary>
        public object? Parent(object antenna) => ReadMember(antenna, "Parent");

        /// <summary>
        /// The persisted module snapshot behind this antenna, non-null only while
        /// its vessel is UNLOADED. Its presence is the load-state test the
        /// targeting commands guard on.
        /// </summary>
        public object? ParentSnapshot(object antenna) => ReadMember(antenna, "ParentSnapshot");

        /// <summary>
        /// The stored kind of a target: the class RealAntennas built for it,
        /// mapped back to the mode name that produces it (<c>Vessel</c>,
        /// <c>BodyLatLonAlt</c>, <c>AzEl</c>, <c>OrbitRelative</c>). Null for a
        /// null target or a class this does not recognise.
        ///
        /// <para>Derived from the runtime type name because nothing stores the
        /// mode: <c>AntennaTarget</c> has one subclass per kind and the mode enum
        /// is only ever used to CHOOSE one.</para>
        /// </summary>
        public string? TargetKind(object? target)
        {
            var name = target?.GetType().Name;
            return name switch
            {
                "AntennaTargetVessel" => "Vessel",
                "AntennaTargetLatLonAlt" => "BodyLatLonAlt",
                "AntennaTargetAzEl" => "AzEl",
                "AntennaTargetOrbitRelative" => "OrbitRelative",
                _ => null,
            };
        }

        /// <summary>
        /// A target's <c>vesselId</c>: the vessel aimed at for a <c>Vessel</c>
        /// target, and the vessel the angles are measured FROM for the two
        /// attitude kinds.
        /// </summary>
        public string? TargetVesselId(object? target) => ReadMember(target, "vesselId") as string;

        /// <summary>A <c>BodyLatLonAlt</c> target's body name.</summary>
        public string? TargetBodyName(object? target) => ReadMember(target, "bodyName") as string;

        /// <summary>
        /// A <c>BodyLatLonAlt</c> target's aim point as (latitude, longitude,
        /// altitude). RealAntennas stores it as one <c>Vector3</c> whose
        /// components are those three, so it is split here rather than published
        /// as a vector nothing would read as a position.
        /// </summary>
        public (double? Latitude, double? Longitude, double? Altitude) TargetLatLonAlt(object? target)
        {
            var vector = ReadMember(target, "latLonAlt");
            if (vector == null)
            {
                return (null, null, null);
            }
            return (ReadDoubleMember(vector, "x"), ReadDoubleMember(vector, "y"), ReadDoubleMember(vector, "z"));
        }

        /// <summary>An <c>AzEl</c> target's azimuth (degrees).</summary>
        public double? TargetAzimuth(object? target) => ReadDoubleMember(target, "azimuth");

        /// <summary>An <c>AzEl</c> or <c>OrbitRelative</c> target's elevation (degrees).</summary>
        public double? TargetElevation(object? target) => ReadDoubleMember(target, "elevation");

        /// <summary>An <c>OrbitRelative</c> target's deflection from prograde (degrees).</summary>
        public double? TargetForward(object? target) => ReadDoubleMember(target, "forward");

        /// <summary>
        /// The install's target-mode table as mode name to required tech level,
        /// off <c>TargetModeInfo.All</c>. Empty when RealAntennas has not loaded
        /// it yet or the surface has moved, which
        /// <see cref="RaTargetPlan.ModeIsUnlocked"/> reads as "ungated" rather
        /// than "everything forbidden".
        ///
        /// <para>It is config, not code: the table is built from
        /// <c>TargetingMode</c> nodes at scenario start, and Realism Overhaul
        /// moves three of the five levels. Reading it is the only way to gate
        /// honestly on the install actually running.</para>
        /// </summary>
        public IReadOnlyDictionary<string, int> TargetModeTechLevels()
        {
            var levels = new Dictionary<string, int>();
            try
            {
                var type = SafeGetType("RealAntennas.Targeting.TargetModeInfo");
                var all = type?.GetField("All", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
                if (all is not System.Collections.IEnumerable entries)
                {
                    return levels;
                }
                foreach (var entry in entries)
                {
                    // A Dictionary<string, TargetModeInfo> enumerates as
                    // KeyValuePair, whose Value is the info object. Read the name
                    // off the info rather than off the pair's key, so a table
                    // keyed some other way still yields the right mode name.
                    var info = ReadMember(entry, "Value") ?? entry;
                    if (ReadMember(info, "name") is not string name || string.IsNullOrEmpty(name))
                    {
                        continue;
                    }
                    levels[name] = ReadIntMember(info, "techLevel") ?? 0;
                }
            }
            catch (Exception)
            {
                return new Dictionary<string, int>();
            }
            return levels;
        }

        // ── Antenna TARGETING: the write half ────────────────────────────────────

        /// <summary>
        /// <c>AntennaTarget.LoadFromConfig(ConfigNode, RealAntenna)</c>, the only
        /// sanctioned way to build a target. <paramref name="configNode"/> is a
        /// stock KSP <c>ConfigNode</c>, passed as <c>object</c> so this class
        /// keeps no KSP reference; the returned <c>AntennaTarget</c> comes back
        /// as <c>object</c> for the same reason.
        ///
        /// <para>Unity-bound (it creates a <c>GameObject</c> and adds a
        /// component), so the caller must already be on the main thread.</para>
        ///
        /// <para>Null both when the surface has moved and when RealAntennas
        /// itself declines to build one, which it does silently for a node whose
        /// <c>name</c> is not one of the four it knows.</para>
        /// </summary>
        public object? LoadTargetFromConfig(object configNode, object antenna)
        {
            try
            {
                var type = SafeGetType("RealAntennas.Targeting.AntennaTarget");
                var method = type?.GetMethod(
                    "LoadFromConfig", BindingFlags.Public | BindingFlags.Static);
                return method?.Invoke(null, new[] { configNode, antenna });
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Assigns <c>RealAntenna.Target</c>. False when the property could not
        /// be resolved or the assignment threw.
        ///
        /// <para>The parameter is non-nullable and that is the whole point.
        /// Assigning null is the one write on this surface that throws, on any
        /// antenna whose craft is unloaded, and the throw is NOT atomic: the
        /// antenna has already been cleared and its saved <c>TARGET</c> node
        /// already deleted by the time it happens, so a caller that caught it
        /// would report failure having destroyed the aim point.</para>
        ///
        /// <para>Nor is a null target a state to put a vessel dish into.
        /// RealAntennas assigns null in exactly one place, for a ground station;
        /// a vessel dish it only ever moves between targets. An untargeted dish
        /// takes no pointing loss at all, which is why offering it as a command
        /// would be a full-gain dish in every direction at once. Untargeted is
        /// what a dish is before it is initialised, not somewhere to send one
        /// back to.</para>
        /// </summary>
        public bool SetTarget(object antenna, object target)
        {
            try
            {
                var property = antenna.GetType().GetProperty(
                    "Target", BindingFlags.Public | BindingFlags.Instance);
                if (property == null || !property.CanWrite)
                {
                    return false;
                }
                property.SetValue(antenna, target);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// Invokes a public parameterless method by name, for the two the
        /// targeting commands need: <c>RealAntenna.SetDefaultTarget()</c> and
        /// <c>RACommNetNetwork.InvalidateCache()</c>. False when the method could
        /// not be resolved or it threw.
        /// </summary>
        public bool InvokeVoid(object? target, string method)
        {
            if (target == null)
            {
                return false;
            }
            try
            {
                var info = target.GetType().GetMethod(
                    method, BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
                if (info == null)
                {
                    return false;
                }
                info.Invoke(target, null);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// Reads a public member by name off any object, for a caller that holds
        /// an RA handle this class has no named accessor for (the comms network
        /// off <c>CommNetScenario.Instance</c>, a module's <c>part</c>). Same
        /// fail-soft-to-null posture as every accessor above.
        /// </summary>
        public object? ReadPublicMember(object? target, string name) => ReadMember(target, name);

        private static object? ReadObject(PropertyInfo? property, object? target)
        {
            if (property == null || target == null)
            {
                return null;
            }
            try
            {
                return property.GetValue(target);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>Whether RealAntennas' assembly is loaded, the election gate (§2.2/§4.2).</summary>
        public bool IsAvailable => _raAssembly != null;

        /// <summary>
        /// Probe for the loaded RealAntennas assembly. Returns null when RA is not
        /// installed/loaded: the caller then never registers the RA comms provider,
        /// leaving CommNet vanilla to win the election.
        /// </summary>
        public static RaReflection? Probe()
        {
            try
            {
                var asm = AppDomain.CurrentDomain
                    .GetAssemblies()
                    .FirstOrDefault(a => string.Equals(
                        a.GetName().Name, RaAssemblyName, StringComparison.OrdinalIgnoreCase));
                return asm == null ? null : new RaReflection(asm);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Best-effort read of a RACommLink's forward data rate (bits/sec). A stock
        /// <c>CommNet.CommLink</c> that is really an <c>RACommLink</c> at runtime
        /// exposes this; returns null if the property is absent or the read throws
        /// (typed absence: never 0).
        /// </summary>
        public double? ForwardDataRate(object commLink) => ReadDouble(_fwdDataRate, commLink);

        /// <summary>Best-effort read of a RACommLink's reverse data rate (bits/sec).</summary>
        public double? ReverseDataRate(object commLink) => ReadDouble(_revDataRate, commLink);

        private static double? ReadDouble(PropertyInfo? property, object? target)
        {
            if (property == null || target == null)
            {
                return null;
            }
            try
            {
                var value = property.GetValue(target);
                return value switch
                {
                    double d => d,
                    float f => f,
                    _ => (double?)null,
                };
            }
            catch (Exception)
            {
                return null;
            }
        }

        // ── Generic property-or-field reader, fail-soft ──────────────────────────
        //
        // Reflects the runtime type each first read of a (type, name) pair and
        // caches the resolved MemberInfo (or a null miss). Resolves a property OR a
        // field, so the same call site reads RA's mix of the two without the caller
        // caring which a given member is. Every failure degrades to null, never a
        // throw, the same posture as ReadDouble/ReadObject above.

        private object? ReadMember(object? target, string name)
        {
            if (target == null)
            {
                return null;
            }
            try
            {
                var type = target.GetType();
                var key = type.FullName + "|" + name;
                if (!_memberCache.TryGetValue(key, out var member))
                {
                    member =
                        (MemberInfo?)type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance)
                        ?? type.GetField(name, BindingFlags.Public | BindingFlags.Instance);
                    _memberCache[key] = member;
                }
                return member switch
                {
                    PropertyInfo p => p.GetValue(target),
                    FieldInfo f => f.GetValue(target),
                    _ => null,
                };
            }
            catch (Exception)
            {
                return null;
            }
        }

        private double? ReadDoubleMember(object? target, string name) => ToDouble(ReadMember(target, name));

        private int? ReadIntMember(object? target, string name)
        {
            var value = ReadMember(target, name);
            return value switch
            {
                int i => i,
                long l => (int)l,
                short s => s,
                byte b => b,
                _ => (int?)null,
            };
        }

        private string? ReadStringMember(object? target, string name) => ReadMember(target, name) as string;

        private static double? ToDouble(object? value) => value switch
        {
            double d => d,
            float f => f,
            int i => i,
            long l => l,
            _ => (double?)null,
        };

        private Type? SafeGetType(string fullName)
        {
            try
            {
                return _raAssembly.GetType(fullName, throwOnError: false);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
