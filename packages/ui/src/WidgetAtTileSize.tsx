import type {
  ComponentDefinition,
  ComponentProps,
  TinyMode,
} from "@ksp-gonogo/sitrep-sdk";
import { showsTiny, TinyEssentials } from "@ksp-gonogo/ui-kit";

/**
 * A registered widget's content at its current size: the widget's tiny form
 * where it declares one and the tile is smaller than its `minSize`, its own
 * component otherwise. Draws the widget's own component while the tile is
 * unmeasured. A widget whose tiny mode sets `staysMounted` is always drawn
 * through its own component, which draws the tiny form itself. Used by the dashboard grid, the pushed dashboard overlay and the
 * widget render harnesses.
 */
export function WidgetAtTileSize({
  def,
  ...props
}: ComponentProps & { def: ComponentDefinition }) {
  if (
    def.tiny !== undefined &&
    def.tiny.staysMounted !== true &&
    showsTiny(def, props.w, props.h)
  ) {
    return <TinyForm tiny={def.tiny} props={props} />;
  }
  const Widget = def.component;
  return <Widget {...props} />;
}

/* A component of its own so the widget's essentials hook is not skipped when a resize crosses the tiny threshold. */
function TinyForm({ tiny, props }: { tiny: TinyMode; props: ComponentProps }) {
  return (
    <TinyEssentials
      title={tiny.title}
      essentials={tiny.useEssentials(props)}
      equalRows={tiny.equalRows}
    />
  );
}
