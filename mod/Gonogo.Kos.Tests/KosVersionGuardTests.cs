using System;
using System.Collections.Generic;
using System.Linq;
using Gonogo.Kos;
using Xunit;

namespace Gonogo.Kos.Tests
{
    // Fakes matched by SIMPLE NAME, exactly as production resolves the real kOS
    // types (KosVersionGuard.ProbeTypes matches Type.Name). These carry the
    // member NAMES/shapes the guard requires so the probe can be exercised with
    // no real kOS.dll present — the same technique GonogoScansatUplink's
    // VersionGuard tests use.
    namespace Fakes
    {
#pragma warning disable IDE1006 // intentionally lower-cased to match kOS's real type name
        public class kOSProcessor
        {
            public static List<object> AllInstances() => new List<object>();
            public object? GetScreen() => null;
            public object? GetWindow() => null;
            public object? HardDisk { get; set; }
            public object? Archive { get; set; }
            public string Tag { get; set; } = "";
            public int KOSCoreId { get; set; }
            public bool HasBooted { get; set; }
            public object? BootFilePath { get; set; }
            public int ProcessorMode { get; set; }
        }
#pragma warning restore IDE1006

        public interface IInterpreter
        {
            void SetInputLock(bool isLocked);
            bool IsAtStartOfCommand();
            bool IsWaitingForCommand();
        }

        public class TermWindow
        {
            // The pinned 4-arg overload shape (char, _, bool, bool) plus the
            // 3-arg + 2-arg siblings the guard must disambiguate from.
            public bool ProcessOneInputChar(char ch, object? whichTelnet, bool allowQueue, bool forceQueue) => true;
            public void ProcessOneInputChar(char ch, object? whichTelnet, bool allowQueue) { }
            public void ProcessOneInputChar(char ch, object? whichTelnet) { }
        }

        public class ScreenBuffer
        {
            public void Print(string textToPrint) { }
            public void Print(string textToPrint, bool addNewLine) { }
        }

        // A TermWindow whose ONLY ProcessOneInputChar is the non-pinned 3-arg
        // overload — the ambiguity the guard exists to catch.
        public class TermWindowThreeArgOnly
        {
            public void ProcessOneInputChar(char ch, object? whichTelnet, bool allowQueue) { }
        }
    }

    /// <summary>
    /// Headless tests for the kOS version guard (spec §7) — assembly/member
    /// existence + the 4-arg <c>ProcessOneInputChar</c> overload pin, plus the
    /// optional-postfix availability axis.
    /// </summary>
    public class KosVersionGuardTests
    {
        private static readonly Type[] FullSet =
        {
            typeof(Fakes.kOSProcessor),
            typeof(Fakes.IInterpreter),
            typeof(Fakes.TermWindow),
            typeof(Fakes.ScreenBuffer),
        };

        [Fact]
        public void Probe_NullAssemblies_FailSoft()
        {
            var r = KosVersionGuard.Probe(null, null);
            Assert.False(r.IsAvailable);
            Assert.Contains("not loaded", r.Reason);
        }

        [Fact]
        public void ProbeTypes_FullSet_AvailableWithPostfix()
        {
            var r = KosVersionGuard.ProbeTypes(FullSet);
            Assert.True(r.IsAvailable);
            Assert.True(r.ComputePostfixAvailable);
        }

        [Fact]
        public void ProbeTypes_NoScreenBuffer_AvailableButNoPostfix()
        {
            var types = FullSet.Where(t => t.Name != "ScreenBuffer").ToList();
            var r = KosVersionGuard.ProbeTypes(types);
            Assert.True(r.IsAvailable);
            Assert.False(r.ComputePostfixAvailable);
        }

        [Fact]
        public void ProbeTypes_MissingCoreType_FailSoft()
        {
            var types = FullSet.Where(t => t.Name != "TermWindow").ToList();
            var r = KosVersionGuard.ProbeTypes(types);
            Assert.False(r.IsAvailable);
            Assert.Contains("TermWindow", r.Reason);
        }

        [Fact]
        public void ProbeTypes_MissingMember_FailSoftNamingMember()
        {
            // A kOSProcessor stand-in lacking KOSCoreId.
            var r = KosVersionGuard.ProbeTypes(new[]
            {
                typeof(FakesMissing.kOSProcessor),
                typeof(Fakes.IInterpreter),
                typeof(Fakes.TermWindow),
                typeof(Fakes.ScreenBuffer),
            });
            Assert.False(r.IsAvailable);
            Assert.Contains("KOSCoreId", r.Reason);
        }

        [Fact]
        public void HasFourArgProcessOneInputChar_TrueForFourArgShape()
        {
            Assert.True(KosVersionGuard.HasFourArgProcessOneInputChar(typeof(Fakes.TermWindow)));
        }

        [Fact]
        public void HasFourArgProcessOneInputChar_FalseWhenOnlyThreeArg()
        {
            Assert.False(KosVersionGuard.HasFourArgProcessOneInputChar(typeof(Fakes.TermWindowThreeArgOnly)));
        }
    }

    // A processor stand-in (matched by simple name) missing the KOSCoreId
    // member — in a distinct namespace from Fakes so it doesn't clash.
    namespace FakesMissing
    {
#pragma warning disable IDE1006
        public class kOSProcessor
        {
            public static List<object> AllInstances() => new List<object>();
            public object? GetScreen() => null;
            public object? GetWindow() => null;
            public object? HardDisk { get; set; }
            public object? Archive { get; set; }
            public string Tag { get; set; } = "";
            // KOSCoreId intentionally absent.
            public bool HasBooted { get; set; }
            public object? BootFilePath { get; set; }
            public int ProcessorMode { get; set; }
        }
#pragma warning restore IDE1006
    }
}
