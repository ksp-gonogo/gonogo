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
        public MechJebModuleAscentBaseAutopilot? Ascent;
        public MechJebModuleAscentSettings? AscentSettings;
        public MechJebModuleNodeExecutor? Node;
        public MechJebModuleLandingAutopilot? Landing;
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
        public MechJebModuleAscentBaseAutopilot? AscentAutopilot => null;
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

// Overloaded members, so the probe is proven overload-safe: a guard calling
// Type.GetMethod(name) throws AmbiguousMatchException on a member with more
// than one public overload, the exact drift GonogoScansatUplink's VersionGuard
// and GonogoKosUplink's KosVersionGuard were fixed for. UserPool.Add and
// MechJebCore.GetComputerModule both carry two in the shipped 2.15.3.0 dll
// (verified by decompiling it, local_docs/design/mechjeb-decompile-lock.md);
// Add is the one the probe reaches with RequireMethod, so it is the one that
// would throw.
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
        public MechJebModuleAscentBaseAutopilot? Ascent;
        public MechJebModuleAscentSettings? AscentSettings;
        public MechJebModuleNodeExecutor? Node;
        public MechJebModuleLandingAutopilot? Landing;
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
        public MechJebModuleAscentBaseAutopilot? AscentAutopilot => null;
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
        public MechJebModuleAscentBaseAutopilot? Ascent;
        public MechJebModuleAscentSettings? AscentSettings;
        public MechJebModuleNodeExecutor? Node;
        public MechJebModuleLandingAutopilot? Landing;
        public T? GetComputerModule<T>() => default;
    }

    public class MechJebModuleTargetController
    {
        public bool PositionTargetExists => false;
    }

    public class MechJebModuleAscentSettings
    {
        public EditableDoubleMult DesiredOrbitAltitude = new EditableDoubleMult();
        public MechJebModuleAscentBaseAutopilot? AscentAutopilot => null;
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

// MechJebCore without the cached module members the controller binds. Named for
// what it omits: Ascent, Node, Landing and AscentSettings are the four public
// members MechJebCore assigns in LoadComputerModules, and the controller reads
// them instead of walking _unorderedComputerModules per command.
namespace GonogoMechJebUplink.Tests.Fakes.CoreMissingAscent
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
        public MechJebModuleNodeExecutor? Node;
        public MechJebModuleLandingAutopilot? Landing;
        public MechJebModuleAscentSettings? AscentSettings;
        // Ascent intentionally missing.
    }

    public class MechJebModuleTargetController
    {
        public bool PositionTargetExists => false;
    }

    public class MechJebModuleAscentSettings
    {
        public EditableDoubleMult DesiredOrbitAltitude = new EditableDoubleMult();
        public MechJebModuleAscentBaseAutopilot? AscentAutopilot => null;
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
