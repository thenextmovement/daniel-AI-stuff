import { pathToFileURL } from "node:url";

export const removedNodeNames = [
  "Lookup Previous RIESEN Inquiries",
  "Lookup RIESEN Offer History",
  "Build RIESEN AutoReply Prompt",
  "OpenAI RIESEN Copy Proposal",
  "Validate and Render RIESEN AutoReply",
];

export const waitNode = {
  id: "rofp-wait-six-minutes",
  name: "Wait 6 Minutes Before AutoReply",
  type: "n8n-nodes-base.wait",
  typeVersion: 1.1,
  position: [5040, -160],
  parameters: {
    resume: "timeInterval",
    amount: 6,
    unit: "minutes",
    options: {},
  },
};

export const operations = [
  {
    type: "removeConnection",
    source: "Record Notification Result",
    target: "Respond Lead Accepted",
  },
  ...removedNodeNames.map((nodeName) => ({ type: "removeNode", nodeName })),
  {
    type: "addNode",
    node: waitNode,
  },
  {
    type: "updateNode",
    nodeName: "Send Customer AutoReply",
    updates: {
      "parameters.html": "={{ $('Normalize & Validate Submission').item.json.autoReplyHtml }}",
    },
  },
  {
    type: "addConnection",
    source: "Send Internal Lead Notification",
    target: "Respond Lead Accepted",
  },
  {
    type: "addConnection",
    source: "Respond Lead Accepted",
    target: "Wait 6 Minutes Before AutoReply",
  },
  {
    type: "addConnection",
    source: "Wait 6 Minutes Before AutoReply",
    target: "Send Customer AutoReply",
  },
];

export const patch = {
  workflowId: "1hRkUxPXUZoYRSgL",
  expectedBaseNodeCount: 29,
  expectedFinalNodeCount: 25,
  removedNodeNames,
  waitNode,
  operations,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(patch));
}
