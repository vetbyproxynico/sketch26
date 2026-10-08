#!/usr/bin/env node
import { DEFAULT_PORT, startFakeQloo } from './lib/fake-qloo-server.mjs';

/*
 * `npm run fake-qloo`: starts the stand-in for the Qloo hackathon API on
 * 127.0.0.1:8799. Everything it serves is invented (see lib/fake-qloo-server.mjs).
 * Point the Worker at it with QLOO_BASE_URL, as `npm run dev:fake` does.
 *
 *   node scripts/fake-qloo.mjs [--port 8799] [--delay 0] [--quiet]
 *
 * The port can also be set with FAKE_QLOO_PORT. Press Ctrl-C to stop.
 */

const USAGE = `Usage: node scripts/fake-qloo.mjs [--port ${DEFAULT_PORT}] [--delay 0] [--quiet]

  --port N    port to listen on, on 127.0.0.1 only (default ${DEFAULT_PORT}; 0 picks a free one)
  --delay MS  wait this long before every answer, to watch the trace panel fill
  --quiet     do not print a line for each request
`;

/** The value after `--name`, or undefined. */
function option(args, name) {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? undefined : args[at + 1];
}

function whole(text, name, fallback) {
  if (text === undefined) return fallback;
  const number = Number(text);
  if (!Number.isInteger(number) || number < 0 || number > 65535) {
    console.error(`--${name} must be a whole number from 0 to 65535.\n\n${USAGE}`);
    process.exit(2);
  }
  return number;
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const port = whole(option(args, 'port') ?? process.env.FAKE_QLOO_PORT, 'port', DEFAULT_PORT);
const delayMs = whole(option(args, 'delay'), 'delay', 0);
const quiet = args.includes('--quiet');

try {
  const server = await startFakeQloo({ port, delayMs, ...(quiet ? {} : { log: (line) => console.log(line) }) });
  console.log(`Stand-in Qloo is listening on ${server.url}. Everything it serves is invented.`);
  console.log(`Run the Worker against it with QLOO_BASE_URL=${server.url} and any non-empty QLOO_API_KEY (npm run dev:fake does this).`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  const reason = error instanceof Error && 'code' in error && error.code === 'EADDRINUSE' ? `port ${port} is already in use` : 'it could not start';
  console.error(`The stand-in Qloo could not start: ${reason}. Try --port with another number.`);
  process.exit(1);
}
