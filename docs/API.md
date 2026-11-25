# REST API

A read-only JSON API over the same data the MCP server serves. It is for
dashboards, spreadsheets and scripts that cannot speak MCP.

Base URL: `https://<your-installation>/api/v1`

## Authentication

Create an API key in the app and send it as `x-api-key: oseo_...` or
`Authorization: Bearer oseo_...`. A key belongs to one workspace and has the
creating member's access, so a member limited to some projects sees only those.
Requests are rate limited per key.

A project the key cannot see answers `404`, the same as a project that does not
exist.

## Endpoints

`GET /api/v1` lists them. Project routes live under `/projects/{projectId}`.

| Route                                          | Returns                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /projects`                                | Projects the key can see                                                                    |
| `/ai-visibility/tracker`                       | Prompts, engines and schedule                                                               |
| `/ai-visibility/runs/{runId}`                  | One run's status and counts                                                                 |
| `/ai-visibility/results`                       | Answers per prompt and engine (`runId`, `topic`, `engines`, `promptId`, `limit`, `cursor`)  |
| `/ai-visibility/sources`                       | Cited sources (`runId`, `groupBy`, `ownership`, `engines`, `limit`, `cursor`)               |
| `/ai-visibility/answers/{observationId}`       | One saved answer with its highlights                                                        |
| `/ai-visibility/insights`                      | Brand leaderboard and gaps                                                                  |
| `/ai-visibility/trend`                         | Visibility over time                                                                        |
| `/ai-visibility/metrics.csv`                   | CSV, one row per collected answer without its text (`days`, `locationCode`, `languageCode`) |
| `/rank-trackers`, `/rank-trackers/{trackerId}` | Google rank trackers and their positions                                                    |

Query values use the same names and limits as the matching MCP tool inputs.
Anything but `GET` answers `405`; an invalid filter answers `400`.

## Spreadsheets and BI tools

`metrics.csv` is a flat table for spreadsheets and business-intelligence tools
that pull on their own schedule. It returns up to 50,000 rows, and the
`x-caldrin-truncated` header says `true` when the window held more. A brand
column is empty when the engine gave no answer: unknown, not false. A Looker
Studio connector is in `connectors/looker-studio`.

## Not included

Writes, running checks and anything that spends provider credits. Use the MCP
server or the app for those.
