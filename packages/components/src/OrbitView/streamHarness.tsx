import {
  emitScenario,
  type OrbitScenario,
  type RenderStreamResult,
  renderOrbitStream,
} from "../test/orbitScenario";
import { OrbitViewComponent } from "./index";

/** OrbitView mounted on the shared orbit-stream fixture, which every trajectory-drawing widget is driven from. */

export { emitScenario, type OrbitScenario, type RenderStreamResult };

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
