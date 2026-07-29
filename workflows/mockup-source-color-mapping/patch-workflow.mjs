import fs from "node:fs";
import { resolveDesignIndexedValue } from "./source-color-mapping.mjs";

export const WORKFLOW_IDS = [
  "T4mdDxLquLMJ6FMl",
  "qRa1lT7lgpoFlgVo",
  "eZg2Dn4yG6rsS79p",
];

const NODE_NAME = "Extract & Validate";
const OLD_LINE =
  "    const requestedLightColor = lightColorsByIndex[p.linkedItemIndex + 1] || titleColor;";
const NEW_LINE =
  "    const requestedLightColor = resolveDesignIndexedValue(lightColorsByIndex, p.linkedItemIndex, designTargets.length) || titleColor;";

const HELPER =
  "\nfunction resolveDesignIndexedValue(valuesByIndex, linkedItemIndex, designCount, fieldSlots = 4) {\n" +
  "  const entries = Object.entries(valuesByIndex || {})\n" +
  "    .map(([index, value]) => ({ index: Number(index), value: String(value || '').trim() }))\n" +
  "    .filter(entry => Number.isInteger(entry.index) && entry.index > 0 && entry.value)\n" +
  "    .sort((left, right) => left.index - right.index);\n" +
  "  if (entries.length === 0) return '';\n\n" +
  "  const safeDesignCount = Math.max(1, Math.min(Number(designCount) || 1, fieldSlots));\n" +
  "  const safeDesignIndex = Math.max(0, Math.min(Number(linkedItemIndex) || 0, safeDesignCount - 1));\n" +
  "  if (safeDesignCount === 1) return entries[0].value;\n\n" +
  "  const rangeStart = Math.floor((safeDesignIndex * fieldSlots) / safeDesignCount) + 1;\n" +
  "  const rangeEnd = Math.floor(((safeDesignIndex + 1) * fieldSlots) / safeDesignCount);\n" +
  "  const grouped = entries.find(entry => entry.index >= rangeStart && entry.index <= rangeEnd);\n" +
  "  if (grouped) return grouped.value;\n\n" +
  "  const direct = entries.find(entry => entry.index === safeDesignIndex + 1);\n" +
  "  return direct ? direct.value : entries[0].value;\n" +
  "}\n";

export function patchWorkflow(workflow) {
  const clone = structuredClone(workflow);
  const node = clone.nodes?.find((candidate) => candidate.name === NODE_NAME);
  if (!node || typeof node.parameters?.jsCode !== "string") {
    throw new Error("Missing " + NODE_NAME + " code node");
  }

  let code = node.parameters.jsCode;
  if (!code.includes("function resolveDesignIndexedValue(")) {
    const anchor = "function normalizeColorText(value) {";
    if (!code.includes(anchor)) throw new Error("Color helper insertion anchor missing");
    code = code.replace(anchor, HELPER + "\n" + anchor);
  }

  if (code.includes(OLD_LINE)) {
    code = code.replace(OLD_LINE, NEW_LINE);
  } else if (!code.includes(NEW_LINE)) {
    throw new Error("Expected legacy color mapping line missing");
  }

  node.parameters.jsCode = code;
  return clone;
}

export function assertProductionFixture() {
  const values = { 1: "Warmweiß", 2: "Warmweiß", 3: "Orange", 4: "Orange" };
  return [
    resolveDesignIndexedValue(values, 0, 2),
    resolveDesignIndexedValue(values, 1, 2),
  ];
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    throw new Error("Usage: node patch-workflow.mjs input.json output.json");
  }
  const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const patched = patchWorkflow(source);
  fs.writeFileSync(outputPath, JSON.stringify(patched, null, 2) + "\n");
}

