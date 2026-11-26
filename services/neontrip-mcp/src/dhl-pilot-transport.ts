export async function readMcpReply(response:Response){
 if(!response.ok)throw new Error("MCP request failed");
 const text=await response.text();
 if(text.length>5000000)throw new Error("MCP reply too large");
 if(response.headers.get("content-type")?.includes("text/event-stream")){
  const messages=text.split(/\r?\n\r?\n/).filter(Boolean).map(block=>block.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n")).filter(Boolean).map(line=>JSON.parse(line));
  const reply=messages.find(message=>message.id!==undefined);if(!reply)throw new Error("Missing MCP reply");return reply;
 }
 return JSON.parse(text);
}
