/**
 * Fails the run when a test did not execute.
 *
 * Vitest exits 0 on a skipped test, so "green" and "everything ran" are two
 * different statements. On a developer's machine that is fine — the DynamoDB
 * suites skipping without the container is deliberate ergonomics. On a runner it
 * is not: a suite that skips itself, or an `it.skip` left in a commit, quietly
 * stops protecting anything while the badge stays green.
 *
 * Vitest already covers the symmetrical mistake — `allowOnly` defaults to
 * `!process.env.CI`, so a stray `it.only` fails CI on its own. This covers the
 * other half.
 *
 *   vitest run --reporter=json --outputFile.json=<path>
 *   node scripts/assert-no-skipped-tests.mjs <path>
 */

import { readFile } from "node:fs/promises";

const REPORT = process.argv[2] ?? "vitest-report.json";

let report;
try {
  report = JSON.parse(await readFile(REPORT, "utf8"));
} catch (error) {
  console.error(
    `Cannot read the Vitest report at "${REPORT}": ${error.message}\n` +
      "It is written by `vitest run --reporter=json --outputFile.json=<path>`.",
  );
  process.exit(1);
}

// A file that fails to load never reaches this script — the test command exits
// non-zero first — so every test here is one Vitest actually considered.
const notRun = report.testResults.flatMap((file) =>
  file.assertionResults
    .filter((test) => test.status === "skipped" || test.status === "todo")
    .map((test) => `${test.fullName} [${test.status}]`),
);

if (notRun.length > 0) {
  console.error(`${notRun.length} test(s) did not run:\n`);
  for (const name of notRun) console.error(`  · ${name}`);
  console.error(
    "\nA skipped test on a runner is a guarantee nobody is checking any more.\n" +
      "If these are the DynamoDB suites, the container was not reachable: see the\n" +
      "`dynamodb` service and the wait step in .github/workflows/ci.yml.",
  );
  process.exit(1);
}

console.log(`All ${report.numPassedTests} tests ran. None skipped.`);
