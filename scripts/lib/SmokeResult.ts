export function emitSmokeResult(suite: string, scenarios: number | string): void {
  process.stdout.write(`ATOLYE_SMOKE_RESULT ${JSON.stringify({ status: "PASS", suite, scenarios })}\n`);
}
