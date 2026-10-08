# sketch26

Work in progress: an entry for the [Qloo Agentic Hackathon](https://qloo.devpost.com/)
(submission deadline 30 October 2026, 23:45 Eastern Time).

The concept, run instructions and live demo link will be added here as the
build takes shape.

## How this is built

This project is built with AI assistance (Claude). Commits authored by
`Claude <noreply@anthropic.com>` were written by the model and reviewed by the
repository owner.

## Development

Requires Node 22.

```bash
npm install
npm run typecheck
npm test            # offline unit tests with hand-written fixtures
npm run dev:local   # local server without Cloudflare credentials
npm run dev         # local server with the Workers AI binding (needs a Cloudflare login)
```

### Secrets

No secret is stored in this repository.

| Secret | Where the repository owner sets it | Used for |
| --- | --- | --- |
| `QLOO_API_KEY` | Cloudflare dashboard, Worker settings, Variables and Secrets | Server-side calls to the Qloo API at runtime |
| `QLOO_API_KEY` | GitHub, Settings, Secrets and variables, Actions | The manual "Live smoke" workflow |
| `ANTHROPIC_API_KEY` (optional) | Cloudflare dashboard, same place | Uses the Anthropic API instead of Workers AI |
| `CLOUDFLARE_API_TOKEN` (optional) | GitHub, Settings, Secrets and variables, Actions | Lets the "Deploy" workflow publish on pushes to `main` |

For local runs, copy `.env.example` to `.dev.vars` and fill it in. That file is ignored by git.

### Checking the live Qloo API

The build workspace cannot reach the Qloo API, so live checks run in GitHub
Actions: open the Actions tab, choose "Live smoke", and press "Run workflow".
It prints status codes, timings and result counts only, never response data.

### Layout

- `src/index.ts`: the Worker and its `/api` routes.
- `src/qloo/`: typed Qloo client, query serialisation, private cache, errors.
- `src/llm/`: provider interface with Workers AI, Anthropic and a test mock.
- `public/`: the static frontend served by the Worker.
- `test/`: offline tests. Fixtures are invented and only mirror response shapes.

## Licence

MIT. See [LICENSE](LICENSE).
