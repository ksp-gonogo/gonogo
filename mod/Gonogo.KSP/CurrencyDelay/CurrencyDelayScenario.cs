using UnityEngine;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// Holds one save's <see cref="CurrencyDelayBooks"/> and forwards the scenario lifecycle
    /// to it: built and started on <c>OnAwake</c>, persisted through <c>OnSave</c>/<c>OnLoad</c>,
    /// ticked every frame and stopped on destroy.
    ///
    /// All pending state lives here, in the persisted scenario module, never a static that
    /// survives scene reloads - so save/load/quicksave/quickload/revert are consistent by
    /// construction: a credit created after a save point simply isn't in the ledger a load
    /// restores.
    ///
    /// Registered for FLIGHT/SPACECENTER/TRACKSTATION - every scene a currency-change event this
    /// subsystem cares about can actually fire in (a vessel earning/transmitting science or funds
    /// in flight, an operator processing a recovery at the Space Center, a delayed credit
    /// maturing while parked at the Tracking Station).
    /// </summary>
    [KSPScenario(ScenarioCreationOptions.AddToAllGames, GameScenes.FLIGHT, GameScenes.SPACECENTER, GameScenes.TRACKSTATION)]
    public sealed class CurrencyDelayScenario : ScenarioModule
    {
        private CurrencyDelayBooks? _books;

        /// <summary>
        /// Builds this save's books and starts them. Always runs before OnLoad, so
        /// OnLoad merges rows into the ledger the interceptor and applier already hold.
        /// </summary>
        public override void OnAwake()
        {
            base.OnAwake();
            _books = new CurrencyDelayBooks();
            _books.Start();
        }

        public override void OnLoad(ConfigNode node)
        {
            base.OnLoad(node);
            _books?.Load(node);
        }

        public override void OnSave(ConfigNode node)
        {
            base.OnSave(node);
            _books?.Save(node);
        }

        private void Update()
        {
            _books?.Tick();
        }

        private void OnDestroy()
        {
            _books?.Stop();
        }
    }
}
