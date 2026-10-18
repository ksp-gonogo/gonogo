using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// Assembly-scan discovery for <see cref="ISitrepUplink"/>s: the kOS
    /// <c>AddonManager</c>/<c>AssemblyWalkAttribute</c>/<c>Bootstrapper</c>
    /// precedent, adapted for Uplinks and kept KSP-free (uses only
    /// <see cref="AppDomain"/>/<see cref="Assembly"/> reflection, which is
    /// plain BCL, not a KSP type) so it is headlessly testable here rather
    /// than living in <c>Gonogo.KSP</c>.
    ///
    /// Pre-filter: kOS's own <c>Bootstrapper</c> narrows its scan to
    /// assemblies declaring a <c>KSPAssemblyDependency</c> on kOS's own
    /// KSPAssembly name before ever calling <c>GetTypes()</c> on them, both
    /// cheaper (skips reflecting over every unrelated loaded assembly,
    /// stock KSP DLLs included) and safer (a third-party assembly with no
    /// reason to reference this mod's contract at all is never asked to
    /// resolve its dependency closure). <see cref="Sitrep.Contract"/> is
    /// deliberately KSP-free/multi-targeted (see its own .csproj comment)
    /// and so carries no compile-time reference to KSP's
    /// <c>Assembly-CSharp</c>: the type <c>KSPAssemblyDependency</c> itself
    /// lives in: meaning this scan cannot check for the real attribute
    /// without breaking that separation. The equivalent, KSP-free pre-filter
    /// used here instead: does the candidate assembly reference
    /// <c>Sitrep.Contract</c> at all (<see cref="ReferencesContract"/>)? Any
    /// assembly implementing <see cref="ISitrepUplink"/> necessarily does,
    /// since the interface itself lives there: literally true as of the
    /// Uplink-foundation review's fix round, which moved
    /// <see cref="ISitrepUplink"/>, <see cref="IUplinkHost"/>,
    /// <see cref="UplinkManifest"/>, and the rest of the Uplink-facing shape
    /// out of this assembly and into <c>Sitrep.Contract</c> (see
    /// <see cref="ISitrepUplink"/>'s own doc comment for the full carve-out
    /// rationale). Before that move this justification was aspirational,
    /// the interface actually lived in this assembly (<c>Sitrep.Host</c>),
    /// so the real reason the filter worked was that applying
    /// <c>[SitrepUplink]</c> (which has always lived in
    /// <c>Sitrep.Contract</c>) emits an assembly-ref to it regardless of
    /// where <c>ISitrepUplink</c> itself lived. That fallback reasoning no
    /// longer matters now that the doc comment's original claim is simply
    /// correct, but is recorded here in case the SPI is ever split again.
    /// </summary>
    public static class UplinkDiscovery
    {
        /// <summary>One discovered Uplink instance plus the contract version it declared it was built against; see <see cref="SitrepUplinkAttribute"/>.</summary>
        public readonly struct DiscoveredUplink
        {
            /// <summary>
            /// The constructed Uplink, or null for one whose declared contract version
            /// this core refuses: it is never constructed, so none of its code (static
            /// initialisers, event hooks in its constructor) runs inside a core it was
            /// not built for. The refusal is recorded from <see cref="Id"/> and the
            /// version.
            /// </summary>
            public ISitrepUplink? Uplink { get; }
            public int ContractMajor { get; }
            public int ContractMinor { get; }

            /// <summary>
            /// The id off the <see cref="SitrepUplinkAttribute"/>, which is the only
            /// name for a MAJOR-mismatched Uplink this core can safely read: the
            /// attribute is resolved by this core's <c>Sitrep.Contract</c> during the
            /// scan, where <see cref="ISitrepUplink.Manifest"/> is a shape belonging to
            /// whichever contract the Uplink was built against. Null when the caller
            /// had no attribute to read from, in which case the manifest is the only
            /// source left.
            /// </summary>
            public string? Id { get; }

            /// <summary>
            /// Why part of an assembly that references the contract did not load, set
            /// only on the entry <see cref="Unloadable"/> makes. An Uplink among the
            /// types that failed cannot be named or constructed, so the assembly is
            /// what the roster reports as unavailable.
            /// </summary>
            public string? LoadFailure { get; }

            public DiscoveredUplink(ISitrepUplink? uplink, int contractMajor, int contractMinor, string? id = null)
            {
                Uplink = uplink;
                ContractMajor = contractMajor;
                ContractMinor = contractMinor;
                Id = id;
            }

            private DiscoveredUplink(string id, string loadFailure)
            {
                Id = id;
                LoadFailure = loadFailure;
            }

            /// <summary>An assembly of which only some types loaded, reported under <c>assembly:&lt;name&gt;</c> so it cannot collide with an Uplink's own id.</summary>
            public static DiscoveredUplink Unloadable(string assemblyName, string reason) =>
                new DiscoveredUplink("assembly:" + assemblyName, reason);
        }

        /// <summary>
        /// Scans every currently-loaded assembly for <c>[SitrepUplink]</c>-
        /// attributed, <see cref="ISitrepUplink"/>-implementing concrete
        /// types and instantiates each via its parameterless constructor.
        /// Never throws: any per-assembly or per-type failure (a type that
        /// can't be loaded, has no parameterless constructor, or throws in
        /// its constructor) is logged and skipped: discovery itself must never
        /// be fatal, mirroring the per-Uplink <c>Register()</c> fail-soft
        /// <see cref="ChannelEngine"/> applies one layer up.
        ///
        /// <para><paramref name="diagnosticLog"/> is the Deck-visible sink,
        /// the same arrangement as <see cref="ChannelEngine.SetDiagnosticLog"/>
        /// and wired from <c>GonogoAddon</c> to <c>UnityEngine.Debug</c>.
        /// Without it these three failures went only to
        /// <see cref="Console.Error"/>, which KSP does not capture, so an
        /// Uplink rejected by the scan was indistinguishable from one that
        /// loaded and had not published yet: the author's only signal was a
        /// subscribe that never answered.</para>
        /// </summary>
        public static IReadOnlyList<DiscoveredUplink> Discover(Action<string>? diagnosticLog = null)
        {
            return Discover(AppDomain.CurrentDomain.GetAssemblies(), diagnosticLog);
        }

        /// <summary>Testable overload: scans an explicit assembly set instead of the current AppDomain's loaded set.</summary>
        public static IReadOnlyList<DiscoveredUplink> Discover(
            IEnumerable<Assembly> candidateAssemblies,
            Action<string>? diagnosticLog = null)
        {
            var found = new List<DiscoveredUplink>();

            void Log(string message)
            {
                Console.Error.WriteLine("[UplinkDiscovery] " + message);
                if (diagnosticLog == null)
                {
                    return;
                }
                try
                {
                    diagnosticLog("[UplinkDiscovery] " + message);
                }
                catch
                {
                    // A broken log sink must never break discovery, which is
                    // the one thing here that is not allowed to be fatal.
                }
            }

            void LogFault(
                string message,
                Exception ex,
                [System.Runtime.CompilerServices.CallerFilePath] string file = "",
                [System.Runtime.CompilerServices.CallerLineNumber] int line = 0)
            {
                Log(message + ": " + ExceptionLine.Describe(ex));
                string? trace = ExceptionLine.TraceOnce(ex, file, line);
                if (trace != null)
                {
                    Log(trace);
                }
            }

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
                    // in the assembly): fall back to whatever types DID
                    // load rather than abandoning the whole assembly. The
                    // types that did not load can include the Uplink itself,
                    // which then has no other trace anywhere, so each reason
                    // is logged against the assembly.
                    types = ex.Types.Where(t => t != null).Cast<Type>().ToArray();
                    var reasons = (ex.LoaderExceptions ?? Array.Empty<Exception?>())
                        .Where(reason => reason != null)
                        .Select(reason => reason!.Message)
                        .Distinct(StringComparer.Ordinal)
                        .ToList();
                    var failure = "only " + types.Length + " of its types loaded, so an Uplink among the rest is absent"
                        + (reasons.Count == 0 ? "" : ": " + string.Join("; ", reasons));
                    Log("assembly \"" + assembly.FullName + "\" " + failure);
                    found.Add(DiscoveredUplink.Unloadable(assembly.GetName().Name ?? assembly.FullName ?? "(unnamed)", failure));
                }
                catch (Exception ex)
                {
                    LogFault("failed to scan assembly \"" + assembly.FullName + "\"", ex);
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
                        // resolved): see UplinkDiscovery's class doc
                        // comment's "never fatal" contract. Left outside the
                        // catch, that throw would escape the type loop (and
                        // the assembly loop above it), aborting discovery
                        // for every OTHER candidate too.
                        var attr = type.GetCustomAttribute<SitrepUplinkAttribute>();
                        if (attr == null)
                        {
                            continue;
                        }

                        if (ChannelEngine.ContractRefusalReason(attr.ContractMajor, attr.ContractMinor) != null)
                        {
                            // A refused Uplink is never constructed, so its attribute is the only name it
                            // has; an empty one is recorded under the type so the refusal stays addressable.
                            found.Add(new DiscoveredUplink(
                                null,
                                attr.ContractMajor,
                                attr.ContractMinor,
                                string.IsNullOrEmpty(attr.Id) ? type.FullName : attr.Id));
                            continue;
                        }

                        var ctor = type.GetConstructor(Type.EmptyTypes);
                        if (ctor == null)
                        {
                            Log(
                                "\"" + type.FullName + "\" carries [SitrepUplink] but has no " +
                                "parameterless constructor: skipped (a discoverable Uplink must resolve any " +
                                "real dependency itself, see UplinkDiscovery's doc comment).");
                            continue;
                        }

                        var instance = (ISitrepUplink)ctor.Invoke(null);
                        found.Add(new DiscoveredUplink(instance, attr.ContractMajor, attr.ContractMinor, attr.Id));
                    }
                    catch (Exception ex)
                    {
                        LogFault("failed to inspect/instantiate \"" + type.FullName + "\"", ex);
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
