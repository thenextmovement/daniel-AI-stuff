import test from "node:test";
import assert from "node:assert/strict";
import {readMcpReply} from "../src/dhl-pilot-transport.js";
test("personal proxy reads JSON and stateless SSE responses without dropping tools",async()=>{
 const reply={jsonrpc:"2.0",id:1,result:{tools:[{name:"dhl_prepare_preview"}]}};
 assert.deepEqual(await readMcpReply(Response.json(reply)),reply);
 assert.deepEqual(await readMcpReply(new Response('event: message\ndata: '+JSON.stringify(reply)+'\n\n',{headers:{"content-type":"text/event-stream"}})),reply);
 await assert.rejects(readMcpReply(new Response('event: message\ndata: invalid\n\n',{headers:{"content-type":"text/event-stream"}})));
});
