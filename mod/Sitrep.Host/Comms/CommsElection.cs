using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The comms backend election (comms-uplink-design.md §2), expressed
    /// entirely in terms of the existing <see cref="Kernel"/>, no new
    /// contract mechanism (§2.3, §5). One EXCLUSIVE capability <c>"comms"</c>
    /// whose active instance is an <see cref="ICommsBackend"/>:
    ///
    /// <list type="bullet">
    /// <item><b>CommNet is the capability's <c>Vanilla</c> factory</b>, the
    /// structural "comms is never unsatisfiable" guarantee (§2.2 recommends
    /// exactly this). It activates whenever no higher provider is registered.</item>
    /// <item><b>RealAntennas registers as a provider</b>: but ONLY when the RA
    /// assembly is actually loaded (the reflection probe, §4.2). Registering the
    /// provider IS the gate: an exclusive capability with one registered
    /// provider selects that provider (Kernel.SelectExclusive: candidates.Count
    /// == 1 ⇒ that provider); with zero registered providers it falls back to
    /// Vanilla. So RA present ⇒ RA wins; RA absent ⇒ CommNet vanilla, no
    /// version-string gymnastics needed.</item>
    /// </list>
    ///
    /// <para>Shared <c>comms.*</c> channels are declared and sourced ONCE by
    /// the core comms registration, which resolves the elected backend via
    /// <c>Kernel.Query&lt;ICommsBackend&gt;("comms")</c> at map time: neither
    /// CommNet nor RA declares those channels itself (§2.2, the
    /// shared-namespace-multi-provider rule §5). RA-only channels
    /// (linkQuality/dataRate/linkMargin) are declared in the RA uplink's own
    /// manifest and bypass the election entirely.</para>
    /// </summary>
    public static class CommsElection
    {
        /// <summary>The exclusive capability id both backends compete for.</summary>
        public const string CapabilityId = "comms";



        /// <summary>
        /// Registers the exclusive <c>"comms"</c> capability with CommNet as
        /// its always-present <see cref="CapabilityDescriptor.Vanilla"/>
        /// factory. Idempotent-safe to call once at bootstrap (before
        /// <see cref="Kernel.Resolve"/>). Not <see cref="CapabilityDescriptor.SpineCritical"/>:
        /// a comms-less install (no vanilla would be pathological, but defence
        /// in depth) must not halt the whole spine.
        /// </summary>
        public static void RegisterCapability(
            Kernel kernel,
            Func<ProviderContext, ICommsBackend> commNetVanillaFactory)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            if (commNetVanillaFactory == null) throw new ArgumentNullException(nameof(commNetVanillaFactory));

            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = ctx => commNetVanillaFactory(ctx),
            });
        }

        // A provider registers itself through the kernel's generic
        // RegisterProvider, naming its own id and priority. Core deliberately
        // offers no per-mod registrar: a named one puts a specific third-party
        // mod in core's API surface, and every caller that used the two removed
        // here was a test.

        /// <summary>
        /// Resolve the elected backend after resolution has run. Returns null
        /// if the capability was never registered or resolved to no instance
        /// (defensive: a correctly bootstrapped engine always has at least the
        /// vanilla CommNet backend).
        /// </summary>
        public static ICommsBackend? Elected(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            try
            {
                return kernel.Query<ICommsBackend>(CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The elected backend's declared occlusion geometry: the one read a
        /// consumer needs to answer "does this body block the path", without
        /// knowing or caring which backend won.
        ///
        /// <para>Never null and never throws. A missing kernel, an unresolved
        /// capability, or a backend whose own declaration throws all yield
        /// <see cref="CommsOcclusionModels.Unknown"/>, which occludes at the
        /// bare radius: the largest occluder in play, so a consumer built on it
        /// under-promises contact rather than over-promising it. A consumer that
        /// cares whether it got a real answer compares
        /// <see cref="ICommsOcclusionModel.ModelId"/> against
        /// <see cref="CommsOcclusionModels.UnknownModelId"/>.</para>
        ///
        /// <para>Calls into the live backend, so it belongs on the same
        /// capture-on-main seam every other <see cref="ICommsBackend"/> read
        /// does; the model it returns is pure and safe to carry anywhere.</para>
        /// </summary>
        public static ICommsOcclusionModel OcclusionModel(Kernel? kernel)
        {
            if (kernel == null)
            {
                return CommsOcclusionModels.Unknown;
            }
            try
            {
                return Elected(kernel)?.OcclusionModel() ?? CommsOcclusionModels.Unknown;
            }
            catch (Exception)
            {
                return CommsOcclusionModels.Unknown;
            }
        }

        /// <summary>
        /// The elected backend's declared reach rule for a pair of nodes: the
        /// other half of the same wall <see cref="OcclusionModel"/> covers, and
        /// the read a consumer needs to answer "can these two hear each other at
        /// all" without knowing which backend won.
        ///
        /// <para>Never null and never throws, on the same terms as
        /// <see cref="OcclusionModel"/>. A missing kernel, an unresolved
        /// capability, or a backend whose declaration throws all yield
        /// <see cref="CommsReachModels.Unknown"/>, whose maximum is ABSENT: a
        /// consumer then applies no reach term and predicts exactly what it
        /// could before, rather than being handed a guess. That is where this
        /// differs from the occlusion fallback, which CAN be conservative and
        /// still useful; <see cref="CommsReachModels.Unknown"/> carries the
        /// argument. A consumer that cares whether it got a real answer compares
        /// <see cref="ICommsReachModel.ModelId"/> against
        /// <see cref="CommsReachModels.UnknownModelId"/>.</para>
        ///
        /// <para>Calls into the live backend, so it belongs on the same
        /// capture-on-main seam every other <see cref="ICommsBackend"/> read
        /// does; the model it returns is pure and safe to carry anywhere,
        /// including onto a sweep thread.</para>
        /// </summary>
        public static ICommsReachModel ReachModel(Kernel? kernel, object? from, object? to)
        {
            if (kernel == null)
            {
                return CommsReachModels.Unknown;
            }
            try
            {
                return Elected(kernel)?.ReachModel(from, to) ?? CommsReachModels.Unknown;
            }
            catch (Exception)
            {
                return CommsReachModels.Unknown;
            }
        }

        /// <summary>
        /// The elected backend's link model for a pair of nodes, for planning
        /// contacts beyond line of sight and range, or null when it has none: the
        /// backend is not an <see cref="ICommsContactModel"/>, it has nothing to add
        /// for this pair, or asking it threw. Null leaves the pair to geometry and
        /// <see cref="ReachModel"/>, which is what every backend got before.
        ///
        /// <para>Calls into the live backend, so it belongs on the capture-on-main
        /// seam; the model it returns is pure and is evaluated on the planner's
        /// thread.</para>
        /// </summary>
        public static IContactLinkModel? LinkModel(Kernel? kernel, object? from, object? to, double ut)
        {
            if (kernel == null)
            {
                return null;
            }
            try
            {
                return (Elected(kernel) as ICommsContactModel)?.LinkModel(from, to, ut);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The elected backend's retarget model for one node, or null when it has
        /// none: the backend does not turn dishes, the node has none it would turn,
        /// or asking it threw.
        ///
        /// <para>THREADING: main thread only, as every other backend read at this
        /// seam; the model it returns is pure.</para>
        /// </summary>
        public static IRetargetModel? RetargetModel(Kernel? kernel, object? node, double ut)
        {
            if (kernel == null)
            {
                return null;
            }
            try
            {
                return (Elected(kernel) as ICommsRetargetBackend)?.RetargetModel(node, ut);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The strength model the elected backend builds again from what it described
        /// when a game was saved, or null when it is not one that does, does not know
        /// the model, or the kernel is missing.
        /// </summary>
        public static IContactLinkStrength? RestoreLinkStrength(Kernel? kernel, string modelId, IReadOnlyDictionary<string, object?> data)
        {
            if (kernel == null)
            {
                return null;
            }
            try
            {
                return (Elected(kernel) as ILinkStrengthRestorer)?.RestoreLinkStrength(modelId, data);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>The elected backend as something that turns dishes, or null when it is not one.</summary>
        public static ICommsRetargetBackend? RetargetBackend(Kernel? kernel) =>
            kernel == null ? null : Elected(kernel) as ICommsRetargetBackend;

        /// <summary>
        /// The elected backend's strength model for a pair of nodes, or null
        /// when it states none: the backend is not an
        /// <see cref="ICommsPathStrength"/>, it has nothing for this pair, or
        /// asking it threw.
        ///
        /// <para>THREADING: main thread only, as every other backend read at this
        /// seam; the model it returns is pure.</para>
        /// </summary>
        public static IContactLinkStrength? LinkStrength(Kernel? kernel, object? from, object? to, double ut)
        {
            if (kernel == null)
            {
                return null;
            }
            try
            {
                return (Elected(kernel) as ICommsPathStrength)?.LinkStrength(from, to, ut);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The elected backend's rule for what a whole path is worth from its
        /// hops, or null when it states none. Read on the main thread; the rule
        /// itself is pure and may be called anywhere. A rule that throws is
        /// answered as not a number, which states no strength.
        /// </summary>
        public static Func<IReadOnlyList<double>, double>? PathStrength(Kernel? kernel)
        {
            if (kernel == null)
            {
                return null;
            }
            ICommsPathStrength? backend;
            try
            {
                backend = Elected(kernel) as ICommsPathStrength;
            }
            catch (Exception)
            {
                return null;
            }
            if (backend == null)
            {
                return null;
            }
            return hops =>
            {
                try
                {
                    return backend.Combine(hops);
                }
                catch (Exception)
                {
                    return double.NaN;
                }
            };
        }
    }
}
