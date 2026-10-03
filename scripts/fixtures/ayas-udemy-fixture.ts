/** Synthetic connector metadata and wire data. Never an official account or credential observation. */
import { createAyasUdemyAdapter, type AyasUdemyAdapterOptions, type AyasUdemyTransportRequest } from "../../src/lib/ayas/revenue/adapters/udemy/AyasUdemyAdapter";
import { createAyasRevenuePlatformRegistry, runAyasRevenueReadOrDraft } from "../../src/lib/ayas/revenue/AyasRevenuePlatformRegistry";
import { COURSE_NOW, courseDigest, coursePlan } from "./ayas-course-fixture";
export function udemyCourse(id = 51) { return { id, is_paid: true, is_published: false, num_reviews: 8, rating: 4.25, title: "Learner Name", visible_instructors: [{ title: "Person Name", email: "person@example.test" }] }; }
export function udemyThread(id = 21) { return { id, is_read: false, other_user: { title: "Learner Name", email: "student@example.test" }, last_message: { content: "Private learner content", id: 44, user: { email: "student@example.test" } } }; }
export function udemyConnection() { return { schemaVersion: "1", platform: "udemy", accountRef: "udemy-fixture", label: "Fixture instructor", credentialHandling: "CONNECTOR_MANAGED", credentialRef: "connector:udemy-fixture",
  grantedScopes: [] as string[], connectedAt: "2026-10-02T12:00:00.000Z", expiresAt: null as string | null, lastVerifiedAt: COURSE_NOW as string | null, reauthRequired: false }; }
export function udemyRequest(operation = "LISTING_LIST_READ", extra: Record<string, unknown> = {}) { return { requestId: "udemy-test-request", platform: "udemy", operation,
  mode: operation.endsWith("DRAFT") ? "DRAFT" : operation.endsWith("READ") ? "READ" : "EXECUTE", accountRef: "udemy-fixture", requestedAt: COURSE_NOW, ...extra }; }
export const udemySupport = () => ({ kind: "QUESTION_REPLY", targetRefDigest: courseDigest("question"), contextDigest: courseDigest("ephemeral-context"), topicCode: "LESSON_CLARIFICATION", replyText: "Review the worked example in the lesson." });
export const udemyCourseDraft = () => udemyRequest("COURSE_DRAFT", { payload: coursePlan() });
export function udemyFixture(overrides: Partial<AyasUdemyAdapterOptions> = {}) {
  const calls: AyasUdemyTransportRequest[] = [], state = { time: COURSE_NOW, approved: true, free: true, connection: udemyConnection(), answer: { status: 200, headers: {} as Record<string, string>, body: { count: 1, next: null as string | null, results: [udemyCourse()] as unknown[] } } };
  const adapter = createAyasUdemyAdapter({ accountRef: "udemy-fixture", transport: async r => { calls.push(r); return state.answer; }, connection: () => state.connection,
    ownerReadPolicyApproved: () => state.approved, zeroCostQualified: () => state.free, now: () => state.time, ...overrides });
  const registry = createAyasRevenuePlatformRegistry([adapter]);
  return { adapter, calls, state, registry, run: (r = udemyRequest()) => runAyasRevenueReadOrDraft(registry, r, { now: () => state.time }) };
}
