// GonogoKosUplink — GPLv3. See GonogoKosUplink.csproj's header comment for the
// licence/linkage rationale.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Gonogo.KosUplink
{
    /// <summary>
    /// Result of the mandatory kOS version-guard probe
    /// (<c>kos-migration-spec.md</c> §7): assembly presence, version pin, and
    /// member-existence for every kOS member this Uplink binds. Never throws —
    /// every failure mode degrades to <see cref="IsAvailable"/> = false with a
    /// <see cref="Reason"/>, per the fail-soft contract
    /// (<c>IUplinkHost.SetAvailability</c>). <see cref="ComputePostfixAvailable"/>
    /// is a SEPARATE, non-fatal axis: the <c>ScreenBuffer.Print(string,bool)</c>
    /// postfix target being absent does NOT make the Uplink unavailable — it
    /// only means compute falls back to the public snapshot-scrape (spec §4.4).
    /// </summary>
    public readonly struct KosGuardResult
    {
        public bool IsAvailable { get; }
        public string? Reason { get; }
        public bool ComputePostfixAvailable { get; }

        private KosGuardResult(bool isAvailable, string? reason, bool computePostfixAvailable)
        {
            IsAvailable = isAvailable;
            Reason = reason;
            ComputePostfixAvailable = computePostfixAvailable;
        }

        public static KosGuardResult Ok(bool computePostfixAvailable) =>
            new KosGuardResult(true, null, computePostfixAvailable);

        public static KosGuardResult Fail(string reason) => new KosGuardResult(false, reason, false);
    }

    /// <summary>
    /// Probes the loaded kOS + kOS.Safe assemblies for the public members this
    /// Uplink binds (spec §7's pin list). Takes assemblies/types rather than
    /// loading them so it is unit-testable against fake/absent assemblies with
    /// no real kOS.dll present (same pattern as
    /// <c>GonogoScansatUplink.VersionGuard</c>).
    ///
    /// <para><b>The 4-arg <c>ProcessOneInputChar</c> overload is pinned by
    /// explicit parameter shape</b> — spec §7's load-bearing point: there are
    /// three <c>ProcessOneInputChar</c> overloads (4-arg at
    /// <c>TermWindow.cs:632</c>, 3-arg at <c>:723</c>, 2-arg at <c>:739</c>),
    /// and binding by name alone is ambiguous. The probe requires a method
    /// named <c>ProcessOneInputChar</c> with exactly four parameters whose
    /// first is <see cref="char"/> and whose last two are <see cref="bool"/>
    /// (the <c>(char, TelnetSingletonServer, bool, bool)</c> shape kOS keeps
    /// frozen as an external contract, <c>TermWindow.cs:713-720</c>) — the
    /// middle <c>TelnetSingletonServer</c> is matched by position only so the
    /// check stays runnable in the headless test without that kOS type.</para>
    /// </summary>
    public static class KosVersionGuard
    {
        /// <summary>Pinned known-good kOS major (validated against kOS 1.6.x — the live install's kOS.dll is 1.6.0.1).</summary>
        public const int MinKnownGoodMajor = 1;
        public const int MaxKnownGoodMajor = 1;

        public static KosGuardResult Probe(Assembly? kosAssembly, Assembly? kosSafeAssembly)
        {
            if (kosAssembly == null || kosSafeAssembly == null)
            {
                return KosGuardResult.Fail("kOS.dll / kOS.Safe.dll not loaded");
            }

            Version? asmVersion = kosAssembly.GetName().Version;
            if (asmVersion != null &&
                (asmVersion.Major < MinKnownGoodMajor || asmVersion.Major > MaxKnownGoodMajor))
            {
                return KosGuardResult.Fail(
                    $"kOS {asmVersion} outside known-good range {MinKnownGoodMajor}.x-{MaxKnownGoodMajor}.x");
            }

            Type[] kosTypes = SafeGetTypes(kosAssembly);
            Type[] safeTypes = SafeGetTypes(kosSafeAssembly);
            return ProbeTypes(kosTypes.Concat(safeTypes).ToList());
        }

        /// <summary>
        /// The member-probe half, split out so tests can supply an exact set
        /// of fake types (matched by simple name, same as production) without
        /// a real kOS assembly.
        /// </summary>
        public static KosGuardResult ProbeTypes(IReadOnlyList<Type> allTypes)
        {
            Type? processor = allTypes.FirstOrDefault(t => t.Name == "kOSProcessor");
            Type? interpreter = allTypes.FirstOrDefault(t => t.Name == "IInterpreter");
            Type? termWindow = allTypes.FirstOrDefault(t => t.Name == "TermWindow");

            if (processor == null || interpreter == null || termWindow == null)
            {
                return KosGuardResult.Fail(
                    "kOS member-existence probe: one or more expected types missing (kOSProcessor/IInterpreter/TermWindow)");
            }

            var missing = new List<string>();

            RequireMethod(processor, "AllInstances", missing);
            RequireMethod(processor, "GetScreen", missing);
            RequireMethod(processor, "GetWindow", missing);
            RequireMember(processor, "HardDisk", missing);
            RequireMember(processor, "Archive", missing);
            RequireMember(processor, "Tag", missing);
            RequireMember(processor, "KOSCoreId", missing);
            RequireMember(processor, "HasBooted", missing);
            RequireMember(processor, "BootFilePath", missing);
            RequireMember(processor, "ProcessorMode", missing);

            RequireMethod(interpreter, "IsWaitingForCommand", missing);
            RequireMethod(interpreter, "IsAtStartOfCommand", missing);
            RequireMethod(interpreter, "SetInputLock", missing);

            if (!HasFourArgProcessOneInputChar(termWindow))
            {
                missing.Add("TermWindow.ProcessOneInputChar(char, _, bool, bool)");
            }

            if (missing.Count > 0)
            {
                return KosGuardResult.Fail(
                    $"kOS member-existence probe failed: {string.Join(", ", missing)}");
            }

            // Optional: the compute Print-postfix target. Absent => fall back
            // to snapshot-scrape, Uplink stays fully available (spec §4.4/§7).
            Type? screenBuffer = allTypes.FirstOrDefault(t => t.Name == "ScreenBuffer");
            bool postfix = screenBuffer != null && HasPrintStringBool(screenBuffer);

            return KosGuardResult.Ok(postfix);
        }

        /// <summary>
        /// True iff <paramref name="termWindow"/> declares a
        /// <c>ProcessOneInputChar</c> overload with exactly four parameters
        /// shaped <c>(char, *, bool, bool)</c> — the pinned 4-arg overload
        /// (spec §7). The second parameter's type (<c>TelnetSingletonServer</c>)
        /// is matched by POSITION only, so the check needs no kOS type present.
        /// </summary>
        public static bool HasFourArgProcessOneInputChar(Type termWindow)
        {
            return termWindow
                .GetMethods(BindingFlags.Public | BindingFlags.Instance)
                .Where(m => m.Name == "ProcessOneInputChar")
                .Select(m => m.GetParameters())
                .Any(p => p.Length == 4
                          && p[0].ParameterType == typeof(char)
                          && p[2].ParameterType == typeof(bool)
                          && p[3].ParameterType == typeof(bool));
        }

        private static bool HasPrintStringBool(Type screenBuffer)
        {
            return screenBuffer
                .GetMethods(BindingFlags.Public | BindingFlags.Instance)
                .Where(m => m.Name == "Print")
                .Select(m => m.GetParameters())
                .Any(p => p.Length == 2
                          && p[0].ParameterType == typeof(string)
                          && p[1].ParameterType == typeof(bool));
        }

        private static Type[] SafeGetTypes(Assembly asm)
        {
            try
            {
                return asm.GetTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                return ex.Types.Where(t => t != null).Cast<Type>().ToArray();
            }
        }

        private static void RequireMethod(Type t, string name, List<string> missing)
        {
            if (t.GetMethods().All(m => m.Name != name))
            {
                missing.Add($"{t.Name}.{name}()");
            }
        }

        private static void RequireMember(Type t, string name, List<string> missing)
        {
            if (t.GetProperty(name) == null && t.GetField(name) == null)
            {
                missing.Add($"{t.Name}.{name}");
            }
        }
    }
}
