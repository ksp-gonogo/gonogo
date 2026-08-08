namespace GonogoMechJebUplink.Tests.Fakes.Good
{
    public static class VesselExtensions
    {
        public static object? GetMasterMechJeb(object vessel) => null;
    }

    public class ComputerModule
    {
        public UserPool Users = new UserPool();
    }

    public class MechJebCore
    {
        public MechJebModuleTargetController? Target;
        public T? GetComputerModule<T>() => default;
        public object? GetComputerModule(string type) => null;
    }

    public class MechJebModuleTargetController
    {
        public bool PositionTargetExists => false;
    }

    public class MechJebModuleAscentSettings
    {
        public EditableDoubleMult DesiredOrbitAltitude = new EditableDoubleMult();
    }

    public class EditableDoubleMult
    {
        public double Val { get; set; }
    }

    public class MechJebModuleAscentBaseAutopilot : ComputerModule
    {
    }

    public class UserPool
    {
        public void Add(object user) { }
    }

    public class MechJebModuleNodeExecutor
    {
        public void ExecuteOneNode(object controller) { }
    }

    public class MechJebModuleLandingAutopilot
    {
        public void LandAtPositionTarget(object controller) { }
    }
}

// Mirrors the REAL MechJeb2 2.15.3.0 public surface (verified by decompiling
// the shipped MechJeb2.dll, local_docs/design/mechjeb-decompile-lock.md):
// MechJebCore.GetComputerModule has TWO overloads (generic <T>() and
// string(Type)). A pre-fix guard calling Type.GetMethod(name) would throw
// AmbiguousMatchException on this, the exact drift GonogoScansatUplink's
// VersionGuard/GonogoKosUplink's KosVersionGuard were fixed for. This fake
// reproduces the overload shape so the guard is proven overload-safe.
namespace GonogoMechJebUplink.Tests.Fakes.Overloaded
{
    public static class VesselExtensions
    {
        public static object? GetMasterMechJeb(object vessel) => null;
    }

    public class ComputerModule
    {
        public UserPool Users = new UserPool();
    }

    public class MechJebCore
    {
        public MechJebModuleTargetController? Target;
        public object? GetComputerModule<T>() => default;
        public object? GetComputerModule(string type) => null;
    }

    public class MechJebModuleTargetController
    {
        public bool PositionTargetExists => false;
    }

    public class MechJebModuleAscentSettings
    {
        public EditableDoubleMult DesiredOrbitAltitude = new EditableDoubleMult();
    }

    public class EditableDoubleMult
    {
        public double Val { get; set; }
    }

    public class MechJebModuleAscentBaseAutopilot : ComputerModule
    {
    }

    public class UserPool
    {
        // Two Add overloads, exercising the same overload-safety this probe needs.
        public void Add(object user) { }
        public void Add(object user, bool force) { }
    }

    public class MechJebModuleNodeExecutor
    {
        public void ExecuteOneNode(object controller) { }
        public void ExecuteAllNodes(object controller) { }
    }

    public class MechJebModuleLandingAutopilot
    {
        public void LandAtPositionTarget(object controller) { }
    }
}

namespace GonogoMechJebUplink.Tests.Fakes.MissingMember
{
    public static class VesselExtensions
    {
        public static object? GetMasterMechJeb(object vessel) => null;
    }

    public class ComputerModule
    {
        public UserPool Users = new UserPool();
    }

    public class MechJebCore
    {
        public MechJebModuleTargetController? Target;
        public T? GetComputerModule<T>() => default;
    }

    public class MechJebModuleTargetController
    {
        public bool PositionTargetExists => false;
    }

    public class MechJebModuleAscentSettings
    {
        public EditableDoubleMult DesiredOrbitAltitude = new EditableDoubleMult();
    }

    public class EditableDoubleMult
    {
        public double Val { get; set; }
    }

    public class MechJebModuleAscentBaseAutopilot : ComputerModule
    {
    }

    public class UserPool
    {
        // Add intentionally missing.
    }

    public class MechJebModuleNodeExecutor
    {
        public void ExecuteOneNode(object controller) { }
    }

    public class MechJebModuleLandingAutopilot
    {
        public void LandAtPositionTarget(object controller) { }
    }
}

namespace GonogoMechJebUplink.Tests.Fakes.MissingType
{
    public static class VesselExtensions
    {
        public static object? GetMasterMechJeb(object vessel) => null;
    }

    // MechJebCore / ComputerModule / the rest are intentionally absent.
}
