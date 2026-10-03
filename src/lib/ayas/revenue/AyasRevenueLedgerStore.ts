/** Stage 16.2: explicit-root, offline ledger storage. No production binding, credentials or payment executor. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureSafeContainedDirectory, requireContainedRealDirectory } from "../../runtime/RuntimeStoragePaths";
import { withAyasExecutionAuthorityLock, AyasExecutionAuthorityLockError } from "../../brain/autonomy/AyasExecutionAuthorityLock";
import { assertAyasSafeModeAllowsMutation } from "../safety/AyasSafeModeReader";
import { AYAS_REVENUE_LEDGER_MAX_BYTES, AYAS_REVENUE_LEDGER_MAX_ENTRIES, AyasRevenueLedgerError, createAyasRevenueLedgerEntry,
  emptyAyasRevenueLedger, planAyasRevenueLedgerAppend, validateAyasRevenueLedgerState, type AyasRevenueLedgerEntry, type AyasRevenueLedgerState } from "./AyasRevenueLedger";

export interface AyasRevenueLedgerStoreOptions { readonly maxEntries?: number; readonly now?: () => string }
export interface AyasRevenueLedgerAppendResult { readonly status: "APPENDED" | "REPLAY"; readonly revision: number; readonly entry: AyasRevenueLedgerEntry; readonly grantsAuthority: false }
export class AyasRevenueLedgerStore {
  private readonly repoRoot: string;
  private readonly ledgerRoot: string;
  private readonly file: string;
  private readonly maxEntries: number;
  private readonly now: () => string;
  /** Caller must select the checkout explicitly; tests use an owned TEMP checkout. No arbitrary ledger filename. */
  constructor(repoRoot: string, options: AyasRevenueLedgerStoreOptions = {}) {
    try { this.repoRoot = requireContainedRealDirectory(path.resolve(repoRoot), path.resolve(repoRoot), true); }
    catch { throw new AyasRevenueLedgerError("STORAGE_UNSAFE"); }
    this.ledgerRoot = path.join(this.repoRoot, "data", "brain", "revenue"); this.file = path.join(this.ledgerRoot, "ledger.json");
    this.maxEntries = options.maxEntries ?? AYAS_REVENUE_LEDGER_MAX_ENTRIES;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1 || this.maxEntries > AYAS_REVENUE_LEDGER_MAX_ENTRIES) throw new AyasRevenueLedgerError("INVALID_INPUT");
    this.now = options.now ?? (() => new Date().toISOString());
  }
  /** Check every existing ancestor without creating it. Missing directories and ledger are write-free empty reads. */
  private checkRoot(): boolean {
    try {
      requireContainedRealDirectory(this.repoRoot, this.repoRoot, true);
      for (const target of [path.join(this.repoRoot, "data"), path.join(this.repoRoot, "data", "brain"), this.ledgerRoot]) {
        try { fs.lstatSync(target); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
        requireContainedRealDirectory(this.repoRoot, target);
      }
      return true;
    } catch { throw new AyasRevenueLedgerError("STORAGE_UNSAFE"); }
  }
  read(): AyasRevenueLedgerState {
    // An atomic publisher can replace a regular canonical file between lstat/open/fstat.
    // Retry that identity race only; links, non-files, excessive bytes and malformed history still refuse.
    for (let attempt = 0; attempt < 3; attempt++) {
    if (!this.checkRoot()) return emptyAyasRevenueLedger();
    let stat: fs.Stats;
    try { stat = fs.lstatSync(this.file); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyAyasRevenueLedger(); throw new AyasRevenueLedgerError("STORAGE_IO"); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > AYAS_REVENUE_LEDGER_MAX_BYTES) throw new AyasRevenueLedgerError("STORAGE_UNSAFE");
    let fd: number | undefined;
    try {
      fd = fs.openSync(this.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink > 1 || opened.size > AYAS_REVENUE_LEDGER_MAX_BYTES) throw new AyasRevenueLedgerError("STORAGE_UNSAFE");
      if (opened.nlink === 0 || opened.ino !== stat.ino || opened.dev !== stat.dev) continue;
      const bytes = fs.readFileSync(fd, "utf8");
      if (Buffer.byteLength(bytes) > AYAS_REVENUE_LEDGER_MAX_BYTES) throw new AyasRevenueLedgerError("STORAGE_UNSAFE");
      let raw: unknown; try { raw = JSON.parse(bytes); } catch { throw new AyasRevenueLedgerError("INVALID_LEDGER"); }
      return validateAyasRevenueLedgerState(raw);
    } catch (e) { if (e instanceof AyasRevenueLedgerError) throw e; throw new AyasRevenueLedgerError("STORAGE_IO"); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    }
    throw new AyasRevenueLedgerError("REVISION_CONFLICT");
  }
  async append(raw: unknown): Promise<AyasRevenueLedgerAppendResult> {
    // Freeze the caller input before any await: the committed fact cannot change while a lock is pending.
    const candidate = createAyasRevenueLedgerEntry(raw, this.now()), before = this.read();
    const early = planAyasRevenueLedgerAppend(before, candidate);
    const result = (status: "APPENDED" | "REPLAY", revision: number, entry: AyasRevenueLedgerEntry): AyasRevenueLedgerAppendResult => Object.freeze({ status, revision, entry, grantsAuthority: false });
    if (early.kind === "REPLAY") return result("REPLAY", before.revision, early.entry);
    if (before.entries.length >= this.maxEntries) throw new AyasRevenueLedgerError("CAPACITY");
    assertAyasSafeModeAllowsMutation(this.repoRoot);
    try {
      ensureSafeContainedDirectory(this.repoRoot, this.ledgerRoot);
      const executionRoot = ensureSafeContainedDirectory(this.repoRoot, path.join(this.ledgerRoot, "execution"));
      const lockDir = path.join(executionRoot, ".authority-lock");
      if (fs.existsSync(lockDir)) requireContainedRealDirectory(this.repoRoot, lockDir);
      return await withAyasExecutionAuthorityLock(this.ledgerRoot, async () => {
        assertAyasSafeModeAllowsMutation(this.repoRoot); this.checkRoot();
        requireContainedRealDirectory(this.repoRoot, executionRoot); requireContainedRealDirectory(this.repoRoot, lockDir);
        const current = this.read(), plan = planAyasRevenueLedgerAppend(current, candidate);
        if (plan.kind === "REPLAY") return result("REPLAY", current.revision, plan.entry);
        if (current.entries.length >= this.maxEntries) throw new AyasRevenueLedgerError("CAPACITY");
        const next = validateAyasRevenueLedgerState({ schemaVersion: "1", revision: current.revision + 1, entries: [...current.entries, candidate] });
        const bytes = `${JSON.stringify(next, null, 2)}\n`;
        if (Buffer.byteLength(bytes) > AYAS_REVENUE_LEDGER_MAX_BYTES) throw new AyasRevenueLedgerError("CAPACITY");
        const pending = path.join(this.ledgerRoot, `.ledger-${randomUUID()}.tmp`);
        let fd: number | undefined;
        try {
          fd = fs.openSync(pending, "wx", 0o600); fs.writeFileSync(fd, bytes, "utf8"); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
          assertAyasSafeModeAllowsMutation(this.repoRoot); this.checkRoot();
          if (JSON.stringify(this.read()) !== JSON.stringify(current)) throw new AyasRevenueLedgerError("REVISION_CONFLICT");
          fs.renameSync(pending, this.file);
        } finally {
          if (fd !== undefined) fs.closeSync(fd);
          // Only this invocation's unpublished UUID path; canonical financial history is never deleted.
          if (fs.existsSync(pending)) fs.unlinkSync(pending);
        }
        return result("APPENDED", next.revision, candidate);
      }, { acquireRetryLimit: 250, acquireRetryDelayMs: 20 });
    } catch (e) {
      if (e instanceof AyasRevenueLedgerError || (e instanceof Error && /^AYAS_SAFE_/.test(e.message))) throw e;
      if (e instanceof AyasExecutionAuthorityLockError && e.code === "AYAS_LOCK_BUSY") throw new AyasRevenueLedgerError("LOCK_BUSY");
      throw new AyasRevenueLedgerError("STORAGE_IO");
    }
  }
}
