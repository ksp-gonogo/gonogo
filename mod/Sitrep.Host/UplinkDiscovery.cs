using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// Assembly-scan discovery for <see cref="ISitrepUplink"/>s — the kOS
    /// <c>AddonManager</c>/<c>AssemblyWalkAttribute</c>/<c>Bootstrapper</c>
    /// precedent (<c>local_docs/reference/kos/src/kOS/AddOns/AddonManager.cs</c>
    /// et al.), adapted for Uplinks and kept KSP-free (uses only
    /// <see cref="AppDomain"/>/<see cref="Assembly"/> reflection, which is
    /// plain BCL, not a KSP type) so it is headlessly testable here rather
    /// than living in <c>Gonogo.KSP</c>.
    ///
    /// Pre-filter: kOS's own <c>Bootstrapper</c> narrows its scan to
    /// assemblies declaring a <c>KSPAssemblyDependency</c> on kOS's own
    /// KSPAssembly name before ever calling <c>GetTypes()</c> on them — both
    /// cheaper (skips reflecting over every unrelated loaded assembly,
    /// stock KSP DLLs included) and safer (a third-party assembly with no
    /// reason to reference this mod's contract at all is never asked to
    /// resolve its dependency closure). <see cref="Sitrep.Contract"/> is
    /// deliberately KSP-free/multi-targeted (see its own .csproj comment)
    /// and so carries no compile-time reference to KSP's
    /// <c>Assembly-CSharp</c> — the type <c>KSPAssemblyDependency</c> itself
    /// lives in — meaning this scan cannot check for the REAL attribute
    /// without breaking that separation. The equivalent, KSP-free pre-filter
    /// used here instead: does the candidate assembly reference
    /// <c>Sitrep.Contract</c> at all (<see cref="ReferencesContract"/>)? Any
    /// assembly implementing <see cref="ISitrepUplink"/> necessarily does,
    /// since the interface itself lives there — literally true as of the
    /// Uplink-foundation review's fix round, which moved
    /// <see cref="ISitrepUplink"/>, <see cref="IUplinkHost"/>,
    /// <see cref="UplinkManifest"/>, and the rest of the Uplink-facing shape
    /// OUT of this assembly and into <c>Sitrep.Contract</c> (see
    /// <see cref="ISitrepUplink"/>'s own doc comment for the full carve-out
    /// rationale). Before that move this justification was aspirational —
    /// the interface actually lived in THIS assembly (<c>Sitrep.Host</c>),
    /// so the real reason the filter worked was that applying
    /// <c>[SitrepUplink]</c> (which HAS always lived in
    /// <c>Sitrep.Contract</c>) emits an assembly-ref to it regardless of
    /// where <c>ISitrepUplink</c> itself lived. That fallback reasoning no
    /// longer matters now that the doc comment's original claim is simply
    /// correct, but is recorded here in case the SPI is ever split again.
    /// </summary>
    public static class UplinkDiscovery
    {
        /// <summary>One discovered Uplink instance plus the contract version it declared it was built against — see <see cref="SitrepUplinkAttribute"/>.</summary>
        public readonly struct DiscoveredUplink
        {
            public ISitrepUplink Uplink { get; }
            public int ContractMajor { get; }
            public int ContractMinor { get; }

            public DiscoveredUplink(ISitrepUplink uplink, int contractMajor, int contractMinor)
            {
                Uplink = uplink;
                ContractMajor = contractMajor;
                ContractMinor = contractMinor;
            }
        }

        /// <summary>
        /// Scans every currently-loaded assembly for <c>[SitrepUplink]</c>-
        /// attributed, <see cref="ISitrepUplink"/>-implementing concrete
        /// types and instantiates each via its parameterless constructor.
        /// Never throws: any per-assembly or per-type failure (a type that
        /// can't be loaded, has no parameterless constructor, or throws in
        /// its constructor) is logged to <see cref="Console.Error"/> and
        /// skipped — discovery itself must never be fatal, mirroring the
        /// per-Uplink <c>Register()</c> fail-soft <see cref="ChannelEngine"/>
        /// applies one layer up.
        /// </summary>
        public static IReadOnlyList<DiscoveredUplink> Discover()
        {
            return Discover(AppDomain.CurrentDomain.GetAssemblies());
        }

        /// <summary>Testable overload — scans an explicit assembly set instead of the current AppDomain's loaded set.</summary>
        public static IReadOnlyList<DiscoveredUplink> Discover(IEnumerable<Assembly> candidateAssemblies)
        {
            var found = new List<DiscoveredUplink>();

            foreach (var assembly in candidateAssemblies)
            {
                Type[] types;
                try
                {
                    if (!ReferencesContract(assembly))
                    {
                        continue;
                    }
                    types = assembly.GetTypes();
                }
                catch (ReflectionTypeLoadException ex)
                {
                    // Partial-load failure (a missing dependency in one type
                    // in the assembly) — fall back to whatever types DID
                    // load rather than abandoning the whole assembly.
                    types = ex.Types.Where(t => t != null).Cast<Type>().ToArray();
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("[UplinkDiscovery] failed to scan assembly \"" + assembly.FullName + "\": " + ex);
                    continue;
                }

                foreach (var type in types)
                {
                    if (type.IsAbstract || type.IsInterface || !typeof(ISitrepUplink).IsAssignableFrom(type))
                    {
                        continue;
                    }

                    try
                    {
                        // GetCustomAttribute deliberately lives INSIDE this
                        // try/catch, not just the ctor-invoke below: it can
                        // itself throw (e.g. a type carrying some OTHER
                        // attribute whose declaring assembly can't be
                        // resolved) — see UplinkDiscovery's class doc
                        // comment's "never fatal" contract. Left outside the
                        // catch, that throw would escape the type loop (and
                        // the assembly loop above it), aborting discovery
                        // for every OTHER candidate too.
                        var attr = type.GetCustomAttribute<SitrepUplinkAttribute>();
                        if (attr == null)
                        {
                            continue;
                        }

                        var ctor = type.GetConstructor(Type.EmptyTypes);
                        if (ctor == null)
                        {
                            Console.Error.WriteLine(
                                "[UplinkDiscovery] \"" + type.FullName + "\" carries [SitrepUplink] but has no " +
                                "parameterless constructor — skipped (a discoverable Uplink must resolve any " +
                                "real dependency itself, see UplinkDiscovery's doc comment).");
                            continue;
                        }

                        var instance = (ISitrepUplink)ctor.Invoke(null);
                        found.Add(new DiscoveredUplink(instance, attr.ContractMajor, attr.ContractMinor));
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine("[UplinkDiscovery] failed to inspect/instantiate \"" + type.FullName + "\": " + ex);
                    }
                }
            }

            return found;
        }

        private static bool ReferencesContract(Assembly assembly)
        {
            const string contractAssemblyName = "Sitrep.Contract";
            if (string.Equals(assembly.GetName().Name, contractAssemblyName, StringComparison.Ordinal))
            {
                return true;
            }

            try
            {
                return assembly.GetReferencedAssemblies()
                    .Any(reference => string.Equals(reference.Name, contractAssemblyName, StringComparison.Ordinal));
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}
