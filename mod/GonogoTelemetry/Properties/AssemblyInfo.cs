using System.Reflection;

// KSP load-order dependency. Without this, KSP's AssemblyLoader processes
// assemblies in alphabetical order, which means GonogoTelemetry loads
// before Telemachus and the JIT can't resolve the Telemachus types
// referenced by our handlers (ReflectionTypeLoadException). The attribute
// tells KSP to load Telemachus 1.7+ first.
[assembly: KSPAssemblyDependency("Telemachus", 1, 7)]

// Identify ourselves for the assembly loader's log line.
[assembly: KSPAssembly("GonogoTelemetry", 0, 1)]

[assembly: AssemblyTitle("GonogoTelemetry")]
[assembly: AssemblyProduct("GonogoTelemetry")]
[assembly: AssemblyVersion("0.1.0")]
[assembly: AssemblyFileVersion("0.1.0")]
