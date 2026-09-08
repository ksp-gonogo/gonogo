using Gonogo.MechJebUplink;
using Xunit;
using Good = GonogoMechJebUplink.Tests.Fakes.Good;
using MissingMember = GonogoMechJebUplink.Tests.Fakes.MissingMember;
using MissingType = GonogoMechJebUplink.Tests.Fakes.MissingType;
using Overloaded = GonogoMechJebUplink.Tests.Fakes.Overloaded;

namespace GonogoMechJebUplink.Tests
{
    public class MechJebVersionGuardTests
    {
        private static readonly System.Type[] GoodTypes =
        {
            typeof(Good.VesselExtensions), typeof(Good.MechJebCore), typeof(Good.ComputerModule),
            typeof(Good.MechJebModuleAscentSettings), typeof(Good.EditableDoubleMult),
            typeof(Good.MechJebModuleAscentBaseAutopilot), typeof(Good.UserPool),
            typeof(Good.MechJebModuleNodeExecutor), typeof(Good.MechJebModuleLandingAutopilot),
        };

        [Fact]
        public void Probe_NullAssembly_FailsSoft()
        {
            var result = MechJebVersionGuard.Probe(null);

            Assert.False(result.IsAvailable);
            Assert.Contains("not loaded", result.Reason);
        }

        [Fact]
        public void CheckAssemblyVersion_Unreadable_FailsRatherThanPasses()
        {
            // The absence-substitution case: `asmVersion != null && out-of-range`
            // let a null straight through, so a version we could not read
            // asserted a known-good major the assembly never claimed and armed
            // three autopilot commands on it. Not manufacturable from a real
            // Assembly in a headless test, which is why the check is split out.
            var result = MechJebVersionGuard.CheckAssemblyVersion(null);

            Assert.False(result.IsAvailable);
            Assert.Contains("unreadable", result.Reason);
        }

        [Fact]
        public void CheckAssemblyVersion_InRange_Passes()
        {
            var result = MechJebVersionGuard.CheckAssemblyVersion(new System.Version(2, 15, 3, 0));

            Assert.True(result.IsAvailable, result.Reason);
            Assert.Null(result.Reason);
        }

        [Fact]
        public void CheckAssemblyVersion_OutOfRange_Fails()
        {
            var result = MechJebVersionGuard.CheckAssemblyVersion(new System.Version(3, 0, 0, 0));

            Assert.False(result.IsAvailable);
            Assert.Contains("outside known-good range", result.Reason);
        }

        [Fact]
        public void ProbeTypes_AllMembersPresent_Succeeds()
        {
            var result = MechJebVersionGuard.ProbeTypes(GoodTypes);

            Assert.True(result.IsAvailable, result.Reason);
            Assert.Null(result.Reason);
        }

        [Fact]
        public void ProbeTypes_OverloadedMembers_LikeRealMechJeb2_Succeeds()
        {
            // Regression: MechJebCore.GetComputerModule has TWO overloads
            // (generic <T>() and string(Type)) and UserPool.Add /
            // MechJebModuleNodeExecutor.ExecuteOneNode share their name with
            // a sibling overload too, exactly like the real 2.15.3.0 dll. The
            // pre-fix RequireMethod calling Type.GetMethod(name) throws
            // AmbiguousMatchException on an overloaded method; the guard must
            // treat overloaded members as present, not as a probe failure.
            var types = new[]
            {
                typeof(Overloaded.VesselExtensions), typeof(Overloaded.MechJebCore), typeof(Overloaded.ComputerModule),
                typeof(Overloaded.MechJebModuleAscentSettings), typeof(Overloaded.EditableDoubleMult),
                typeof(Overloaded.MechJebModuleAscentBaseAutopilot), typeof(Overloaded.UserPool),
                typeof(Overloaded.MechJebModuleNodeExecutor), typeof(Overloaded.MechJebModuleLandingAutopilot),
            };

            var result = MechJebVersionGuard.ProbeTypes(types);

            Assert.True(result.IsAvailable, result.Reason);
            Assert.Null(result.Reason);
        }

        [Fact]
        public void ProbeTypes_MissingMember_FailsSoft_DoesNotThrow()
        {
            var types = new[]
            {
                typeof(MissingMember.VesselExtensions), typeof(MissingMember.MechJebCore), typeof(MissingMember.ComputerModule),
                typeof(MissingMember.MechJebModuleAscentSettings), typeof(MissingMember.EditableDoubleMult),
                typeof(MissingMember.MechJebModuleAscentBaseAutopilot), typeof(MissingMember.UserPool),
                typeof(MissingMember.MechJebModuleNodeExecutor), typeof(MissingMember.MechJebModuleLandingAutopilot),
            };

            var result = MechJebVersionGuard.ProbeTypes(types);

            Assert.False(result.IsAvailable);
            Assert.Contains("Add", result.Reason);
        }

        [Fact]
        public void ProbeTypes_MissingType_FailsSoft()
        {
            var types = new[] { typeof(MissingType.VesselExtensions) }; // everything else missing

            var result = MechJebVersionGuard.ProbeTypes(types);

            Assert.False(result.IsAvailable);
            Assert.Contains("MechJebCore", result.Reason);
        }

        [Fact]
        public void Probe_AssemblyMajorOutsideKnownGoodRange_FailsSoft()
        {
            // A real assembly whose Major happens to be outside the pinned
            // 2.x range: this test project's own Sitrep.Contract reference
            // is convenient, deterministic, and not MechJeb2, so Major will
            // never coincidentally land in range.
            var result = MechJebVersionGuard.Probe(typeof(Sitrep.Contract.CommandResult).Assembly);

            Assert.False(result.IsAvailable);
        }
    }
}
