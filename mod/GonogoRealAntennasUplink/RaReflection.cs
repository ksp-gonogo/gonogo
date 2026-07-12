using System;
using System.Linq;
using System.Reflection;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// The arm's-length REFLECTION surface onto RealAntennas (comms-uplink-design.md
    /// §4.2/§4.3). NO compile-time reference to RA's assembly exists anywhere in this
    /// project — every RA member is reached by runtime reflection against the loaded
    /// <c>RealAntennas</c> assembly, so the CC-BY-SA-4.0 ShareAlike boundary is never
    /// crossed (§4.1): we USE the running mod's public API, we don't INCORPORATE its
    /// code.
    ///
    /// <para>Viability (source-verified §4.3): <c>RealAntenna</c>/<c>RealAntennaDigital</c>
    /// and <c>RACommLink</c> are public classes with public properties
    /// (<c>Gain</c>/<c>TxPower</c>/<c>SymbolRate</c>/<c>Frequency</c>;
    /// <c>FwdDataRate</c>/<c>RevDataRate</c>) reachable straightforwardly. Link margin
    /// is NOT stored publicly on the live graph — it is RE-DERIVED by
    /// <see cref="RaLinkBudget"/> from the public antenna props, not reflected.</para>
    ///
    /// <para>Fail-soft throughout: a missing type/member (an RA version whose surface
    /// moved) degrades to <c>null</c>/typed absence rather than throwing — the
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

        /// <summary>Whether RealAntennas' assembly is loaded — the election gate (§2.2/§4.2).</summary>
        public bool IsAvailable => _raAssembly != null;

        /// <summary>
        /// Probe for the loaded RealAntennas assembly. Returns null when RA is not
        /// installed/loaded — the caller then never registers the RA comms provider,
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
        /// (typed absence — never 0).
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
