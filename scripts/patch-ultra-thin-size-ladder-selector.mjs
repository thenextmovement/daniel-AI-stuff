// Prepare one bounded update to the existing workflow; this file makes no API calls.
export const workflowId = '7YRFB56vbc4Iem6A';
export const nodeName = 'Select Preparation Card';
export const previousGuard = String.raw`    if (/\b3\s*-?\s*d\b|full\s*-?\s*glow|light\s*-?\s*box|lightbox|leuchtkasten|ultra\s*-?\s*thin/i.test(name)) return false;`;
export const nextGuard = String.raw`    if (/\b3\s*-?\s*d\b|full\s*-?\s*glow/i.test(name)) return false;
    const isUltraThin = /ultra\s*-?\s*thin|(?:led\s+)?leuchtkasten\s+slim|slim\s+led\s+lightbox/i.test(name);
    if (/light\s*-?\s*box|lightbox|leuchtkasten/i.test(name) && !isUltraThin) return false;`;

export function patchUltraThinSelector(source) {
  if (typeof source !== 'string' || source.split(previousGuard).length !== 2) {
    throw new Error('Unexpected live selector; read the active workflow before changing it.');
  }
  return source.replace(previousGuard, nextGuard);
}

export function prepareUltraThinSelectorUpdate(workflow) {
  if (workflow.id !== workflowId) throw new Error('Wrong workflow.');
  const nodes = workflow.nodes.filter(node => node.name === nodeName);
  if (nodes.length !== 1) throw new Error('Expected exactly one preparation selector.');
  const node = nodes[0];
  return { type: 'updateNode', nodeId: node.id, updates: {
    parameters: { ...node.parameters, jsCode: patchUltraThinSelector(node.parameters.jsCode) },
  } };
}
