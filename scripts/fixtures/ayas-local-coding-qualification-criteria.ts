/**
 * Owner protocol v3 (2026-10-15): behavioral acceptance criteria for the frozen local-coding cases, written the way a
 * task author states required behavior. Rules: observable behavior and the public contract names other code relies on
 * (fact keys, exported functions, error codes, statuses); no code, implementation steps or algorithms; no evaluator test
 * inputs. smoke-ayas-local-coding-specified-vault checks mechanically that no criterion carries the start of any line
 * the historical fix adds or of any frozen evaluator line, nor any hidden case identity. The author knew the historical
 * fixes; that check stops copied code, not paraphrased intent. The frozen vault and its objectives are unchanged.
 */
export const AYAS_LOCAL_CODING_ACCEPTANCE_CRITERIA: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "historical-explicit-computer-plan": Object.freeze([
    "A memory record of kind \"decision\" whose text says the user decided to buy, assemble or set up a computer (desktop, laptop, notebook or PC wording counts; for example \"yeni bir dizüstü bilgisayar almaya karar verdim\") must carry the exclusive fact key user.decision.computer-purchase-plan.",
    "A decision or note that only mentions a computer without deciding to acquire one (for example cleaning its disk or recording its RAM size), and any preference, must not receive that fact key.",
    "A later explicit purchase decision supersedes the earlier one; unrelated decisions, notes and preferences stay current, the records themselves are never rewritten, and the result is the same after the store is reloaded.",
    "Fact values are limited to 40 characters. Different purchase statements must produce different values even when they share a long common beginning.",
    "Only explicit, reported user statements can move this slot: a purchase decision recorded with inferred confidence must not supersede an explicit plan.",
    "Existing facts (identity, response-length and voice-length preferences) keep their current behavior.",
  ]),
  "heldout-render-tool-supersession": Object.freeze([
    "A decision whose whole normalized statement is \"render için <tool> kullanacağız\", optionally preceded by \"artık\", carries the exclusive fact key user.decision.render-tool with the tool name, folded to lower case like other memory text, as its value.",
    "Records already stored with a temporal block but without a fact key must still yield this render-tool fact when their fact is read, provided the record is an explicit, reported user statement or explicit correction. Reading must never modify the records.",
    "Between two such decisions the later one is current and the earlier one is superseded by it. A current question about the render tool selects only the later record, while an as-of question for a time before the later decision selects the earlier one.",
    "Statements inferred by AYAS must not fill or move the render-tool slot.",
    "Existing facts, including the computer purchase plan, keep their current behavior.",
  ]),
  "historical-atomic-bounded-write": Object.freeze([
    "applyAyasBoundedFileReplacements must commit each file atomically: write the new content to a fresh temporary file in the same directory, then replace the target with fs.renameSync. The target is never written in place.",
    "If committing a later file fails (for example its rename throws), every file already committed in the same call is restored to its original content, or removed if it was newly created, and the original error is rethrown.",
    "Files that were not committed yet stay untouched, a rollback never overwrites a file that someone else changed further, and temporary files are removed whether or not the commit succeeded.",
    "Keep the existing preconditions and errors: expected-hash and allowCreate checks, the all-or-nothing preflight, rollback when after() fails, and the AyasBoundedFileWriteError codes.",
    "Allowed paths must not escape the repository: besides the existing lexical checks, refuse with AYAS_BOUNDED_WRITE_PATH_DENIED any path whose existing directory or file component is a symbolic link or junction, or resolves outside the repository root.",
  ]),
  "historical-daily-development-view": Object.freeze([
    "In buildAyasApprovalInboxView, the history list keeps a proposal only if it was created on the current Istanbul calendar day (the same boundary istanbulDay uses) or its status still needs action: APPROVED, RESERVED or RECOVERY_REQUIRED.",
    "Terminal records from earlier days, such as COMPLETED or STALE, disappear from this main history projection, while today's terminal records remain visible.",
    "The pending list is unchanged: a PENDING proposal from an earlier day is still listed as pending.",
    "This is a read-only projection: the durable state passed in must not be modified, and the today and pending lists keep their current rules.",
  ]),
  "historical-two-source-identity-retrieval": Object.freeze([
    "Identity statements are recognized for names that start with a letter and continue with letters, digits, apostrophes or hyphens (for example \"Benim adım Kaan42\" or \"ben Deniz'im\"), both when candidates are extracted and when the identity value is read during retrieval. A question such as \"benim adım ne\" is still not a statement.",
    "When explicit, reported user identity declarations (user-preference records tagged kimlik and titled \"Kullanıcı kimliği / hitap tercihi\") name different people, retrieval for a name question selects the one with the latest valid observedAt and quarantines the others.",
    "If the competing declarations share the same latest observedAt, all of them stay quarantined as conflicting-fact: the conflict fails closed.",
    "Newest-wins applies only to identity and only among equally trusted explicit user declarations: an inferred, web or external-shaped, or instruction-injected record never overrides an explicit one, and a declaration observed more than five minutes after the current time is ignored for this ordering.",
    "Everything else keeps its current behavior: other domains still fail closed on conflicts, and corrupt stores still degrade safely.",
  ]),
});
