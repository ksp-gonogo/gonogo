using Xunit;

namespace GonogoKosUplink.Tests;

/// <summary>
/// A skipped test standing in for the headless kOS terminal harness when this
/// build could not find kOS's own assemblies, so a run that covers less than
/// CI does says so in its summary: <c>Passed!</c> with <c>Skipped: 0</c> means
/// the harness ran.
/// </summary>
public class KosReferenceCoverage
{
#if KOS_REFERENCES_ABSENT
    [Fact(Skip = "kOS.Safe.dll / kOS.dll not found under KspGameData: the headless terminal harness was not compiled, so this run covers fewer tests than CI")]
    public void KosHarnessCompiled() { }
#endif
}
