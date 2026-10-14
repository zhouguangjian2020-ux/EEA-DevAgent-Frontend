import type { MermaidConfig } from "mermaid";

// Text width plus Mermaid's native requirement padding gives 300px-wide boxes.
export const REQUIREMENT_TEXT_WIDTH = 280;

export function requirementDiagramLayout(code: string): MermaidConfig {
  const nativeRequirement = /^\s*requirementDiagram[ \t]*;?\s*$/im.test(code);
  return {
    htmlLabels: true,
    flowchart: { htmlLabels: true, wrappingWidth: REQUIREMENT_TEXT_WIDTH },
    themeCSS: `
      .node .label div {
        width: ${REQUIREMENT_TEXT_WIDTH}px !important;
        min-width: ${REQUIREMENT_TEXT_WIDTH}px !important;
        max-width: ${REQUIREMENT_TEXT_WIDTH}px !important;
        display: block !important;
        white-space: pre-wrap !important;
        overflow-wrap: anywhere !important;
        word-break: normal !important;
        box-sizing: border-box;
        line-height: 1.5 !important;
      }
      ${nativeRequirement ? `
        /* Move the SVG label viewport, not its HTML contents, so Mermaid's
           getBBox() includes the full wrapped height before sizing and routing.
           A child selector also survives standalone SVG image serialization. */
        .node .label > * {
          transform-box: fill-box;
          transform: translateY(calc(50% - .75em));
          overflow: visible;
        }
      ` : ""}
    `,
  };
}
