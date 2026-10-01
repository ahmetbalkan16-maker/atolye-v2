import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { containsBrainSecret } from "../BrainRedaction";
import {
  AYAS_DURABLE_TASK_ID,
  AYAS_DURABLE_TASK_MAX_JSON_BYTES,
  AyasDurableTaskError,
  ayasDurableCanonicalJson,
  replayAyasDurableTask,
  sealAyasDurableTaskEvent,
  type AyasDurableTaskEvent,
  type AyasDurableTaskEventBody,
  type AyasDurableTaskState,
} from "./AyasDurableTask";

/**
 * Stage 15B — the append-only event journal under the durable task contract.
 *
 *   <root>/durable-tasks/<taskId>/events/<8-digit sequence>.json
 *
 * One file per event, never rewritten and never deleted by this module.
 *  - **Append-once.** An event is written to a temp file, synced, then
 *    published with an exclusive hard link. If that sequence already exists
 *    the link fails and the caller gets `SEQUENCE_CONFLICT`: of two daemons
 *    racing for the same step, exactly one records it.
 *  - **Never torn.** A crash before the link leaves only an ignored temp
 *    file; a published event is always complete.
 *  - **Corrupt is loud.** A gap, an unparseable file, an edited event or a
 *    broken digest chain throws. A damaged journal is never read as a
 *    shorter history, because that could run a recorded step again.
 *  - **Validated before written.** A candidate event is replayed on top of
 *    the existing history first; the contract refuses an illegal one before
 *    any byte reaches the disk.
 *  - **Reject on leak.** An event whose content looks like a secret or an
 *    absolute user path is refused, not masked.
 *
 * The journal runs nothing. It only records what a caller says happened.
 */
export interface AyasDurableTaskJournalOptions {
  /** Defaults to `data/brain/autonomy` under the working directory. Tests must pass a TEMP directory. */
  readonly rootDir?: string;
  readonly now?: () => Date;
}

export interface AyasDurableTaskJournal {
  readonly dir: string;
  /** Task IDs that have a journal directory, sorted. */
  list(): readonly string[];
  /** The complete event list, validated. Empty if the task was never created. */
  read(taskId: string): readonly AyasDurableTaskEvent[];
  /** The replayed state, or `undefined` if the task was never created. */
  load(taskId: string): AyasDurableTaskState | undefined;
  /** Appends one event after `expectedSequence` (0 creates the task) and returns the new state. */
  append(taskId: string, expectedSequence: number, body: AyasDurableTaskEventBody): AyasDurableTaskState;
}

const EVENT_FILE = /^\d{8}\.json$/;
function fail(code: AyasDurableTaskError["code"], message: string): never { throw new AyasDurableTaskError(code, message); }

export function createAyasDurableTaskJournal(options: AyasDurableTaskJournalOptions = {}): AyasDurableTaskJournal {
  const dir = path.join(path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "autonomy")), "durable-tasks");
  const now = options.now ?? (() => new Date());
  const eventsDir = (taskId: string): string => {
    if (!AYAS_DURABLE_TASK_ID.test(taskId)) fail("AYAS_DURABLE_TASK_CONTRACT_INVALID", "task ID is malformed");
    return path.join(dir, taskId, "events");
  };

  const read = (taskId: string): readonly AyasDurableTaskEvent[] => {
    const folder = eventsDir(taskId);
    let names: string[];
    try { names = fs.readdirSync(folder).filter((name) => EVENT_FILE.test(name)).sort(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      return fail("AYAS_DURABLE_TASK_IO", `cannot list ${folder}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const events = names.map((name, index) => {
      if (Number.parseInt(name, 10) !== index + 1) fail("AYAS_DURABLE_TASK_JOURNAL_CORRUPT", `task ${taskId} journal has a gap before ${name}`);
      try { return JSON.parse(fs.readFileSync(path.join(folder, name), "utf8")) as unknown; }
      catch (error) { return fail("AYAS_DURABLE_TASK_JOURNAL_CORRUPT", `task ${taskId} event ${name} is unreadable: ${error instanceof Error ? error.message : String(error)}`); }
    });
    if (events.length > 0) replayAyasDurableTask(events);
    return events as AyasDurableTaskEvent[];
  };

  return {
    dir,
    list() {
      try { return fs.readdirSync(dir).filter((name) => AYAS_DURABLE_TASK_ID.test(name)).sort(); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        return fail("AYAS_DURABLE_TASK_IO", `cannot list ${dir}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    read,
    load(taskId) {
      const events = read(taskId);
      return events.length === 0 ? undefined : replayAyasDurableTask(events);
    },
    append(taskId, expectedSequence, body) {
      const folder = eventsDir(taskId);
      const events = read(taskId);
      if (events.length !== expectedSequence) fail("AYAS_DURABLE_TASK_SEQUENCE_CONFLICT", `task ${taskId} is at sequence ${events.length}, not ${expectedSequence}`);
      const event = sealAyasDurableTaskEvent(taskId, events.at(-1), now().toISOString(), body);
      let state: AyasDurableTaskState;
      try { state = replayAyasDurableTask([...events, event]); }
      catch (error) {
        // The stored history just replayed cleanly, so a malformed-event finding here is about the candidate.
        if (error instanceof AyasDurableTaskError && error.code === "AYAS_DURABLE_TASK_JOURNAL_CORRUPT") fail("AYAS_DURABLE_TASK_ILLEGAL_EVENT", error.message);
        throw error;
      }
      if (containsBrainSecret(ayasDurableCanonicalJson(body))) fail("AYAS_DURABLE_TASK_SECRET_REFUSED", `task ${taskId} event carries secret-like or absolute-path content`);
      const bytes = `${JSON.stringify(event, null, 2)}\n`;
      // A task definition may hold up to 32 bounded steps; every other event is one bounded value.
      if (body.type !== "TASK_CREATED" && Buffer.byteLength(bytes, "utf8") > 2 * AYAS_DURABLE_TASK_MAX_JSON_BYTES) fail("AYAS_DURABLE_TASK_CONTRACT_INVALID", `task ${taskId} event is too large`);

      const file = path.join(folder, `${String(event.sequence).padStart(8, "0")}.json`);
      const tmp = path.join(folder, `.${event.sequence}.${process.pid}.${crypto.randomUUID()}.tmp`);
      try {
        fs.mkdirSync(folder, { recursive: true });
        const fd = fs.openSync(tmp, "wx");
        try { fs.writeFileSync(fd, bytes, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.linkSync(tmp, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("AYAS_DURABLE_TASK_SEQUENCE_CONFLICT", `task ${taskId} sequence ${event.sequence} was recorded by another writer`);
        fail("AYAS_DURABLE_TASK_IO", error instanceof Error ? error.message : String(error));
      } finally {
        try { fs.rmSync(tmp, { force: true }); } catch { /* an ignored temp file is harmless */ }
      }
      return state;
    },
  };
}
