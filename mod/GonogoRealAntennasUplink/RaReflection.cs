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
