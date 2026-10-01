import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHANNELS, validateTexts, type Texts } from "@/lib/ops/social-studio/studio-contract";
import { postTimeLabel, type Delivery } from "@/lib/ops/social-studio/studio-state";

const captions = Object.fromEntries([
  ...CHANNELS.map((c) => [c, c === "ig" ? "techHAUS als Leuchtreklame. ✨\n\nTürkis und Magenta auf dunklem Stein.\n\n#Leuchtreklame #NEONTRIP" : "Ein leuchtendes Schild. https://anfrage.neontrip.de"]),
  ["pinterestTitle", "Leuchtreklame techHAUS"],
]) as Texts;

test("Instagram captions accept paragraphs and emoji without a URL; other platform contracts remain unchanged", () => {
  assert.equal(validateTexts(captions).ig, captions.ig);
  assert.throws(() => validateTexts({ ...captions, ig: captions.ig + " https://anfrage.neontrip.de" }), /ohne URL/);
  assert.throws(() => validateTexts({ ...captions, ig: captions.ig + " https://unknown.invalid" }), /ohne URL/);
  assert.throws(() => validateTexts({ ...captions, fb: "Ein leuchtendes Schild." }), /Anfragelink/);
  assert.throws(() => validateTexts({ ...captions, fb: captions.fb + " ✨" }), /Symbole/);
  assert.throws(() => validateTexts({ ...captions, ig: "Für unseren Kunden ist dieses Schild montiert." }), /Kundenreferenz/);
});

test("published card uses actual completion time even after Buffer Publish Now; scheduled cards keep their booking", () => {
  const due_at = "2026-10-02T09:30:00.000Z";
  const deliveries = [
    { status: "sent", sent_at: "2026-10-01T12:09:25.680Z" },
    { status: "sent", sent_at: "2026-10-01T12:10:08.286Z" },
  ] as Delivery[];
  assert.match(postTimeLabel({status:"sent",due_at,deliveries}), /01\.10\.2026.*14:10/);
  assert.match(postTimeLabel({status:"scheduled",due_at,deliveries}), /02\.10\.2026.*11:30/);
  assert.equal(postTimeLabel({status:"sent",due_at,deliveries:[]}), "Veröffentlichungszeit noch nicht bestätigt");
});

const source = readFileSync(new URL("../../docs/operations/social-studio-gateway-code.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const prepare = (body: object) => new AsyncFunction("$json", source)({body});
const gallery = "a6fcaf89bc13b514ea5a6c4f147ed73534b9084d24decaa7001df1766c3c7e45";
const due = new Date(Date.now()+86400000).toISOString();
const publish = {action:"publish",id:gallery,channel:"ig",text:captions.ig,dueAt:due,imageUrl:"https://klibiejfisijpagzkxls.supabase.co/storage/v1/object/public/social-media-posts/dashboard/"+gallery+"/portrait.jpg"};

test("existing gateway publish and edit accept link-free Instagram captions without relaxing other channels or future-slot validation", async () => {
  const result = await prepare(publish);
  assert.equal(result[0].json.body.variables.input.text,captions.ig);
  assert.equal(result[0].json.body.variables.input.metadata.instagram.isAiGenerated,false);
  const edit=await prepare({action:"edit",id:gallery,bufferId:"existing-post-123",channel:"ig",operation:"schedule",text:captions.ig,dueAt:due});
  assert.equal(edit[0].json.body.variables.input.id,"existing-post-123");
  await assert.rejects(prepare({...publish,text:captions.ig+" https://anfrage.neontrip.de"}),/Invalid text/);
  await assert.rejects(prepare({...publish,channel:"fb",text:captions.ig}),/Invalid text/);
  await assert.rejects(prepare({...publish,dueAt:new Date().toISOString()}),/Future slot/);
});

test("Gemini request asks for human Instagram captions while keeping confirmed project facts and other platforms bounded", async () => {
  const result=await prepare({action:"generate",id:gallery,name:"techHAUS",image:"AAAA"});
  const prompt=result[0].json.body.systemInstruction.parts[0].text;
  assert.match(prompt,/Instagram enthält KEINE URL/);
  assert.match(prompt,/2-3 kurzen Absätzen/);
  assert.match(prompt,/1-2 passende Emojis/);
  assert.match(prompt,/bestätigten Projektdaten/);
  assert.match(prompt,/Facebook, LinkedIn, Pinterest und Google Business müssen exakt/);
});
