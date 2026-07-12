namespace Sitrep.Host
{
    /// <summary>
    /// Version marker for this assembly, mirroring the TS-side convention
    /// (<c>KERNEL_VERSION</c> / <c>SDK_VERSION</c> / <c>SERVER_VERSION</c> in
    /// <c>mod/sitrep-kernel</c>, <c>sitrep-sdk</c>, <c>sitrep-server</c>'s
    /// <c>index.ts</c>) — bumped in lockstep as Sitrep.Host's public contract
    /// (<see cref="IKspHost"/>, the record format) changes.
    /// </summary>
    public static class HostInfo
    {
        public const string HOST_VERSION = "0.0.0";
    }
}
