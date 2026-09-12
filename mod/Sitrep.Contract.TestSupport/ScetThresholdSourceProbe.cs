using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// A SCET threshold source written from an UPLINK's position, and the proof
    /// that the seam is one.
    ///
    /// <para><b>Where this type lives is the whole assertion.</b> This assembly
    /// references <c>Sitrep.Contract</c> and nothing else of the repo's, which is
    /// exactly what an Uplink csproj may reference. So every type named below
    /// -- <see cref="IScetThresholdSources"/>, <see cref="ScetThresholdSource"/>,
    /// <see cref="ScetThresholdCapability"/>, <see cref="KspSnapshot"/> -- is
    /// reachable by an outside author by construction rather than by inspection.
    /// A provider that compiled only in a project with <c>Sitrep.Host</c> on its
    /// path would prove nothing at all, because the table it contributes to was
    /// always reachable from there.</para>
    ///
    /// <para>It stamps its own payload, which is the membership rule a
    /// contributed source has to meet: the reading is accepted only from a
    /// payload whose <c>meta.source</c> equals the alarm's subject.</para>
    /// </summary>
    public sealed class ScetThresholdSourceProbe : IScetThresholdSources
    {
        /// <summary>The Topic this probe offers, which core's own table does not hold.</summary>
        public const string ProbeTopic = "probe.reserves";

        private readonly string _subject;

        public ScetThresholdSourceProbe(string subject = "game") => _subject = subject;

        public string ProviderId => "scet-threshold-probe";

        public IReadOnlyList<ScetThresholdSource> Sources() => new[]
        {
            new ScetThresholdSource { Topic = ProbeTopic, Build = Build },
        };

        /// <summary>
        /// Reads <c>values["probe"]["reserves"]</c> off the snapshot and shapes it
        /// the way the wire shapes a payload. Null for a snapshot that does not
        /// carry the key, which reads as "not now" and never fires.
        /// </summary>
        private object? Build(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null
                || !snapshot.Values.TryGetValue("probe", out var raw)
                || raw is not IDictionary<string, object?> probe)
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["reserves"] = probe.TryGetValue("reserves", out var reserves) ? reserves : null,
                ["meta"] = new Dictionary<string, object?>
                {
                    ["source"] = _subject,
                    ["quality"] = Quality.Loaded,
                },
            };
        }

        /// <summary>
        /// Declares the capability and registers this probe against it, the same
        /// two calls an Uplink makes: the declaration from the host's
        /// pre-Register pass, the registration from the contributing mod's.
        ///
        /// <para>Both are here so a test exercises the REAL <see cref="Kernel"/>
        /// rather than a stand-in for it. The registration is what a third-party
        /// author writes; the declaration is core's and is repeated here only
        /// because a test's kernel has no uplink discovery behind it.</para>
        /// </summary>
        public static void Register(Kernel kernel, ScetThresholdSourceProbe probe)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            if (probe == null) throw new ArgumentNullException(nameof(probe));

            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = ScetThresholdCapability.Id,
                Exclusive = false,
                SpineCritical = false,
            });
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = ScetThresholdCapability.Id,
                Id = probe.ProviderId,
                Factory = _ => probe,
            });
        }
    }
}
