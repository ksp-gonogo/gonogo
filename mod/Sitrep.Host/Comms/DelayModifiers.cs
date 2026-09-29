using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Every delay modifier in force, and the one place they are folded into a
    /// signal-delay config.
    ///
    /// <para>A modifier is a factor on every light-time, held until its handle
    /// is disposed. All of them multiply, and a factor of zero switches delay
    /// off. Folding them into the CONFIG rather than into each reader is what
    /// keeps the five readers of <c>CommsCoreUplink.SignalDelayConfig</c> (the
    /// reveal gate, <c>comms.delay</c>, fleet light-time, the command-centre
    /// pass and the currency reveal deadline) in agreement without any of them
    /// knowing modifiers exist.</para>
    ///
    /// <para>This knows nothing of who registered a modifier or why. The reason
    /// is carried for the log only.</para>
    ///
    /// <para>Registered from uplink registration and settings callbacks, read on
    /// the main thread and the Courier, so every mutation is locked and the
    /// product is published as one volatile read.</para>
    /// </summary>
    public sealed class DelayModifiers
    {
        private readonly object _gate = new object();
        private readonly List<Modifier> _active = new List<Modifier>();
        private readonly Action<string>? _log;
        private double _product = 1.0;

        /// <param name="log">Where a registration and a withdrawal are reported, if anywhere.</param>
        public DelayModifiers(Action<string>? log = null)
        {
            _log = log;
        }

        /// <summary>The product of every factor in force; 1 when none is.</summary>
        public double Product => Volatile.Read(ref _product);

        /// <summary>
        /// Hold <paramref name="factor"/> until the returned handle is
        /// disposed. See <c>IUplinkHost.RegisterDelayModifier</c> for the
        /// rules a caller sees.
        /// </summary>
        public IDisposable Register(double factor, string reason) => Replace(null, factor, reason);

        /// <summary>
        /// Withdraw <paramref name="held"/> and hold <paramref name="factor"/>
        /// in its place as one change, so no reader sees the set with neither
        /// or with both. <paramref name="held"/> may be null, which is
        /// <see cref="Register"/>; a handle from another set is left alone.
        /// </summary>
        public IDisposable Replace(IDisposable? held, double factor, string reason)
        {
            if (double.IsNaN(factor) || double.IsInfinity(factor) || factor < 0.0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(factor), factor, "a delay factor is zero or a positive, finite number");
            }
            if (string.IsNullOrWhiteSpace(reason))
            {
                throw new ArgumentException("a delay modifier says why it is held", nameof(reason));
            }

            var modifier = new Modifier(this, factor, reason);
            var replaced = held as Modifier;
            lock (_gate)
            {
                if (replaced != null && !_active.Remove(replaced))
                {
                    replaced = null;
                }
                _active.Add(modifier);
                Recompute();
            }
            if (replaced != null)
            {
                _log?.Invoke("delay modifier x" + Format(replaced.Factor) + " withdrawn: " + replaced.Reason);
            }
            _log?.Invoke("delay modifier x" + Format(factor) + " held: " + reason);
            return modifier;
        }

        /// <summary>
        /// <paramref name="config"/> with every modifier in force applied: the
        /// same config when the product is 1 or delay is already off, delay
        /// switched off when the product is 0, and otherwise the light-speed
        /// scale divided by the product, which multiplies every light-time
        /// computed from it.
        /// </summary>
        public SignalDelayConfig Apply(SignalDelayConfig? config)
        {
            var authored = config ?? SignalDelayConfig.Off();
            var product = Product;
            if (product == 1.0 || !authored.Enabled)
            {
                return authored;
            }

            return new SignalDelayConfig
            {
                Enabled = product > 0.0,
                LightSpeedScale = product > 0.0 ? authored.LightSpeedScale / product : authored.LightSpeedScale,
                SilenceDeclarationSeconds = authored.SilenceDeclarationSeconds,
                CutForNoCommsModel = authored.CutForNoCommsModel,
            };
        }

        private void Withdraw(Modifier modifier)
        {
            bool removed;
            lock (_gate)
            {
                removed = _active.Remove(modifier);
                if (removed)
                {
                    Recompute();
                }
            }
            if (removed)
            {
                _log?.Invoke("delay modifier x" + Format(modifier.Factor) + " withdrawn: " + modifier.Reason);
            }
        }

        private void Recompute()
        {
            var product = 1.0;
            foreach (var modifier in _active)
            {
                product *= modifier.Factor;
            }
            Volatile.Write(ref _product, product);
        }

        private static string Format(double factor) => factor.ToString("R", CultureInfo.InvariantCulture);

        private sealed class Modifier : IDisposable
        {
            private readonly DelayModifiers _owner;

            internal Modifier(DelayModifiers owner, double factor, string reason)
            {
                _owner = owner;
                Factor = factor;
                Reason = reason;
            }

            internal double Factor { get; }

            internal string Reason { get; }

            public void Dispose() => _owner.Withdraw(this);
        }
    }

    /// <summary>
    /// The host's delay modifiers, for gonogo's own comms pass to fold into the
    /// config every delay reader uses. Off <c>IUplinkHost</c> because an Uplink
    /// registers a modifier and never reads the set.
    /// </summary>
    public interface IDelayModifierSource
    {
        /// <summary>The modifiers in force on this host.</summary>
        DelayModifiers DelayModifiers { get; }
    }
}
