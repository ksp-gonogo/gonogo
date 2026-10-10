namespace Sitrep.Contract
{
    /// <summary>
    /// The version of the Sitrep wire contract and Uplink ABI, as a pair of
    /// <c>const int</c> values.
    /// <para><see cref="Major"/> changes on a breaking change: a wire-visible
    /// member removed, renamed or retyped, or an Uplink-facing interface
    /// changed so an existing Uplink no longer compiles. <see cref="Minor"/>
    /// changes on an additive change only (a new field or type), and never
    /// breaks an Uplink built against an older Minor of the same Major.</para>
    /// <para>Both are constants, so the compiler inlines them into an Uplink at
    /// compile time: the values an Uplink reads (and the defaults of
    /// <see cref="SitrepUplinkAttribute"/>) record the contract it was built
    /// against, not the one loaded beside it at run time.</para>
    /// <internal>
    /// A struct or property read would resolve against the caller's loaded copy
    /// of this assembly and defeat the point of stamping the build-time version
    /// into an old, un-recompiled binary. The CI shape gate fails the build on a
    /// wire break unless Major moves in the same commit.
    /// <para>The pair is mirrored, and every mirror moves with it:
    /// <c>mod/sitrep-sdk/src/compat-versions.ts</c>, each Uplink's
    /// <c>gonogo-uplink.json</c> and the Built-against line of its README.
    /// <c>contract-version-parity.test.ts</c> holds them to these declarations,
    /// and <c>ContractVersion.props</c> reads them by shape to stamp the
    /// assembly, so the two declarations keep the form
    /// <c>public const int Name = N;</c>.</para>
    /// </internal>
    /// </summary>
    /// <category>Uplink API</category>
    public static class ContractVersion
    {
        /// <summary>
        /// The contract's major version. It changes on a breaking change to the
        /// wire contract or the Uplink ABI; an Uplink built against a different
        /// Major is not compatible. The value is inlined into an Uplink at
        /// compile time, so it records the Major that Uplink was built against.
        /// <internal>
        /// A Major bump resets <see cref="Minor"/> to 0. What changed belongs in
        /// the commit that moved it, not here.
        /// </internal>
        /// </summary>
        public const int Major = 36;

        /// <summary>
        /// The contract's minor version within the current <see cref="Major"/>. It
        /// changes on an additive change only, and an Uplink built against any older
        /// Minor of the same Major stays compatible. The value is inlined into an
        /// Uplink at compile time, so it records the Minor that Uplink was built against.
        /// </summary>
        public const int Minor = 3;
    }
}
