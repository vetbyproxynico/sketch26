# sketch26: notes for build sessions

Entry for the Qloo Agentic Hackathon. Deadline: 30 October 2026, 23:45 Eastern
Time (31 October, 04:45 Paris). Rules: https://qloo.devpost.com/rules

## What the judges require

- A live, working demo application that judges can use free of charge until
  judging ends (16 November 2026). No demo video is required.
- A public repository with all source, assets and run instructions, and an
  open-source licence visible in the About section. This repository stays
  private until submission.
- A text description of features and what makes the project Qloo-powered.
- Qloo must be central: "If your submission would work the same without Qloo,
  you're building the wrong thing."
- Judging criteria, equally weighted: technological implementation (how
  thoroughly and skilfully Qloo is used), design (a complete product, not a
  proof of concept), potential impact, quality of the idea.

## Qloo API (hackathon environment)

- Base URL: `https://hackathon.api.qloo.com`. Staging and production URLs
  return 401 with a hackathon key.
- Auth: `X-Api-Key` request header. Not a query parameter, not a Bearer token.
- Main endpoint: `GET /v2/insights` with query-string parameters;
  `filter.type` is required. POST with a JSON body fails.
- Supported `filter.type`: `urn:entity:artist`, `book`, `brand`, `destination`,
  `movie`, `person`, `place`, `podcast`, `tv_show`, `video_game`.
- Flow: `/search` for entity IDs by name, `/v2/tags` for tag IDs, then pass
  them as `signal.interests.entities`, `signal.interests.tags`,
  `signal.demographics.audiences` or `filter.tags`.
- Do not use `/recommendations` or `/recs`.
- Invalid parameters are ignored silently; an empty `entities` array usually
  means a parameter that is not valid for that `filter.type`.
- Docs: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
  (the docs site refuses automated fetches).

## Hard rules

- Never commit secrets. The key lives in the repository secret `QLOO_API_KEY`
  and in the host's environment settings, both set by the repository owner.
- Never commit Qloo API response data. Private server-side caching is allowed;
  storing responses in a public repository is not. Tests use hand-written
  fixtures that mirror the response shape with invented values.
- The key must stay server-side. The browser never calls Qloo directly.
- The cloud build workspace cannot reach the Qloo API. Exercise live calls
  through GitHub Actions (which can) or through the deployed demo.
- Keep the README honest about AI assistance.
- Verify before calling anything done: tests run, the page loads.
