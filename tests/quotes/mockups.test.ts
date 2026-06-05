import test from "node:test";
import assert from "node:assert/strict";
import { isValidMockupAttachment, selectMockupAttachments } from "../../src/lib/quotes/mockups";

test("isValidMockupAttachment accepts Mockup and MOC AB filenames", () => {
  assert.equal(isValidMockupAttachment({ id: "1", name: "Mockup01.jpg" }), true);
  assert.equal(isValidMockupAttachment({ id: "2", name: "mockup02.png" }), true);
  assert.equal(isValidMockupAttachment({ id: "3", name: "MOC AB 01.jpg" }), true);
  assert.equal(isValidMockupAttachment({ id: "4", name: "moc_ab_02.webp" }), true);
  assert.equal(isValidMockupAttachment({ id: "5", name: "MOCAB03.jpeg" }), true);
  assert.equal(isValidMockupAttachment({ id: "6", name: "Referenzbild.jpg" }), false);
  assert.equal(isValidMockupAttachment({ id: "7", name: "old_mockup.jpg" }), false);
});

test("selectMockupAttachments sorts and limits to four", () => {
  const result = selectMockupAttachments([
    { id: "3", name: "Mockup03.jpg" },
    { id: "1", name: "Mockup01.jpg" },
    { id: "5", name: "Mockup05.jpg" },
    { id: "2", name: "MOC AB 02.jpg" },
    { id: "4", name: "Mockup04.jpg" },
  ]);
  assert.deepEqual(result.map((item) => item.name), [
    "Mockup01.jpg",
    "MOC AB 02.jpg",
    "Mockup03.jpg",
    "Mockup04.jpg",
  ]);
});
