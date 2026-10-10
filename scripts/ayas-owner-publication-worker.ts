// AYAS owner publication worker. Started only by
// `AyasOwnerPublicationWorker.runAyasOwnerPublicationInWorker` inside the Next
// server, for one owner click: it reads one request on stdin, runs the same
// canonical publication service the server action used to run in-process,
// and prints one reply line. See that module's header for why it exists.
// Relative imports only, like every other `scripts/*.ts` entrypoint run
// through plain `tsx`.
import {
  AYAS_OWNER_PUBLICATION_REPLY_PREFIX,
  ayasOwnerPublicationErrorReply,
  parseAyasOwnerPublicationRequest,
  performAyasOwnerPublication,
  type AyasOwnerPublicationReply,
} from "../src/lib/brain/autonomy/AyasOwnerPublicationWorker";

async function readStdin(): Promise<string> {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function main(): Promise<void> {
  let reply: AyasOwnerPublicationReply;
  try {
    reply = { kind: "result", value: await performAyasOwnerPublication(parseAyasOwnerPublicationRequest(await readStdin())) };
  } catch (error) {
    reply = ayasOwnerPublicationErrorReply(error);
  }
  process.stdout.write(`\n${AYAS_OWNER_PUBLICATION_REPLY_PREFIX}${JSON.stringify(reply)}\n`);
  // The reply is the worker's whole job. Anything a library left running must
  // not keep it alive afterwards; the timer itself never does.
  setTimeout(() => process.exit(0), 30_000).unref();
}

main().catch((error) => {
  console.error("AYAS owner publication worker FAILED:", error);
  process.exitCode = 1;
});
