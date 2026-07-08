namespace Sitrep.Contract
{
    /// <summary>
    /// The Uplink ABI's version — see
    /// <c>local_docs/telemetry-mod/uplink-versioning-research.md</c>. This is
    /// intentionally a bare <c>const int</c> pair, not a struct/semver type:
    /// every consumer that needs "what contract version was I built against"
    /// (see <see cref="SitrepUplinkAttribute"/>'s default constructor
    /// arguments) relies on the C# compiler inlining a <c>const</c> at the
    /// CALL SITE, at COMPILE time — a struct/property read would instead
    /// resolve against the CALLER's loaded copy of this assembly, defeating
    /// the whole point of stamping "what version this Uplink was built
    /// against" into an old, un-recompiled binary.
    ///
    /// <see cref="Major"/> bumps are BREAKING (removed/renamed/retyped
    /// members on a wire-visible <c>[TsInterface]</c> type — the CI "lying
    /// minor" gate, see <c>local_docs/telemetry-mod/uplink-versioning-research.md</c>,
    /// fails the build on exactly this unless <see cref="Major"/> bumps in
    /// the same commit). <see cref="Minor"/> bumps are additive-only (new
    /// field/type) and never break an Uplink built against an older Minor of
    /// the same Major.
    /// </summary>
    public static class ContractVersion
    {
        public const int Major = 1;

        /// <summary>
        /// Bumped 0 -&gt; 1: additive-only Minor for dynamic-namespace channel
        /// registration (<see cref="IUplinkHost.RegisterDynamicNamespace"/>/
        /// <see cref="IDynamicChannelSource"/>) plus per-channel
        /// <see cref="ChannelDeclaration.Delay"/> disposition. Neither
        /// touches an existing <see cref="ISitrepUplink"/>'s compile-time
        /// surface — see <c>.superpowers/sdd/contract-dynamic-delay-report.md</c>.
        ///
        /// <para>Bumped 1 -&gt; 2: additive-only Minor for the
        /// capture-on-main / handle-on-Courier seam
        /// (<see cref="IUplinkHost.AddSampledSource"/>) — a new method on
        /// <see cref="IUplinkHost"/> (which an Uplink CONSUMES, never
        /// implements), so it cannot break any existing
        /// <see cref="ISitrepUplink"/> built against an older Minor. See
        /// <c>.superpowers/sdd/f1-main-thread-sampler-report.md</c>.</para>
        ///
        /// <para>Bumped 2 -&gt; 3: additive-only Minor for the
        /// subscription-gated <see cref="IUplinkHost.AddSampledSource(System.Func{KspSnapshot?, object?}, System.Action{object?}, string[])"/>
        /// overload — a new method on <see cref="IUplinkHost"/> (which an Uplink
        /// CONSUMES, never implements), so it cannot break any existing
        /// <see cref="ISitrepUplink"/> built against an older Minor. See
        /// <c>.superpowers/sdd/f1-hardening-report.md</c>.</para>
        /// </summary>
        public const int Minor = 3;
    }
}
