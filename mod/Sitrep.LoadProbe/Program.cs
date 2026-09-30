using System;
using System.Collections.Generic;
using System.IO;

namespace Sitrep.LoadProbe
{
    /// <summary>
    /// <c>Sitrep.LoadProbe [--resolve &lt;dir&gt;]... &lt;dll&gt;...</c>
    ///
    /// Prints one verdict line per assembly and exits 0 when every one loads,
    /// 1 when any fails, and 2 on a usage error. Naming no assembly is a usage
    /// error rather than a pass, because a probe that read nothing would
    /// otherwise report the same clean run as one that read everything.
    /// </summary>
    public static class Program
    {
        public static int Main(string[] args) => Run(args, Console.Out, Console.Error);

        public static int Run(string[] args, TextWriter stdout, TextWriter stderr)
        {
            var resolveDirs = new List<string>();
            var dlls = new List<string>();
            for (var i = 0; i < args.Length; i++)
            {
                if (args[i] == "--resolve")
                {
                    if (i + 1 >= args.Length)
                    {
                        stderr.WriteLine("--resolve needs a directory");
                        return 2;
                    }
                    resolveDirs.Add(args[++i]);
                }
                else
                {
                    dlls.Add(args[i]);
                }
            }
            if (dlls.Count == 0)
            {
                stderr.WriteLine("usage: Sitrep.LoadProbe [--resolve <dir>]... <dll>...");
                return 2;
            }
            foreach (var dir in resolveDirs)
            {
                if (!Directory.Exists(dir))
                {
                    stderr.WriteLine($"resolve directory does not exist: {dir}");
                    return 2;
                }
            }

            var failed = 0;
            foreach (var result in AssemblyLoadProbe.ProbeAll(dlls, resolveDirs))
            {
                if (result.Loaded)
                {
                    stdout.WriteLine($"ok    {result.Path} ({result.TypeCount} types)");
                    continue;
                }
                failed++;
                stdout.WriteLine($"FAIL  {result.Path}");
                foreach (var failure in result.Failures)
                {
                    stdout.WriteLine($"        {failure}");
                }
            }
            stdout.WriteLine(failed == 0
                ? $"load probe: {dlls.Count} of {dlls.Count} assemblies load"
                : $"load probe: {failed} of {dlls.Count} assemblies FAIL to load");
            return failed == 0 ? 0 : 1;
        }
    }
}
