using System;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The one place that decides which vessel gonogo reports as active. Every
    /// telemetry-scoped read and every "the vessel" command in this assembly goes
    /// through <see cref="Current"/> instead of <c>FlightGlobals.ActiveVessel</c>.
    ///
    /// <para>KSP's answer and gonogo's answer differ in exactly one situation, and
    /// it is the situation this seam exists for. When a kerbal steps out, KSP makes
    /// the EVA kerbal the active vessel, and every active-vessel-scoped topic
    /// collapses onto a one-part craft with no antenna, no action groups, no
    /// resources and no maneuver plan. The ship is still up there and still the
    /// thing mission control is watching, so this keeps reporting it.</para>
    ///
    /// <para><c>FlightGlobals.ActiveVessel</c> keeps its authority everywhere else.
    /// This does not second-guess a vessel switch, a dock or an undock, and the
    /// substitution lasts exactly as long as the EVA: a kerbal boarding ANY craft
    /// ends it, so that transition is indistinguishable on the wire from the
    /// operator switching craft normally.</para>
    ///
    /// <para>The relation is held by <see cref="EvaParentage"/> and recorded off
    /// <c>GameEvents.onCrewOnEva</c>: stock has no back-reference from a kerbal to
    /// the craft they left, so the egress event is the only carrier there is.
    /// <see cref="EvaParentagePersistence"/> puts it in the save, so a quickload
    /// mid-EVA does not lose it.</para>
    ///
    /// <para><b>Callable off the main thread</b>, and it has to be: it is read from
    /// channel mappers running on the Courier thread as well as from the
    /// main-thread capture. Every read below is a plain managed field or list on a
    /// game object, never a native accessor, and null is tested with
    /// <see cref="object.ReferenceEquals"/> rather than Unity's <c>==</c> overload,
    /// which calls into native to ask whether the object is alive. The book is
    /// mutated from event handlers on the main thread while a mapper reads it, so
    /// every touch of it is under <see cref="Gate"/>.</para>
    /// </summary>
    public static class ActiveVesselScope
    {
        private static readonly object Gate = new object();
        private static readonly EvaParentage Parentage = new EvaParentage();
        private static bool _hooked;

        /// <summary>The kerbal-to-craft relations, for the scenario module that saves them.</summary>
        internal static EvaParentage Book => Parentage;

        /// <summary>
        /// The vessel gonogo reports as active: whatever KSP is flying, except that
        /// a kerbal on EVA reports as the craft they stepped out of for as long as
        /// that craft is still in the world.
        ///
        /// <para>Null when there is no flight, and null rather than an exception
        /// when <c>FlightGlobals.fetch</c> has not been built yet - stock's own
        /// <c>ActiveVessel</c> dereferences it unguarded, and this is called from
        /// scenes where it may not be there.</para>
        /// </summary>
        public static Vessel? Current
        {
            get
            {
                var fetch = FlightGlobals.fetch;
                if (ReferenceEquals(fetch, null))
                {
                    return null;
                }

                var active = fetch.activeVessel;
                if (ReferenceEquals(active, null))
                {
                    return null;
                }

                Vessel? parent = null;
                Guid? reported;
                lock (Gate)
                {
                    reported = Parentage.Reported(
                        active.id,
                        active.isEVA,
                        id =>
                        {
                            parent = FindLiving(id);
                            return !ReferenceEquals(parent, null);
                        });
                }

                if (reported == null || reported.Value == active.id)
                {
                    return active;
                }

                // Only reachable when the probe above found the craft, so parent is
                // the vessel the rule named. Falling back to the kerbal rather than
                // returning null keeps the seam total: a caller never has to handle
                // "gonogo lost the vessel" on top of "there is no flight".
                return parent ?? active;
            }
        }

        /// <summary>
        /// Subscribes to the three events the relation rides on. Idempotent, and
        /// called from <see cref="KspHost"/>'s constructor so it shares that
        /// object's process lifetime rather than a scene's - a scene-scoped hook
        /// would miss the egress that happens while it is being torn down.
        /// </summary>
        public static void Hook()
        {
            if (_hooked)
            {
                return;
            }

            GameEvents.onCrewOnEva.Add(OnCrewOnEva);
            GameEvents.onCrewBoardVessel.Add(OnCrewBoardVessel);
            GameEvents.onVesselDestroy.Add(OnVesselDestroy);
            _hooked = true;
        }

        /// <summary>Unsubscribes. GameEvents are static, so a leaked subscription outlives the host.</summary>
        public static void Unhook()
        {
            if (!_hooked)
            {
                return;
            }

            GameEvents.onCrewOnEva.Remove(OnCrewOnEva);
            GameEvents.onCrewBoardVessel.Remove(OnCrewBoardVessel);
            GameEvents.onVesselDestroy.Remove(OnVesselDestroy);
            _hooked = false;
        }

        /// <summary>
        /// Drops every recorded relation. Called when a different save is loaded:
        /// the incoming save's own relations arrive through
        /// <see cref="EvaParentagePersistence.Load"/>, and a kerbal from the
        /// outgoing one is not in this world.
        /// </summary>
        public static void Reset()
        {
            lock (Gate)
            {
                Parentage.Clear();
            }
        }

        /// <summary>Records the relation. See <see cref="EvaParentage"/> for why this event is the only carrier.</summary>
        internal static void RecordEgress(Guid kerbalVesselId, Guid parentVesselId)
        {
            lock (Gate)
            {
                Parentage.RecordEgress(kerbalVesselId, parentVesselId);
            }
        }

        /// <summary>
        /// <c>from</c> is the part the kerbal left, <c>to</c> is the kerbal
        /// (decompile-confirmed against <c>FlightEVA</c>, which fires this before
        /// it switches the active vessel, so the relation is recorded ahead of the
        /// switch it has to survive). <c>from</c> is null on stock's own debug
        /// spawn, which has no craft behind it; that kerbal reports as themselves.
        /// </summary>
        private static void OnCrewOnEva(GameEvents.FromToAction<Part, Part> action)
        {
            try
            {
                var parent = PartVessel(action.from);
                var kerbal = PartVessel(action.to);
                if (ReferenceEquals(parent, null) || ReferenceEquals(kerbal, null))
                {
                    return;
                }

                RecordEgress(kerbal!.id, parent!.id);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] recording an EVA egress failed: " + ex);
            }
        }

        /// <summary>
        /// <c>from</c> is the kerbal, <c>to</c> is the craft they entered - which KSP
        /// lets be any airlock they were touching, not necessarily the one they left.
        /// The relation is dropped either way and the craft entered is NOT recorded:
        /// the substitution lasts exactly as long as the EVA, and what KSP makes
        /// active next is reported as-is. A kerbal walking into a different craft is
        /// a routine vessel switch and must be indistinguishable from one.
        /// </summary>
        private static void OnCrewBoardVessel(GameEvents.FromToAction<Part, Part> action)
        {
            try
            {
                var kerbal = PartVessel(action.from);
                if (!ReferenceEquals(kerbal, null))
                {
                    lock (Gate)
                    {
                        Parentage.Forget(kerbal!.id);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] clearing an EVA relation on boarding failed: " + ex);
            }
        }

        /// <summary>
        /// Drops the relation for a vessel leaving the world, from either end: a
        /// kerbal who died out there, or the craft they left. The liveness probe in
        /// <see cref="EvaParentage.Reported"/> catches the craft case anyway, this
        /// just means the roster is not walked for a craft already known to be gone.
        /// </summary>
        private static void OnVesselDestroy(Vessel vessel)
        {
            try
            {
                if (!ReferenceEquals(vessel, null))
                {
                    lock (Gate)
                    {
                        Parentage.Forget(vessel.id);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] clearing an EVA relation on vessel destruction failed: " + ex);
            }
        }

        private static Vessel? PartVessel(Part? part) =>
            ReferenceEquals(part, null) ? null : part!.vessel;

        /// <summary>
        /// The vessel with this id, if it is still in the world. <c>state</c> is a
        /// plain managed field, so a DEAD vessel KSP has not yet removed from the
        /// roster is excluded without asking Unity whether the object is alive.
        /// </summary>
        private static Vessel? FindLiving(Guid id)
        {
            var fetch = FlightGlobals.fetch;
            var all = ReferenceEquals(fetch, null) ? null : fetch.vessels;
            if (all == null)
            {
                return null;
            }

            for (var i = 0; i < all.Count; i++)
            {
                var vessel = all[i];
                if (!ReferenceEquals(vessel, null) && vessel.id == id && vessel.state != Vessel.State.DEAD)
                {
                    return vessel;
                }
            }

            return null;
        }
    }
}
