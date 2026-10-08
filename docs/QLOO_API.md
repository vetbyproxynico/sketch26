# Qloo API reference notes

Compiled on 8 October 2026 from Qloo's own documentation at docs.qloo.com
(pages listed at the end). Only what those pages state is recorded here.
Anything marked "not verified" has not been confirmed against the live API,
because the hackathon key had not arrived when this was written.

## Quick facts

- Base URL for hackathon keys: `https://hackathon.api.qloo.com`
- Auth: request header `X-Api-Key: YOUR_API_KEY`
- `/v2/insights` is a GET request with query-string parameters. The hackathon
  guide says a POST with a JSON body fails, so the POST-only features noted
  below (weights, `*.query` arrays) are unavailable here.
- Parameter names contain dots. Lists are comma-separated.
- Invalid parameters are ignored silently. A 200 with an empty `entities`
  array usually means a parameter that is not valid for the `filter.type`.
- Legacy `/recommendations` and `/recs` are not supported.
- Private server-side caching of responses is allowed. Response data must not
  be stored in a public repository.

## Entity types

Insights `filter.type` values supported in the hackathon:
`urn:entity:artist`, `urn:entity:book`, `urn:entity:brand`,
`urn:entity:destination`, `urn:entity:movie`, `urn:entity:person`,
`urn:entity:place`, `urn:entity:podcast`, `urn:entity:tv_show`,
`urn:entity:video_game`.

Special `filter.type` values on `/v2/insights`:

- `urn:tag`: taste analysis. Returns tags under `results.tags`.
- `urn:demographics`: age and gender affinity for an entity or tag.
- `urn:heatmap`: geographic heatmaps.

Naming trap: the OpenAPI enums for `/search`, `/v2/analysis/compare` and
`/v2/trending` spell the video game type `urn:entity:videogame` (no
underscore), while the hackathon guide lists `urn:entity:video_game` for
Insights. Which spelling each endpoint accepts is not verified.

Search-only legacy types (not valid in Insights): `urn:entity:actor`,
`urn:entity:album`, `urn:entity:author`, `urn:entity:director`,
`urn:entity:locality`.

## GET /search

Find entities by name. Use it to turn names into entity IDs.

| Parameter | Type | Notes |
| --- | --- | --- |
| `query` | string | Text to search for |
| `types` | list | Entity types to search, comma-separated |
| `filter.location` | string | `lat,lon`, a WKT geometry, or a Qloo entity ID |
| `filter.radius` | number | Miles from the location. Default 10, max 100 |
| `filter.exists` | list | For example `external.resy` |
| `filter.tags` | list | Tag IDs |
| `operator.filter.tags` | string | `union` (default) or `intersection` |
| `filter.rating` | number | Minimum business rating, 0 to 5 |
| `filter.popularity` | number | Minimum popularity, 0 to 1 |
| `filter.address` | string | Partial match, comma-separated terms |
| `page` | integer | 1 to 100, default 1 |
| `take` | integer | Fewer than 200 |
| `sort_by` | string | `match` (default), `distance`, `popularity` |

Response: `{ success, duration, results: [entity, ...] }`. A 404 means no
results.

## GET /v2/tags

Find tag IDs for `filter.tags`, `filter.exclude.tags` and
`signal.interests.tags`.

| Parameter | Type | Notes |
| --- | --- | --- |
| `filter.query` | string | Partial match on the tag name |
| `feature.typo_tolerance` | boolean | Default false |
| `feature.semantic_search` | boolean | Default false. Beta |
| `filter.tag.types` | list | Exact tag types; list them with the Tag Types API |
| `filter.parents.types` | string | Parent entity or audience types |
| `filter.results.tags` | list | Specific tag IDs |
| `filter.popularity.min`, `filter.popularity.max` | number | 0 to 1 |
| `page` | integer | Default 1, max 100 |
| `take` | integer | Default 20, max 50 |

There is no static list of tags. Tag IDs look like
`urn:tag:genre:media:horror` or `urn:tag:genre:restaurant:Italian`.

## GET /v2/insights

Every request needs `filter.type` and at least one valid signal or filter.

### Signals (what the results are based on)

All of these are documented for every entity type.

| Parameter | Type | Notes |
| --- | --- | --- |
| `signal.interests.entities` | list | Entity IDs. Weights exist but need POST |
| `signal.interests.tags` | list | Tag IDs. Weights exist but need POST |
| `operator.signal.interests.tags` | string | `union`: any tag, highest affinity scores. `intersection` or empty: all tags, scores merged |
| `signal.demographics.age` | list | `24_and_younger`, `25_to_29`, `30_to_34`, `35_to_44`, `45_to_54`, `55_and_older` |
| `signal.demographics.gender` | string | `male` or `female` |
| `signal.demographics.audiences` | list | Audience IDs from `/v2/audiences` |
| `signal.demographics.audiences.weight` | string | Strength of the audience influence |
| `signal.location` | string | WKT `POINT` or `POLYGON` (longitude first), or a locality ID |
| `signal.location.query` | string | Locality name, fuzzy-matched. 400 if not found |
| `signal.location.radius` | integer | Metres, only with a WKT point. Qloo advises against it |
| `signal.location.weight` | string | Strength of the location influence |
| `bias.trends` | string | `off`, `very_low`, `low`, `mid`, `medium`, `high`, `very_high` |
| `bias.content_based` | not documented | Strength of content metadata in the score |
| `bias.quality` | number | Places only |

`signal.interests.entities.query` (resolve names inline) is POST-only.

### Era and date filters

This is the complete documented list. There is no era filter for artists,
brands, podcasts or video games.

| Parameter | Entity types |
| --- | --- |
| `filter.release_year.min`, `filter.release_year.max` | Movie, TV show |
| `filter.release_date.min`, `filter.release_date.max` (YYYY-MM-DD) | Not stated |
| `filter.finale_year.min`, `filter.finale_year.max` | TV show |
| `filter.latest_known_year.min`, `filter.latest_known_year.max` | TV show |
| `filter.publication_year.min`, `filter.publication_year.max` | Book |
| `filter.date_of_birth.min`, `filter.date_of_birth.max` (YYYY-MM-DD) | Person |
| `filter.date_of_death.min`, `filter.date_of_death.max` (YYYY-MM-DD) | Person |

Related: `filter.release_country` (list, Movie and TV show) with
`operator.filter.release_country`; `filter.content_rating` (MPAA ratings,
Movie and TV show); `filter.rating.min`/`max` (0 to 5, Movie and TV show);
`filter.gender` (Person).

### General filters (all entity types)

| Parameter | Notes |
| --- | --- |
| `filter.tags` | Tag IDs, with `operator.filter.tags` (`union` default, `intersection`) |
| `filter.exclude.tags` | Tag IDs to exclude, with `operator.exclude.tags` |
| `filter.exclude.entities` | Entity IDs to remove from results |
| `filter.results.entities` | Score only these entity IDs against the signals |
| `filter.results.entities.query` | One entity name on GET (arrays need POST) |
| `filter.popularity.min`, `filter.popularity.max` | Percentile, 0 to 1 |
| `filter.parents.types` | Parent entity types |
| `filter.external.exists` | `resy`, `michelin`, `tablet`, with `operator.filter.external.exists` |

### Location filters (Destination and Place)

`filter.location` (WKT or locality ID), `filter.location.query` (locality
name; 400 if not found), `filter.location.radius` (metres; `0` keeps results
strictly inside the locality), `filter.location.geohash`, the matching
`filter.exclude.location*` parameters, and exact-match geocode filters
`filter.geocode.name`, `filter.geocode.admin1_region`,
`filter.geocode.admin2_region`, `filter.geocode.country_code` (two letters).

Place-only: `filter.address`, `filter.hours` (day of week),
`filter.price_level.min`/`max` (1 to 4), `filter.price_range.min`/`max`,
`filter.hotel_class.min`/`max` (1 to 5),
`filter.properties.business_rating.min`/`max`, `filter.references_brand`,
Tripadvisor and Resy rating filters.

### Output

| Parameter | Notes |
| --- | --- |
| `take` | Default 20, max 50 |
| `page` | Recommended way to paginate |
| `offset` | Skip N results |
| `sort_by` | `affinity`, `distance`, `rating`; `quality` for places only |
| `diversify.by`, `diversify.take` | Cap results per city, metro or tag subtype |
| `feature.explainability` | See below |

### Explainability

`feature.explainability=true` adds, for each result, a `query.explainability`
section showing which input entities contributed and by how much (scores 0 to
1; inputs scoring 0.1 or more are always included). A top-level
`query.explainability` gives the average influence of each input across the
top 3, 5, 10 and all results. If it cannot be computed, a warning appears
under `query.explainability.warning` and results still return.

### Taste analysis (`filter.type=urn:tag`)

Returns the tags that best describe a signal. Needs at least one of
`signal.interests.entities`, `signal.interests.tags`,
`signal.demographics.audiences`, `signal.location`/`signal.location.query`.
Narrow with `filter.tag.types` (for example `urn:tag:keyword:media`) and
`filter.parents.types` (for example `urn:entity:movie,urn:entity:tv_show`).
Results arrive under `results.tags`.

### Demographic insights (`filter.type=urn:demographics`)

Returns affinity by age band and gender for an entity
(`signal.interests.entities`) or a tag (`signal.interests.tags`), or both.
Positive values mean stronger-than-average alignment for that group; negative
values mean weaker.

## GET /v2/analysis/compare

Compares two groups of entities.

| Parameter | Notes |
| --- | --- |
| `a.signal.interests.entities` | Required. First group of entity IDs |
| `b.signal.interests.entities` | Required. Second group |
| `filter.type` | Entity types to compare on |
| `filter.subtype` | `urn:tag:occupation` or `urn:tag:genre` |
| `model` | `descriptive` or `predictive` |
| `filter.location.query`, `filter.location.radius` | Radius default 15000 m |
| `take` (default 20, max 50), `page`, `offset` | Pagination |

## GET /v2/trending

Weekly popularity time series for an entity: population percentile, rank,
velocity and acceleration, newest first. Required: `filter.type`,
`filter.start_date`, `filter.end_date` (YYYY-MM-DD). Optional:
`signal.interests.entities`, `take`, `page`, `offset`.

## Other endpoints listed in the docs, not read in detail

`/reference/get-entities` (look up entities by ID), `/reference/get-audiences`
and `/reference/get-audience-types`, `/reference/get-tag-types`,
`/reference/heatmaps-use-case`, `/reference/schema-taxonomy`.

## Response shape

The published schema for `/v2/insights` only names `success`,
`results.entities` and `results.duration`. Per-entity field names (name,
entity ID, properties, images, popularity, affinity) are not verified and must
be read from a live response. Record field names only, never response values.

## Errors

| Status | Meaning |
| --- | --- |
| 401 | Wrong base URL for the key, or the key is not in `X-Api-Key` |
| 403 | Entity type not permitted |
| 400 | A `*.query` parameter found no match, or "at least one valid signal or filter is required" |
| 404 | `/search` found nothing, or a missing or wrong path |
| 200, empty `entities` | Parameter not valid for the `filter.type`, or no data for that entity or region |

## Sources read

- https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
- https://docs.qloo.com/reference/parameters
- https://docs.qloo.com/reference/get-search
- https://docs.qloo.com/reference/search-tags
- https://docs.qloo.com/reference/analysis-compare
- https://docs.qloo.com/reference/get-trending
- https://docs.qloo.com/reference/taste-analysis
- https://docs.qloo.com/reference/demographics-use-case
- https://docs.qloo.com/reference/insights-api-deep-dive
