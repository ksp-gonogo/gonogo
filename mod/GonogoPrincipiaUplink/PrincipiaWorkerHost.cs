using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>Why no worker may be started.</summary>
    public enum PrincipiaWorkerRefusal
    {
        None = 0,

        /// <summary>The build did not pass the conformance gate, so nothing may call
        /// into it whatever the machine.</summary>
        BuildNotConformant = 1,

        /// <summary>
        /// The save routes trigonometry through the platform's C library and the
        /// worker is on a different platform. That library is not in the borrowed
        /// file, so there is nothing to reproduce WITH, and an estimate offered here
        /// would be presented beside numbers that are the game's.
        /// </summary>
        TrigNotBorrowable = 2,

        /// <summary>The game host's own numeric configuration is unknown, so nothing
        /// can be said about whether a worker would match it.</summary>
        GameHostUnknown = 3,
    }

    /// <summary>
    /// One machine's numeric configuration, as it bears on reproducing Principia.
    ///
    /// <para>These are facts about a HOST and must be gathered from that host. The
    /// FMA bit in particular is the one an implementation reaches for locally out of
    /// convenience: read on the worker when the question was about the game host, it
    /// does not fail, it answers the wrong question in the shape of the right one.</para>
    /// </summary>
    public readonly struct PrincipiaHostFacts
    {
        public PrincipiaHostFacts(string? osFamily, bool? hasFma)
        {
            OsFamily = osFamily;
            HasFma = hasFma;
        }

        /// <summary>Compared for equality only, never parsed. Null means unknown.</summary>
        public string? OsFamily { get; }

        /// <summary>
        /// Whether the CPU reports FMA, which is the single bit Principia's loader
        /// dispatches on: the FMA build is selected if and only if this is set. Null
        /// means nobody has established it, which is NOT the same as false.
        /// </summary>
        public bool? HasFma { get; }

        public bool Known => OsFamily != null && HasFma != null;
    }

    /// <summary>Whether a worker may run, and what its answers could claim.</summary>
    public readonly struct PrincipiaWorkerDecision
    {
        private PrincipiaWorkerDecision(
            bool mayRun,
            PrincipiaNumericsProvenance provenance,
            PrincipiaWorkerRefusal refusal,
            string reason)
        {
            MayRun = mayRun;
            Provenance = provenance;
            Refusal = refusal;
            Reason = reason;
        }

        public bool MayRun { get; }

        /// <summary>What a trajectory from this worker may be labelled. Meaningful
        /// only when <see cref="MayRun"/>.</summary>
        public PrincipiaNumericsProvenance Provenance { get; }

        public PrincipiaWorkerRefusal Refusal { get; }
        public string Reason { get; }

        public static PrincipiaWorkerDecision Refuse(PrincipiaWorkerRefusal refusal, string reason) =>
            new PrincipiaWorkerDecision(
                false, PrincipiaNumericsProvenance.NotEstablished, refusal, reason);

        public static PrincipiaWorkerDecision Run(PrincipiaNumericsProvenance provenance, string reason) =>
            new PrincipiaWorkerDecision(true, provenance, PrincipiaWorkerRefusal.None, reason);
    }

    /// <summary>
    /// Decides whether a second Principia may be run beside the game, and what its
    /// answers are entitled to claim.
    ///
    /// <para>Nothing here starts a process. The decision is separated from the
    /// spawning because it is the part that can be wrong in a way nobody notices: a
    /// worker that runs and produces plausible numbers under the wrong label is worse
    /// than one that refuses, and it looks exactly like success.</para>
    ///
    /// <para><b>Spawning a worker beside KSP is possible, and that is measured rather
    /// than assumed.</b> KSP runs inside a pressure-vessel MOUNT namespace, separate
    /// from a host shell's, which is why a check run over SSH says nothing about what
    /// the game can do. Read from inside instead, on a live game:</para>
    ///
    /// <list type="bullet">
    /// <item><description>KSP already HAS a child, <c>kerbcast-sidecar</c>, a native
    /// ELF shipped under its own mod's GameData folder and started by that mod. A
    /// plugin starting a process is not a thing to prove, it is a thing already
    /// happening.</description></item>
    /// <item><description>That child's mount namespace is byte-identical to KSP's, so
    /// a worker inherits the container's filesystem view rather than the
    /// host's.</description></item>
    /// <item><description>Inside that view, GameData resolves at the same path it does
    /// outside, and Principia's own build is visible there. A worker can find the
    /// file it is meant to borrow.</description></item>
    /// <item><description>The existing sidecar talks over pipes and sockets, both of
    /// which therefore work across this boundary.</description></item>
    /// </list>
    ///
    /// <para>One thing the container does NOT have is a managed runtime: no
    /// <c>mono</c>, no <c>dotnet</c>. A worker is a native executable shipped beside
    /// the mod, which is exactly what the working precedent is.</para>
    /// </summary>
    public static class PrincipiaWorkerHost
    {
        /// <summary>
        /// <paramref name="gameHost"/> describes the machine KSP is on;
        /// <paramref name="workerHost"/> the machine the worker would be on. They are
        /// separate arguments even though the worker normally runs beside the game,
        /// because collapsing them is exactly the mistake that turns a wrong answer
        /// into an unnoticed one.
        ///
        /// <para><paramref name="usesCorrectSinCos"/> is the save's own flag: true for
        /// Principia's trigonometry, false for the platform's C library, null when it
        /// has not been read.</para>
        /// </summary>
        public static PrincipiaWorkerDecision Decide(
            PrincipiaConformanceVerdict conformance,
            PrincipiaHostFacts gameHost,
            PrincipiaHostFacts workerHost,
            bool? usesCorrectSinCos)
        {
            if (conformance.State != PrincipiaConformance.Conformant)
            {
                return PrincipiaWorkerDecision.Refuse(
                    PrincipiaWorkerRefusal.BuildNotConformant,
                    "The build the game is running has not passed the conformance gate, so nothing "
                        + "may call into it. " + (conformance.Reason ?? string.Empty));
            }

            if (!gameHost.Known)
            {
                // Never fill this in from the worker. The whole question is whether
                // the worker matches the game host, and answering it with the
                // worker's own reading makes every mismatch invisible.
                return PrincipiaWorkerDecision.Refuse(
                    PrincipiaWorkerRefusal.GameHostUnknown,
                    "The game host's operating system or FMA support has not been established, so "
                        + "whether a worker would reproduce its arithmetic cannot be said. This "
                        + "must be read on the game host and never on the worker.");
            }

            var sameOs = workerHost.OsFamily != null
                && string.Equals(gameHost.OsFamily, workerHost.OsFamily, StringComparison.Ordinal);

            if (usesCorrectSinCos == false && !sameOs)
            {
                // The trig comes from libm, and libm is not in the file we borrowed.
                // There is nothing here to reproduce with.
                return PrincipiaWorkerDecision.Refuse(
                    PrincipiaWorkerRefusal.TrigNotBorrowable,
                    "This save routes trigonometry through the platform's C library, and the "
                        + "worker is on a different platform. That library is not part of the "
                        + "Principia build, so the game's arithmetic cannot be reproduced here.");
            }

            var sameFma = workerHost.HasFma != null && gameHost.HasFma == workerHost.HasFma;

            if (!sameOs || !sameFma)
            {
                return PrincipiaWorkerDecision.Run(
                    PrincipiaNumericsProvenance.IndependentEstimate,
                    !sameOs
                        ? "The worker is on a different operating system from the game, so its "
                            + "answers are an independent estimate rather than the game's own."
                        : "The worker's FMA support differs from the game host's, so Principia "
                            + "selects a different numeric path there. The answers are an "
                            + "independent estimate.");
            }

            if (usesCorrectSinCos == null)
            {
                return PrincipiaWorkerDecision.Run(
                    PrincipiaNumericsProvenance.ReproducedExceptTrig,
                    "Same platform, same FMA support and a vetted build, but which trigonometry "
                        + "this save selects has not been read.");
            }

            // Same OS and same FMA. With Principia's own trig that is reproduction;
            // with the platform's, the platform is the same platform, so it is too.
            return PrincipiaWorkerDecision.Run(
                PrincipiaNumericsProvenance.Reproduced,
                usesCorrectSinCos.Value
                    ? "Same platform, same FMA support, same vetted build, and Principia's own "
                        + "trigonometry on both sides."
                    : "Same platform, same FMA support and same vetted build. This save uses the "
                        + "platform's trigonometry, and the worker is on that same platform.");
        }
    }
}
