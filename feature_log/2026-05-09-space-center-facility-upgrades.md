# Space Center Status — facility upgrades

- **Date:** 2026-05-09
- **Commit:** `1cae0a7`
- **Validation:** ⏳ pending — landed and tested in CI; the plugin upgrade pipeline is the riskiest piece and has not been exercised against a live SpaceCenter scene.

## Why

The Space Center Status widget showed current facility levels (from the existing `kc.facilityLevels`). It didn't show the *cost* of the next upgrade or expose a way to trigger one. Each upgrade still required diving into KSP's stock SC scene UI.

This entry was written retroactively — the work shipped during the 2026-05-09 Telemachus-extension push.

## Plugin changes

In `mod/GonogoTelemetry/src/KscApi.cs`:

- `kc.facilityLevels` entries now include `upgradeFunds` — the next-tier cost — read from `Upgradeables.UpgradeableObject.UpgradeLevels[].funds`. `0` means unknown / at max. Sandbox + non-SC scenes return 0 rather than throwing.
- `kc.upgradeFacility[shortName]` — new write action. Refuses outside the SpaceCenter scene, refuses on insufficient funds, refuses at max tier. Goes through the `Defer` queue so KSP's scene-coupled `SetCurrentLevel` doesn't fire on the WS thread.
- Funds deduction is **explicit** via `TransactionReasons.StructureConstruction`. KSP's `SetCurrentLevel` alone does not always charge the player — this is a known stock quirk.

## Widget changes

In `packages/components/src/SpaceCenterStatus/index.tsx`:

- Per-facility row now shows next-tier cost.
- Arm-then-confirm Upgrade button per row. Disabled outside the SpaceCenter scene, when funds are insufficient, or at max tier (replaced with a `MAX` badge).
- `dataRequirements` grew `kc.scene` + `career.funds` so the widget can scope/gate the button correctly.

## Risk

The plugin upgrade pipeline is the load-bearing piece. KSP's stock upgrade flow runs through SC dialogs / animations / payment hooks. Bypassing them with `SetCurrentLevel` + `AddFunds` may diverge in subtle ways — funds may be charged twice, or an upgrade may "succeed" mechanically but leave KSP in an inconsistent visual state.

## Files

```
mod/GonogoTelemetry/src/KscApi.cs                        (upgradeFunds + upgradeFacility action)
packages/components/src/SpaceCenterStatus/index.tsx      (cost + upgrade button)
packages/components/src/SpaceCenterStatus/index.test.tsx (added coverage for new button states)
```

## Outstanding

- Live verify: from a career save with funds, upgrade a facility via the widget and confirm KSP's stock view matches afterwards. Watch for double-charging or stale-funds drift.
- Once the fork-migration `KscDataLinkHandler` (2026-05-10) takes precedence, confirm the upgradeFunds field is still emitted — the fork rewrite needs to mirror this exposure.
