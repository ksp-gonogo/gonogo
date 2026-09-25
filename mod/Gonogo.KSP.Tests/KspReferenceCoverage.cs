using Xunit;

namespace Gonogo.KSP.Tests;

/// <summary>
/// One skipped test for each suite this build dropped for want of KSP's own
/// assemblies, so a run that covers less than CI does says so in its summary:
/// <c>Passed!</c> with <c>Skipped: 0</c> means nothing was dropped.
/// </summary>
public class KspReferenceCoverage
{
#if KSP_MANAGED_ABSENT
    [Fact(Skip = "Assembly-CSharp.dll not found under KspManaged: every suite this project gates on it was not compiled, so this run covers fewer tests than CI")]
    public void KspManagedSuitesCompiled() { }
#endif

#if KSP_PHYSICS_ABSENT
    [Fact(Skip = "UnityEngine.PhysicsModule.dll not found under KspManaged: the robotics suites were not compiled, so this run covers fewer tests than CI")]
    public void ServoCaptureSuiteCompiled() { }
#endif
}
