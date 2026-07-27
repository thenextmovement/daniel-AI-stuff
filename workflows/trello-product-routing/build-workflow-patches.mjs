#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WORKFLOW_IDS, patchWorkflowById } from "./product-routing.mjs";

const [inputDir, outputDir] = process.argv.slice(2);
if (!inputDir || !outputDir) {
  throw new Error("Usage: node build-workflow-patches.mjs <snapshot-dir> <output-dir>");
}

await mkdir(outputDir, { recursive: true });
for (const workflowId of Object.values(WORKFLOW_IDS)) {
  const inputPath = path.join(inputDir, `${workflowId}.json`);
  const parsed = JSON.parse(await readFile(inputPath, "utf8"));
  const workflow = parsed.data || parsed;
  const patched = patchWorkflowById(workflowId, workflow);
  if (workflowId !== WORKFLOW_IDS.quotingAgent && patched.nodes.length !== workflow.nodes.length) {
    throw new Error(`${workflowId}: unexpected node-count change`);
  }
  if (workflowId === WORKFLOW_IDS.quotingAgent && patched.nodes.length > 30) {
    throw new Error(`${workflowId}: patched workflow exceeds 30 nodes`);
  }
  const outputPath = path.join(outputDir, `${workflowId}.patched.json`);
  await writeFile(outputPath, `${JSON.stringify({
    id: workflowId,
    name: patched.name,
    nodes: patched.nodes,
    connections: patched.connections,
    settings: patched.settings,
  }, null, 2)}\n`);
  process.stdout.write(`${workflowId}: ${workflow.nodes.length} -> ${patched.nodes.length} nodes\n`);
}
