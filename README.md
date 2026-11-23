# Publishing Hub spike (PRD 2)

A working spike of the **Publishing & Insights Hub** for Just Sortd: a post is approved in Notion, scheduled through Buffer, confirmed live, and the result is written back to Notion without any manual step. Every run is logged, and anything that goes wrong reaches Slack in plain language.

It was built to prove the riskiest part of PRD 2, the round trip between Notion and the publisher. That is the piece every other content system (PRDs 3 to 7) will depend on.

> All data is made up. Posts went to throwaway test accounts on X and Bluesky and were deleted after testing.

---

## What it does

```
Notion Content DB                     a named person sets Status = Approved
      |
      v
Hub 1 (every minute)  check the row -> schedule in Buffer -> Status = Scheduled
      |                       \-> bad row: back to "In review" + Slack alert
      v
Buffer                publishes at "Publish at" to X and Bluesky
      |
      v
Hub 2 (every 5 min)   ask Buffer what was sent -> Status = Live + Post URL
      |                       \-> 15+ min late: Status = Failed + Slack alert
      v
Run Log DB            one row per event: input, detail, model, cost, approver

Hub 0                 any unexpected crash -> plain-language message in #alerts
```

| Workflow | Trigger | Job |
|---|---|---|
| `hub-1-schedule-approved.json` | Every minute | Validates approved rows, schedules them in Buffer, writes Scheduled or Failed back |
| `hub-2-confirm-live.json` | Every 5 minutes | Checks Buffer's sent posts, marks rows Live with the post link, or flags late ones |
| `hub-0-error-alert.json` | Any workflow error | Posts the failing step and message to #alerts with a pointer to the runbook |

## Design decisions

- **Notion is the only place people work.** No custom front end. Approving is a single status change on a row, which the whole team already understands.
- **The approval gate is enforced in code, not just by status.** Hub 1 re-checks for a named person in *Approved by* (and optionally an allow-list) before anything is scheduled. Setting the status alone is not enough.
- **No double posting.** Buffer post IDs are saved per platform in *Publisher ID* (`X=…; Bluesky=…`). A second approval of the same row is detected and ignored. If one platform fails, re-approving retries only the missing one.
- **Scheduling calls are never auto-retried**, because a blind retry could post twice. Notion and Slack calls retry three times.
- **Buffer sits behind a thin adapter.** The rest of the system only asks to "schedule this post", so Buffer can be swapped for Postiz or another publisher without touching Notion or the content systems.
- **Errors are written for a non-technical reader.** For example: *"Buffer rejected our key. Make a new key in Buffer and update it in n8n (Runbook, fix 1)"*, not a stack trace.
- **Every run is logged** to a Run Log database (event, item, detail, model, cost, approver). This is what lets the system be audited and improved later. There is no AI step in this spike, so the model is `none` and the cost is 0.

## Checks before a post is scheduled

| Check | If it fails |
|---|---|
| Post text is not empty | Back to *In review*, Slack says why |
| At least one platform is chosen, and it is connected | Same |
| *Publish at* has a date **and** a time, at least 1 minute ahead | Same |
| Text is within the limit (X 280, Bluesky 300) | Same, with the character count |
| A named approver exists, and is on the allow-list if one is set | Same |
| Row is already scheduled on that platform | Ignored, with an "already scheduled" note |

## Test results

All tests were run in n8n against a live Notion workspace, Buffer, and test X and Bluesky accounts.

| # | Test | Expected | Result |
|---|---|---|---|
| 1 | Good post approved | Scheduled, Publisher ID filled, Run Log row | Pass |
| 2 | Same post after its time | Live, published on both test accounts | Pass |
| 3 | No approver | Back to *In review*, plain-language Slack alert | Pass |
| 4 | Text over the length limit | Back to *In review*, over-length alert | Pass |
| 5 | Same post approved a second time | "Already scheduled" alert, no second post | Pass |
| 6 | Wrong Buffer key | Failed, Slack alert explaining the key problem | Pass |
| 7 | Post URL write-back (after the Hub 2 patch) | *Post URL* filled from Buffer's `externalLink` | Pass |

## Setup

You need n8n (cloud or self-hosted), a Notion integration, a Buffer API key and a Slack incoming webhook.

**1. Notion.** Create two databases and share both with your integration (••• → Connections).

*Content*

| Property | Type |
|---|---|
| Title | Title |
| Status | Select: Draft, In review, Approved, Scheduled, Live, Failed |
| Platforms | Multi-select: X, Bluesky (more later) |
| Post text | Text |
| Publish at | Date, with time |
| Voice | Select: Brand, Founder |
| Approved by | Person |
| Source | Select: which system or person wrote the row |
| Post URL | URL |
| Publisher ID | Text (written by the hub) |
| Run key | Text (written by the hub) |
| Last error | Text (written by the hub) |

*Run Log*: Run (title), System, Item, Detail, Model, Approver (text), Event (select), Cost (number), When (created time).

**2. n8n.**
1. Import the three files in `workflows/` (Workflow menu → Import from file).
2. Create two credentials: **Notion API** (the integration secret) and **Header Auth** with name `Authorization` and value `Bearer <your Buffer key>`.
3. Select those credentials on each Notion and Buffer HTTP node.
4. In every **Config** node, replace `PASTE_CONTENT_DATABASE_ID`, `PASTE_RUN_LOG_DATABASE_ID` and `PASTE_SLACK_WEBHOOK_URL`. Set your Buffer organization and channel IDs. Optionally list approvers in `allowedApprovers` (comma-separated names or emails).
5. In Hub 1 and Hub 2, open Settings → Error workflow and select Hub 0.
6. Activate Hub 1 and Hub 2.

**3. Find your Buffer IDs.** Run `scripts/check-buffer.js` with your key in an environment variable. It prints your organization and channel IDs:

```bash
BUFFER_KEY=your_key node scripts/check-buffer.js          # macOS / Linux
$env:BUFFER_KEY="your_key"; node scripts/check-buffer.js  # Windows PowerShell
```

`scripts/check-post-fields.js` lists the fields Buffer exposes on a post. That is how `externalLink` was found for the Post URL.

No secrets are stored in this repo. Keys live only in n8n credentials and the Config nodes.

## Known limits of the spike, and what production changes

| Spike | Production |
|---|---|
| Polls Notion every minute (free Notion has no webhooks) | Notion webhook automations plus an n8n wait step: about 1,000 runs a month instead of about 43,000 |
| Hub 2 reads Buffer's 50 most recent sent posts | Page through all sent posts, so a busy week can't cause false "late" alerts |
| Text posts on X and Bluesky | LinkedIn, Substack and newsletter next. Instagram and YouTube arrive with media (public media links) |
| Buffer key belongs to one person's account | Key owned by a shared team login |
| No insights yet | Weekly metrics summary to Slack and a Notion Insights page. Buffer marks analytics as experimental, so platform exports are the fallback |

The full plan (v1 scope, data model, buy vs build, failure handling and monthly cost) is in the PRD 2 build plan submitted alongside this repo.