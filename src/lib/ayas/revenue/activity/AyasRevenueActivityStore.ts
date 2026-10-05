/** Explicit offline root; no production writer or adapter binding. GET/read never creates storage. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureSafeContainedDirectory, requireContainedRealDirectory } from "../../../runtime/RuntimeStoragePaths";
import { withAyasExecutionAuthorityLock, AyasExecutionAuthorityLockError } from "../../../brain/autonomy/AyasExecutionAuthorityLock";
import { assertAyasSafeModeAllowsMutation } from "../../safety/AyasSafeModeReader";
import { AYAS_REVENUE_ACTIVITY_MAX_BYTES, AyasRevenueActivityError, emptyAyasRevenueActivity, planAyasRevenueActivityAppend, snapshotAyasRevenueActivityInput, validateAyasRevenueActivity, type AyasRevenueActivityState } from "./AyasRevenueActivity";
export class AyasRevenueActivityStore {
  private readonly root: string; private readonly directory: string; private readonly file: string;
  constructor(root: string, private readonly now: () => string = () => new Date().toISOString()) {
    try { this.root = requireContainedRealDirectory(path.resolve(root), path.resolve(root), true); }
    catch { throw new AyasRevenueActivityError("STORAGE_UNSAFE"); }
    this.directory = path.join(this.root, "data", "brain", "revenue", "activity"); this.file = path.join(this.directory, "history.json");
  }
  private check(): boolean {
    try {
      requireContainedRealDirectory(this.root, this.root, true);
      for (const p of [path.join(this.root, "data"), path.join(this.root, "data", "brain"), path.join(this.root, "data", "brain", "revenue"), this.directory]) {
        try { fs.lstatSync(p); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
        requireContainedRealDirectory(this.root, p);
      }
      return true;
    } catch { throw new AyasRevenueActivityError("STORAGE_UNSAFE"); }
  }
  read(): AyasRevenueActivityState {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!this.check()) return emptyAyasRevenueActivity();
      let s: fs.Stats;
      try { s = fs.lstatSync(this.file); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyAyasRevenueActivity(); throw new AyasRevenueActivityError("STORAGE_IO"); }
      if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > AYAS_REVENUE_ACTIVITY_MAX_BYTES) throw new AyasRevenueActivityError("STORAGE_UNSAFE");
      let fd: number | undefined;
      try {
        fd = fs.openSync(this.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); const opened = fs.fstatSync(fd);
        if (!opened.isFile() || opened.nlink > 1 || opened.size > AYAS_REVENUE_ACTIVITY_MAX_BYTES) throw new AyasRevenueActivityError("STORAGE_UNSAFE");
        if (opened.nlink === 0 || opened.ino !== s.ino || opened.dev !== s.dev) continue;
        const text = fs.readFileSync(fd, "utf8"); if (Buffer.byteLength(text) > AYAS_REVENUE_ACTIVITY_MAX_BYTES) throw new AyasRevenueActivityError("STORAGE_UNSAFE");
        return validateAyasRevenueActivity(JSON.parse(text));
      } catch (e) { if (e instanceof AyasRevenueActivityError) throw e; throw new AyasRevenueActivityError("INVALID_HISTORY"); }
      finally { if (fd !== undefined) fs.closeSync(fd); }
    }
    throw new AyasRevenueActivityError("REVISION_CONFLICT");
  }
  async append(raw: unknown) {
    const input = snapshotAyasRevenueActivityInput(raw), at = this.now();
    if (!input) throw new AyasRevenueActivityError("INVALID_INPUT");
    const before = this.read(), initial = planAyasRevenueActivityAppend(before, input, at);
    if (initial.kind === "REPLAY") return initial;
    assertAyasSafeModeAllowsMutation(this.root);
    try {
      ensureSafeContainedDirectory(this.root, this.directory); const execution = ensureSafeContainedDirectory(this.root, path.join(this.directory, "execution")), lock = path.join(execution, ".authority-lock");
      if (fs.existsSync(lock)) requireContainedRealDirectory(this.root, lock);
      return await withAyasExecutionAuthorityLock(this.directory, async () => {
        assertAyasSafeModeAllowsMutation(this.root); this.check(); requireContainedRealDirectory(this.root, execution); requireContainedRealDirectory(this.root, lock);
        const current = this.read(), planned = planAyasRevenueActivityAppend(current, input, at);
        if (planned.kind === "REPLAY") return planned;
        const bytes = JSON.stringify(planned.state, null, 2) + "\n";
        if (Buffer.byteLength(bytes) > AYAS_REVENUE_ACTIVITY_MAX_BYTES) throw new AyasRevenueActivityError("CAPACITY");
        const temporary = path.join(this.directory, ".activity-" + randomUUID() + ".tmp"); let fd: number | undefined;
        try {
          fd = fs.openSync(temporary, "wx", 0o600); fs.writeFileSync(fd, bytes, "utf8"); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
          assertAyasSafeModeAllowsMutation(this.root); this.check();
          if (JSON.stringify(this.read()) !== JSON.stringify(current)) throw new AyasRevenueActivityError("REVISION_CONFLICT");
          fs.renameSync(temporary, this.file);
        } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        return planned;
      }, { acquireRetryLimit: 250, acquireRetryDelayMs: 20 });
    } catch (e) {
      if (e instanceof AyasRevenueActivityError || e instanceof Error && /^AYAS_SAFE_/.test(e.message)) throw e;
      if (e instanceof AyasExecutionAuthorityLockError && e.code === "AYAS_LOCK_BUSY") throw new AyasRevenueActivityError("LOCK_BUSY");
      throw new AyasRevenueActivityError("STORAGE_IO");
    }
  }
}
