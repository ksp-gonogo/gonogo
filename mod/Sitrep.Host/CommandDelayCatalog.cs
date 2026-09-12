using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// Every command id the loaded contract assemblies tag, with the one fact
    /// the dispatcher needs from them: whether the command rides the signal
    /// delay (<see cref="SitrepCommandAttribute.Delayed"/>).
    ///
    /// <para><b>Why the host reads an attribute instead of a manifest.</b> The
    /// SDK codegen turns the very same attribute into
    /// <c>GENERATED_COMMAND_RAIL</c>, which is what a client's delay UX reads,
    /// so a command answers this question once and both halves read that answer.
    /// The manifest used to state it too, and the two drifted: the mod ran 52
    /// commands the instant they arrived while every console drew them a
    /// countdown and an in-flight queue row.
    /// <see cref="CommandDeclaration.Delayed"/> survives only as the fallback for
    /// a command no contract slice tags, which in practice means a test double.</para>
    ///
    /// <para>Scanned the same way <see cref="UplinkDiscovery"/> scans, for the
    /// same reason: an Uplink's commands are tagged in ITS OWN contract slice,
    /// which core cannot name, so the set of assemblies to read is "whatever
    /// references this contract". Per-assembly and per-type failures are logged
    /// and skipped rather than thrown, because a foreign assembly that will not
    /// load must not take command dispatch down with it.</para>
    ///
    /// <para>The scan runs once and caches, and a MISS re-scans once before it
    /// is believed: an Uplink assembly can be loaded after the first command is
    /// dispatched, and a cached "nobody tags this" would then be wrong forever.
    /// A second miss is cached, so an untagged id costs one rescan and not one
    /// per dispatch.</para>
    /// </summary>
    public static class CommandDelayCatalog
    {
        private static readonly object Gate = new object();
        private static Dictionary<string, bool> _delayed;
        private static HashSet<string> _knownMisses = new HashSet<string>(StringComparer.Ordinal);
        private static Action<string> _diagnosticLog;

        /// <summary>The Deck-visible sink, wired the same way <see cref="ChannelEngine.SetDiagnosticLog"/> is.</summary>
        public static void SetDiagnosticLog(Action<string> log)
        {
            lock (Gate)
            {
                _diagnosticLog = log;
            }
        }

        /// <summary>
        /// Forget the scan. Only for tests that load an assembly mid-run and want
        /// the next lookup to see it without waiting for the miss path.
        /// </summary>
        public static void Reset()
        {
            lock (Gate)
            {
                _delayed = null;
                _knownMisses = new HashSet<string>(StringComparer.Ordinal);
            }
        }

        /// <summary>
        /// Whether <paramref name="command"/> is tagged, and if so what it
        /// declared. False return means no loaded contract slice tags this id at
        /// all, which is a real answer and not a failure: the caller decides what
        /// an untagged command reads as.
        /// </summary>
        public static bool TryGetDelayed(string command, out bool delayed)
        {
            delayed = true;
            if (string.IsNullOrEmpty(command))
            {
                return false;
            }

            lock (Gate)
            {
                if (_delayed == null)
                {
                    _delayed = Scan();
                }

                if (_delayed.TryGetValue(command, out delayed))
                {
                    return true;
                }

                if (_knownMisses.Contains(command))
                {
                    return false;
                }

                _delayed = Scan();
                if (_delayed.TryGetValue(command, out delayed))
                {
                    return true;
                }

                _knownMisses.Add(command);
                delayed = true;
                return false;
            }
        }

        private static Dictionary<string, bool> Scan()
        {
            var found = new Dictionary<string, bool>(StringComparer.Ordinal);
            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
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
                    types = ex.Types.Where(t => t != null).Cast<Type>().ToArray();
                }
                catch (Exception ex)
                {
                    Log("failed to scan assembly \"" + assembly.FullName + "\": " + ex);
                    continue;
                }

                foreach (var type in types)
                {
                    try
                    {
                        foreach (var attr in type.GetCustomAttributes<SitrepCommandAttribute>())
                        {
                            // Last writer wins rather than throwing. A duplicate
                            // id across two slices is already a build error in
                            // the codegen that reads these same attributes, and
                            // this path runs inside a running game where the
                            // useful behaviour is to dispatch rather than to
                            // stop.
                            found[attr.CommandId] = attr.Delayed;
                        }
                    }
                    catch (Exception ex)
                    {
                        Log("failed to read [SitrepCommand] on \"" + type.FullName + "\": " + ex);
                    }
                }
            }

            return found;
        }

        /// <summary>
        /// Whether the assembly references THIS core's contract, by simple name.
        /// Same filter and same reasoning as <see cref="UplinkDiscovery"/>'s: a
        /// tag this core can read has to have been compiled against the contract
        /// this core is running.
        /// </summary>
        private static bool ReferencesContract(Assembly assembly)
        {
            var contract = typeof(SitrepCommandAttribute).Assembly;
            if (assembly == contract)
            {
                return true;
            }

            var name = contract.GetName().Name;
            foreach (var referenced in assembly.GetReferencedAssemblies())
            {
                if (string.Equals(referenced.Name, name, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }

        private static void Log(string message)
        {
            Console.Error.WriteLine("[CommandDelayCatalog] " + message);
            var sink = _diagnosticLog;
            if (sink == null)
            {
                return;
            }
            try
            {
                sink("[CommandDelayCatalog] " + message);
            }
            catch
            {
                // A broken log sink must never break dispatch.
            }
        }
    }
}
