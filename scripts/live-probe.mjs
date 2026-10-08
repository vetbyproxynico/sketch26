#!/usr/bin/env node
// Live probe for the Qloo hackathon API. Run by the "Live probe" GitHub
// workflow, because only GitHub Actions (not the cloud build workspace) can
// reach the API. Makes every kind of call Encore makes, checks each answer
// against what src/encore/qloo/adapter.ts assumes, and checks whether Qloo has
// data for older and non-US culture.
//
// The log is public once the repository is, and Qloo response data must not be
// published, so the output is limited to field names, JSON types, counts,
// statuses, timings and our own labels. See docs/LIVE_PROBE.md and
// scripts/lib/probe-run.mjs. Exit code 1 only when a call fails outright.

import { BASE_URL, runProbe } from './lib/probe-run.mjs';

const apiKey = (process.env.QLOO_API_KEY ?? '').trim();
if (!apiKey) {
  const message =
    'QLOO_API_KEY is not set. Add it as a repository secret: ' +
    'Settings > Secrets and variables > Actions > New repository secret, name QLOO_API_KEY. ' +
    'Locally, export QLOO_API_KEY before running this script.';
  console.error(process.env.GITHUB_ACTIONS ? `::error title=QLOO_API_KEY missing::${message}` : message);
  process.exit(1);
}

try {
  const outcome = await runProbe({ apiKey, baseUrl: BASE_URL, github: Boolean(process.env.GITHUB_ACTIONS) });
  process.exitCode = outcome.exitCode;
} catch (error) {
  // Never print error.message: it can quote part of a response body. The name and stack frames are safe.
  const frames = String(error?.stack ?? '')
    .split('\n')
    .filter((line) => line.trim().startsWith('at '))
    .slice(0, 5);
  console.error(`The probe stopped unexpectedly (${error?.name ?? 'error'}). This is a fault in the probe, not in the API.`);
  for (const frame of frames) console.error(frame);
  process.exitCode = 1;
}
