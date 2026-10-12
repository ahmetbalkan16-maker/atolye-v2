import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stageNativeDescriptionAnswers } from "./graphify-grounded-descriptions.mjs";

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"graphify-native-"));
try {
  fs.writeFileSync(path.join(temporary,"batch-000.md"),'# Native request\n- "a": source\n');
  fs.writeFileSync(path.join(temporary,"batch-001.md"),'# Native request\n- "unknown": source\n');
  assert.throws(()=>stageNativeDescriptionAnswers(temporary,{a:"Verified source fact."}),/UNVERIFIED_ID/);
  assert(!fs.existsSync(path.join(temporary,"batch-000.json")),"all batches validated before mutation");
  fs.writeFileSync(path.join(temporary,"batch-001.md"),'# Native request\n- "b": source\n');
  const answers={a:"Verified source fact.",b:"Other verified source fact."};
  assert.deepEqual(stageNativeDescriptionAnswers(temporary,answers),{batches:2,nodes:2});
  assert.deepEqual(stageNativeDescriptionAnswers(temporary,answers),{batches:2,nodes:2},"idempotent exact answers");
  fs.writeFileSync(path.join(temporary,"batch-001.json"),'{"b":"Conflicting answer"}');
  assert.throws(()=>stageNativeDescriptionAnswers(temporary,answers),/CONFLICT/);
  assert.equal(fs.readFileSync(path.join(temporary,"batch-001.json"),"utf8"),'{"b":"Conflicting answer"}');
  console.log("Graphify native answer staging: PASS (all-batch validation, exact IDs, idempotence, conflict preserved)");
} finally {
  if(path.dirname(fs.realpathSync.native(temporary))!==fs.realpathSync.native(os.tmpdir())) throw new Error("NATIVE_STAGING_CLEANUP_SCOPE");
  fs.rmSync(temporary,{recursive:true,force:true});
}
