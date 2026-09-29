import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { Fragment, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { FramedDisplay } from "./FramedDisplay";
import { Panel } from "./Panel";
import { Section } from "./Section";

function isLone(
  sections: Exclude<ReactNode, boolean> | readonly ReactNode[],
  extra: { fitToSize?: boolean } = {},
) {
  render(<Panel panelTitle="ORBIT" sections={sections} {...extra} />);
  const body = document.querySelector("[data-panel-body]") as HTMLElement;
  return body.hasAttribute("data-panel-lone-frame");
}

describe("Panel lone framed drawing", () => {
  it("marks a body that is one filling section holding only a FramedDisplay", () => {
    expect(
      isLone(
        <Section fill>
          <FramedDisplay>
            <svg aria-hidden="true" />
          </FramedDisplay>
        </Section>,
      ),
    ).toBe(true);
  });

  it("looks through plain elements that each hold only the next", () => {
    expect(
      isLone(
        <Section fill>
          <div>
            <FramedDisplay>
              <svg aria-hidden="true" />
            </FramedDisplay>
          </div>
        </Section>,
      ),
    ).toBe(true);
  });

  it("looks through a fragment holding only the frame", () => {
    expect(
      isLone(
        <Section fill>
          <Fragment key="chart">
            <FramedDisplay>
              <svg aria-hidden="true" />
            </FramedDisplay>
          </Fragment>
        </Section>,
      ),
    ).toBe(true);
  });

  it("does not mark a frame with a readout beside it", () => {
    expect(
      isLone(
        <Section fill>
          <FramedDisplay>
            <svg aria-hidden="true" />
          </FramedDisplay>
          <p>62 m</p>
        </Section>,
      ),
    ).toBe(false);
  });

  it("does not mark a section that does not fill", () => {
    expect(
      isLone(
        <Section>
          <FramedDisplay>
            <svg aria-hidden="true" />
          </FramedDisplay>
        </Section>,
      ),
    ).toBe(false);
  });

  it("does not mark a body with a second section", () => {
    expect(
      isLone([
        <Section key="a" fill>
          <FramedDisplay />
        </Section>,
        <Section key="b">
          <p>legend</p>
        </Section>,
      ]),
    ).toBe(false);
  });

  it("does not mark a fit-to-size body, where a section never fills", () => {
    expect(
      isLone(
        <Section fill>
          <FramedDisplay />
        </Section>,
        { fitToSize: true },
      ),
    ).toBe(false);
  });

  it("does not mark an ordinary body of rows", () => {
    expect(
      isLone(
        <Section title="Stage">
          <p>LF 120</p>
        </Section>,
      ),
    ).toBe(false);
  });
});
