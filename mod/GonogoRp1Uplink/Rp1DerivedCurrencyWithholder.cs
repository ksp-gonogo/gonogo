using System;
using System.Reflection;
using Sitrep.Contract;

// Reflection-only, same arm's-length treatment as Rp1ScReflection: no
// compile-time reference to RP0.dll, every member reached by name at runtime,
// null-safe per hop.
//
// PROVENANCE. Every member below was read out of an ilspycmd disassembly of the
// INSTALLED GameData/RP-1/Plugins/RP0.dll on 2026-08-27, and the sequence the
// fix depends on came out of the same disassembly:
//
//   RP0.Harmony.PatchRnD.Prefix_AddScience replaces ResearchAndDevelopment
//   .AddScience outright, and fires, in this order:
//       GameEvents.Modifiers.OnCurrencyModifierQuery
//       GameEvents.Modifiers.OnCurrencyModified      <- RP-1 banks its award here
//       GameEvents.OnScienceChanged                  <- the interceptor neutralises here
//
//   RP0.Confidence.OnCurrenciesModified is on the middle one. It prices an award
//   whenever the query's SCIENCE input is positive and the reason is 1024, 32 or
//   0 (ScienceTransmission, VesselRecovery, None), banks it into a PRIVATE
//   double, fires Confidence.OnConfidenceChanged, and ratchets a second private
//   double confidenceEarned on a positive delta only.
//
//   RP0.KCTUtilities.ProcessSciPointTotalChange moves
//   SpaceCenterManagement.SciPointsTotal off the same event with NO reason
//   filter at all. That total is the curve input the confidence award is priced
//   from, so it is the second derived quantity, not a separate concern.
//
// The interceptor's neutralise is ResearchAndDevelopment.SetScience, and neither
// stock nor RP-1 fires any currency event from SetScience/SetFunds/
// SetReputation. So RP-1 is never told to revisit what it derived, and this arm
// is what tells it.
namespace GonogoRp1Uplink
{
    /// <summary>
    /// RP-1's arm of the <c>"derivedCurrency"</c> capability: keeps confidence
    /// withheld for exactly as long as the science it was derived from is.
    ///
    /// <para><b>What it does not do.</b> It does not re-derive RP-1's price and it
    /// enqueues nothing for the reveal. The award is OBSERVED either side of RP-1
    /// banking it and the pre-award reading is put back, so the numbers are exact
    /// whatever RP-1's curve says. At reveal, <c>RevealApplier</c> calls
    /// <c>AddScience(base, TransactionReasons.None)</c>, RP-1 accepts reason 0, and
    /// RP-1 prices the award itself - once, and against the career the operator
    /// actually has when the science lands, which is the price the operator should
    /// be charged rather than one frozen at earn time.</para>
    ///
    /// <para><b>Only an increase is ever taken away.</b> A confidence spend
    /// landing between the observation and the withhold is a real withdrawal, and
    /// putting a pre-spend reading back would hand it to the player. So each
    /// quantity is restored only where the live value sits ABOVE what was
    /// observed.</para>
    ///
    /// <para><b>The event is fired.</b> RP-1's own confidence readout is a text
    /// label pushed from <c>Confidence.OnConfidenceChanged</c> and updated by
    /// nothing else in the shipped assembly, so a balance corrected silently in
    /// the field would leave the leaked figure on the operator's screen. The state
    /// would be right and the leak would still be there to read.</para>
    ///
    /// <para>Nothing here touches KSP or Unity, so it compiles and runs headless
    /// against the stand-in graph in <c>Rp0Fixture</c>.</para>
    /// </summary>
    public sealed class Rp1DerivedCurrencyWithholder : IDerivedCurrencyWithholder
    {
        private const string ConfidenceTypeName = "RP0.Confidence";
        private const string ScmTypeName = "RP0.SpaceCenterManagement";
        private const string ConfidenceChangedEventName = "OnConfidenceChanged";

        private readonly Type? _confidenceType;
        private readonly Type? _scmType;

        /// <summary>The UT the reading below was taken at, and the only UT it may be put back at.</summary>
        private double _observedUt;

        private bool _observedConfidence;
        private double _preConfidence;
        private double _preEarned;

        private bool _observedSciPoints;
        private double _preSciPoints;

        public Rp1DerivedCurrencyWithholder()
        {
            _confidenceType = Rp1Types.Find(ConfidenceTypeName);
            _scmType = Rp1Types.Find(ScmTypeName);
        }

        public string ProviderId => "rp1";

        /// <summary>
        /// Where a report goes, on top of the counters below. Assignable so the
        /// headless suite can read what was said; this file references no Unity
        /// assembly and <c>IUplinkHost</c> carries no logger, so the counters are
        /// the destination that actually reaches an operator.
        /// </summary>
        public Action<string> Report { get; set; } = _ => { };

        /// <summary>
        /// How many times a withhold could not be carried out, and what the last one
        /// said. Surfaced as health facts by <see cref="Rp1ScUplink"/> rather than
        /// left to a log nobody reads: every one of these is a science credit whose
        /// derived confidence is STILL credited, which is the leak, and a fix whose
        /// only failure signal is a swallowed exception is a fix that reports itself
        /// working.
        /// </summary>
        public int WithholdFailures { get; private set; }

        public string? LastWithholdFailure { get; private set; }

        /// <summary>Whether RP-1's confidence model resolved at all, for the uplink's health facts.</summary>
        public bool Available => _confidenceType != null;

        public void ObserveBeforeDerivation(string primaryCurrency, double ut)
        {
            // Science only. RP-1 prices its confidence award off the query's
            // science input and reads nothing else, and SciPointsTotal moves on
            // the science total alone, so a neutralised funds or reputation change
            // derives nothing here.
            if (!IsScience(primaryCurrency))
            {
                return;
            }

            _observedUt = ut;
            _observedConfidence = false;
            _observedSciPoints = false;

            var confidence = Instance(_confidenceType);
            if (confidence != null)
            {
                var current = Rp1Types.ReadDouble(confidence, "confidence");
                var earned = Rp1Types.ReadDouble(confidence, "confidenceEarned");
                if (current.HasValue && earned.HasValue)
                {
                    _preConfidence = current.Value;
                    _preEarned = earned.Value;
                    _observedConfidence = true;
                }
                else
                {
                    // The fields resolved before and do not now, which is a
                    // renamed member on RP-1's side rather than an absent mod. Say
                    // so: the withhold that follows will do nothing, and doing
                    // nothing quietly is how the leak reports itself fixed.
                    Fail("[Gonogo] RP-1 confidence fields did not read, so a delayed science credit's "
                        + "confidence will NOT be withheld (confidence="
                        + Describe(current) + ", confidenceEarned=" + Describe(earned) + ")");
                }
            }

            var scm = Instance(_scmType);
            if (scm != null)
            {
                var points = Rp1Types.ReadDouble(scm, "SciPointsTotal");
                if (points.HasValue)
                {
                    _preSciPoints = points.Value;
                    _observedSciPoints = true;
                }
            }
        }

        public void WithholdDerived(string primaryCurrency, double baseAmount, double ut)
        {
            if (!IsScience(primaryCurrency))
            {
                return;
            }

            if (_confidenceType == null && _scmType == null)
            {
                // No RP-1 at all. Nothing derives anything, and there is nothing to
                // report every time a stock career transmits.
                return;
            }

            if (!_observedConfidence && !_observedSciPoints)
            {
                // Nothing was read at any UT. On an RP-1 install with no career
                // loaded that is simply the state of things, so it is only worth
                // saying when a model IS live.
                if (Instance(_confidenceType) != null || Instance(_scmType) != null)
                {
                    Fail("[Gonogo] a delayed science credit of " + baseAmount.ToString("0.###")
                        + " was neutralised with no pre-derivation reading of RP-1's confidence, so "
                        + "whatever RP-1 derived from it is STILL credited");
                }
                return;
            }

            if (_observedUt != ut)
            {
                // Restoring an older reading would erase a currency movement that
                // had nothing to do with this change. Refuse, loudly.
                Fail("[Gonogo] a delayed science credit of " + baseAmount.ToString("0.###")
                    + " was neutralised at UT " + ut.ToString("0.###")
                    + " but RP-1's confidence was last read at UT " + _observedUt.ToString("0.###")
                    + ", so nothing was withheld and the derived confidence is STILL credited");
                return;
            }

            RestoreConfidence();
            RestoreSciPoints();
        }

        /// <summary>
        /// Puts both halves of the confidence balance back, then tells RP-1's own
        /// readout. Idempotent: a second call finds the live value already at the
        /// observed one, writes nothing, and fires nothing, which is what one earn
        /// reaching the interceptor through two game events needs.
        /// </summary>
        private void RestoreConfidence()
        {
            if (!_observedConfidence)
            {
                return;
            }

            var instance = Instance(_confidenceType);
            if (instance == null)
            {
                return;
            }

            var liveEarned = Rp1Types.ReadDouble(instance, "confidenceEarned");
            if (liveEarned.HasValue && liveEarned.Value > _preEarned
                && !Rp1Types.WriteDouble(instance, "confidenceEarned", _preEarned))
            {
                Fail("[Gonogo] RP-1's confidenceEarned would not take a value, so the lifetime total "
                    + "still shows a delayed science credit that has not arrived");
            }

            var live = Rp1Types.ReadDouble(instance, "confidence");
            if (!live.HasValue || live.Value <= _preConfidence)
            {
                return;
            }

            if (!Rp1Types.WriteDouble(instance, "confidence", _preConfidence))
            {
                Fail("[Gonogo] RP-1's confidence balance would not take a value, so the derived "
                    + "confidence from a delayed science credit is STILL credited");
                return;
            }

            FireConfidenceChanged(_preConfidence);
        }

        private void RestoreSciPoints()
        {
            if (!_observedSciPoints)
            {
                return;
            }

            var instance = Instance(_scmType);
            if (instance == null)
            {
                return;
            }

            var live = Rp1Types.ReadDouble(instance, "SciPointsTotal");
            if (live.HasValue && live.Value > _preSciPoints)
            {
                Rp1Types.WriteDouble(instance, "SciPointsTotal", _preSciPoints);
            }
        }

        /// <summary>
        /// Fires <c>Confidence.OnConfidenceChanged</c> with the restored balance, so
        /// RP-1's push-updated readout stops showing the withheld figure. The reason
        /// is the enum's zero (<c>TransactionReasons.None</c>), read off the event's
        /// own second parameter rather than named, because the ordinal is KSP's
        /// business and the only subscriber in the shipped assembly ignores it.
        /// </summary>
        private void FireConfidenceChanged(double balance)
        {
            if (_confidenceType == null)
            {
                return;
            }

            try
            {
                var evt = Rp1Types.StaticValue(_confidenceType, ConfidenceChangedEventName);
                if (evt == null)
                {
                    return;
                }

                MethodInfo? fire = null;
                foreach (var candidate in evt.GetType().GetMethods(BindingFlags.Public | BindingFlags.Instance))
                {
                    if (candidate.Name != "Fire")
                    {
                        continue;
                    }
                    var parameters = candidate.GetParameters();
                    if (parameters.Length == 2 && parameters[0].ParameterType == typeof(double))
                    {
                        fire = candidate;
                        break;
                    }
                }

                if (fire == null)
                {
                    return;
                }

                var reasonType = fire.GetParameters()[1].ParameterType;
                var reason = reasonType.IsEnum
                    ? Enum.ToObject(reasonType, 0)
                    : (reasonType.IsValueType ? Activator.CreateInstance(reasonType) : null);
                fire.Invoke(evt, new[] { (object)balance, reason });
            }
            catch (Exception ex)
            {
                // The balance is already back; a readout that did not get the news
                // is a lesser fault than a throw out of the neutralise path.
                Fail("[Gonogo] RP-1's confidence readout was not told the balance went back: " + ex.Message);
            }
        }

        /// <summary>Records a failure where the uplink's health can carry it, then passes it on.</summary>
        private void Fail(string message)
        {
            WithholdFailures++;
            LastWithholdFailure = message;
            Report(message);
        }

        private static bool IsScience(string primaryCurrency) =>
            string.Equals(primaryCurrency, DerivedCurrencyCapability.Science, StringComparison.Ordinal);

        private static object? Instance(Type? type) =>
            type == null ? null : Rp1Types.StaticValue(type, "Instance");

        private static string Describe(double? value) =>
            value.HasValue ? value.Value.ToString("0.###") : "absent";
    }
}
