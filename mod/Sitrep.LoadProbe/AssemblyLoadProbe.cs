using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;

namespace Sitrep.LoadProbe
{
    /// <summary>
    /// The outcome of loading one plugin assembly and asking it for every type.
    /// <see cref="Failures"/> is empty exactly when <see cref="Loaded"/> is true.
    /// </summary>
    public sealed record ProbeResult(string Path, bool Loaded, int TypeCount, IReadOnlyList<string> Failures);

    /// <summary>
    /// Loads a KSP plugin assembly outside the game and calls <c>GetTypes()</c> on
    /// it, which is the call that fails when the plugin was built against a
    /// different Sitrep.Contract than the one installed beside it: a type that
    /// overrides an abstract member the installed contract no longer declares
    /// throws "Method ... does not have an implementation". KSP itself swallows
    /// that at load, and the first thing to notice is another mod's unguarded
    /// <c>GetTypes()</c> throwing, which can fail every save.
    /// </summary>
    public static class AssemblyLoadProbe
    {
        /// <summary>
        /// Probes <paramref name="dllPath"/>, resolving each dependency by file
        /// name from <paramref name="resolveDirs"/> in order (searched
        /// recursively), so a staged folder listed first shadows the install it
        /// is about to replace. Framework assemblies come from the running
        /// runtime before any directory is consulted.
        /// </summary>
        public static ProbeResult Probe(string dllPath, IReadOnlyList<string> resolveDirs)
        {
            var index = BuildIndex(resolveDirs);
            return Probe(dllPath, index);
        }

        /// <summary>
        /// Probes several assemblies against one directory index, each in its
        /// own load context so one plugin's dependencies never satisfy another's.
        /// </summary>
        public static IReadOnlyList<ProbeResult> ProbeAll(IEnumerable<string> dllPaths, IReadOnlyList<string> resolveDirs)
        {
            var index = BuildIndex(resolveDirs);
            return dllPaths.Select(p => Probe(p, index)).ToList();
        }

        private static ProbeResult Probe(string dllPath, IReadOnlyDictionary<string, string> index)
        {
            var fullPath = System.IO.Path.GetFullPath(dllPath);
            var context = new AssemblyLoadContext("probe:" + fullPath, isCollectible: true);
            context.Resolving += (ctx, name) =>
                name.Name != null && index.TryGetValue(name.Name, out var found)
                    ? ctx.LoadFromAssemblyPath(found)
                    : null;
            try
            {
                var assembly = context.LoadFromAssemblyPath(fullPath);
                var types = assembly.GetTypes();
                return new ProbeResult(fullPath, true, types.Length, Array.Empty<string>());
            }
            catch (ReflectionTypeLoadException e)
            {
                var failed = e.Types.Count(t => t == null);
                var failures = new List<string> { $"{failed} of {e.Types.Length} types failed to load" };
                failures.AddRange(e.LoaderExceptions
                    .Where(x => x != null)
                    .Select(x => x!.GetType().Name + ": " + x.Message)
                    .Distinct());
                return new ProbeResult(fullPath, false, 0, failures);
            }
            catch (Exception e) when (e is IOException || e is BadImageFormatException || e is TypeLoadException)
            {
                return new ProbeResult(fullPath, false, 0, new[] { e.GetType().Name + ": " + e.Message });
            }
            finally
            {
                context.Unload();
            }
        }

        private static IReadOnlyDictionary<string, string> BuildIndex(IReadOnlyList<string> resolveDirs)
        {
            var index = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var dir in resolveDirs)
            {
                var files = Directory.EnumerateFiles(dir, "*.dll", SearchOption.AllDirectories)
                    .OrderBy(f => f, StringComparer.Ordinal);
                foreach (var file in files)
                {
                    index.TryAdd(System.IO.Path.GetFileNameWithoutExtension(file), file);
                }
            }
            return index;
        }
    }
}
