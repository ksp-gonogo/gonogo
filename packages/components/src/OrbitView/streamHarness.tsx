import {
  emitScenario,
  type OrbitScenario,
  type RenderStreamResult,
  renderOrbitStream,
  VESSEL_STATE_INPUTS,
} from "../test/orbitScenario";
import { OrbitViewComponent } from "./index";

/**
 * OrbitView mounted on the shared orbit-stream fixture.
 * OrbitView reads exclusively off the SDK stream, `vessel.orbit` (raw elements)
 * and the `vessel.state` derived channel: so every test drives it through a
 * real `TelemetryProvider`/`TimelineStore` via `setupStreamFixture` rather than
 * the retired legacy `MockDataSource` path.
 *
 * The scenario emitter itself lives in `test/orbitScenario` because the widgets
 * that draw a trajectory must all be drivable from the same one; see there.
 */

export {
  emitScenario,
  type OrbitScenario,
  type RenderStreamResult,
  VESSEL_STATE_INPUTS,
};

export function renderOrbitViewStream(
  size: { w: number; h: number },
  scenario?: OrbitScenario,
  instanceId = "orbitview-stream",
): RenderStreamResult {
  return renderOrbitStream(
    <OrbitViewComponent id={instanceId} w={size.w} h={size.h} />,
    scenario,
    instanceId,
  );
}
