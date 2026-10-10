/**
 * One-at-a-time order for the owner's write actions on the Development
 * Centre's durable ledgers (`approval-inbox.json`, `micro-batch-inbox.json`).
 *
 * The one-click publications (ONAYLA VE UYGULA, BATCH ONAYLA VE UYGULA, an
 * executing owner APPROVE) now run in a worker process
 * (`AyasOwnerPublicationWorker`), so the server keeps answering chat, the
 * phone and the Access health probe while one runs. Before that move the
 * blocked event loop was what kept two writers apart. This queue keeps that
 * guarantee explicitly: every owner write action in this server process runs
 * after the previous one has finished, and a display refresh skips its
 * lifecycle-only STALE write while one is running, so the server never
 * rewrites a ledger file the worker is in the middle of updating.
 *
 * Process-local on purpose, like `PipelineJobMutationLock`: it orders the
 * writers inside this server. It holds no state of its own and spawns
 * nothing. The state lives on `globalThis`, so every bundle that imports this
 * module shares one queue.
 */

interface AyasOwnerPublicationQueueState {
  tail: Promise<void>;
  running: number;
}

const queueKey = Symbol.for("atolye.ayas.ownerPublicationQueue.v1");

function queueState(): AyasOwnerPublicationQueueState {
  const holder = globalThis as typeof globalThis & { [queueKey]?: AyasOwnerPublicationQueueState };
  holder[queueKey] ??= { tail: Promise.resolve(), running: 0 };
  return holder[queueKey];
}

/** Runs `work` after every owner write action queued before it has settled, whatever its outcome. */
export function withAyasOwnerPublicationExclusive<T>(work: () => Promise<T>): Promise<T> {
  const state = queueState();
  const run = state.tail.then(async () => {
    state.running += 1;
    try {
      return await work();
    } finally {
      state.running -= 1;
    }
  });
  state.tail = run.then(() => undefined, () => undefined);
  return run;
}

/** True while an owner write action of this process is running. */
export function isAyasOwnerPublicationRunning(): boolean {
  return queueState().running > 0;
}
