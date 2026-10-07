# LinkedIn Jobs AI Matcher — Node.js, Postgres and Claude

![LinkedIn jobs AI matcher](docs/banner.png)

Follow a list of companies on LinkedIn, collect every open role into Postgres, and let Claude score each job against
**your resume**: a 0–100 fit score, what matches, what's missing and an opening line for your cover letter. The result
is a ranked shortlist instead of 200 tabs.

Jobs come from the [LinkedIn Company Jobs Scraper](https://apify.com/piotrv1001/linkedin-company-jobs-scraper) on
Apify: no LinkedIn login, cookies or browser automation needed. Postgres runs in Docker.

![Ranked job matches with fit scores, strengths, gaps and a pitch](docs/report.png)

## How it works

```mermaid
flowchart LR
    C[companies.txt] --> I
    CV[resume.md] --> M
    subgraph pipeline [npm start]
        I[ingest<br/>Apify Actor] --> DB[(Postgres<br/>jobs)]
        DB --> M[match<br/>Claude]
        M --> DB
        DB --> R[report]
    end
    R --> H[reports/index.html]
```

| Step | Command | What it does |
| --- | --- | --- |
| Ingest | `npm run ingest` | Runs the Actor for every company in `companies.txt` with your keyword, location and date filters, and upserts each job with its full description, salary, seniority and applicant count. |
| Match | `npm run match` | Scores every job that has no score yet for the current `resume.md`: score, `apply` / `maybe` / `skip`, strengths, gaps and a one-sentence pitch. Skipped if `ANTHROPIC_API_KEY` isn't set. |
| Report | `npm run report` | Writes `reports/index.html`: jobs ranked by score, new postings flagged, `skip` verdicts hidden. |

Jobs you have already scored are never sent to Claude again. Edit `resume.md` and the next run rescores everything
against the new version.

## Quick start

You need [Node.js](https://nodejs.org/) 22 or newer, [Docker](https://docs.docker.com/get-docker/), an
[Apify account](https://console.apify.com/sign-up) and an [Anthropic API key](https://console.anthropic.com/).

```bash
git clone https://github.com/piotrv1001/linkedin-jobs-ai-matcher.git
cd linkedin-jobs-ai-matcher
docker compose up -d          # Postgres 17, schema created on first start
npm install
cp .env.example .env          # add APIFY_TOKEN and ANTHROPIC_API_KEY
```

Then make it yours:

1. Replace `resume.md` with your resume. Plain text or Markdown; say what you are **not** looking for and your salary
   floor, and the scores will respect it.
2. List the companies you'd like to work for in `companies.txt`: names (`Stripe`), LinkedIn slugs or company URLs.
3. Run `npm start` and open `reports/index.html`.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `APIFY_TOKEN` | – | [Apify API token](https://console.apify.com/settings/integrations) |
| `DATABASE_URL` | `postgres://jobs:jobs@localhost:5432/jobs` | Any Postgres 13+ works |
| `KEYWORDS` | `engineer` | Only roles matching this text; empty = all roles |
| `LOCATION` | – | Country, region or city as written on LinkedIn |
| `POSTED_WITHIN` | – | `day`, `week` or `month`; empty = any time |
| `MAX_JOBS` | `60` | Jobs per run across all companies |
| `ANTHROPIC_API_KEY` | – | Required for scoring |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Any Claude model, e.g. `claude-haiku-4-5` for a cheaper run |

## Run it every morning

Set `POSTED_WITHIN=day` and schedule it (`crontab -e`). Only the new postings are scored:

```cron
0 7 * * * cd /path/to/linkedin-jobs-ai-matcher && npm start >> matcher.log 2>&1
```

## Query your matches

```sql
-- Best matches first, with salary
SELECT m.score, j.title, j.company, j.location, j.salary_text, j.url
FROM jobs j JOIN matches m USING (job_id)
WHERE m.verdict = 'apply'
ORDER BY m.score DESC;

-- Skills you're missing most often
SELECT gap, count(*) FROM matches, unnest(gaps) AS gap
GROUP BY gap ORDER BY count(*) DESC LIMIT 10;

-- Postings that appeared in the last week, per company
SELECT company, count(*) FROM jobs
WHERE first_seen > now() - interval '7 days'
GROUP BY company ORDER BY count(*) DESC;
```

Connect with `docker compose exec db psql -U jobs`. If you've edited `resume.md`, filter `matches` on the latest
`resume_hash`.

## Cost

Pricing as of October 7, 2026:

- **Apify:** $0.0008 per job listing plus $0.003 for its full details, so about $0.23 for 60 jobs. Prices drop on
  higher Apify plans; see [current pricing](https://apify.com/piotrv1001/linkedin-company-jobs-scraper/pricing). The
  Apify free plan includes $5 of monthly usage.
- **Claude:** one request per new job. Our test run scored 60 jobs for $0.87 with the default `claude-opus-5-5`
  (about $0.015 per job); the resume is sent as a cached system prompt. Only new jobs are scored on later runs.

## Project structure

```
db/schema.sql      tables: jobs, matches
src/ingest.js      runs the Actor and upserts jobs
src/match.js       Claude fit score per job and resume version
src/report.js      HTML shortlist
companies.txt      companies you follow
resume.md          your resume (an example is included)
```

## Related

- [LinkedIn Company Jobs Scraper](https://apify.com/piotrv1001/linkedin-company-jobs-scraper) — the Actor this
  pipeline runs; also returns each company's LinkedIn profile, industry and size
- [AliExpress price tracker](https://github.com/piotrv1001/aliexpress-price-tracker) — the same pipeline pattern for
  price monitoring
- [Clutch lead generation pipeline](https://github.com/piotrv1001/clutch-lead-generation-pipeline) — the same pattern
  for B2B leads
- [Mercado Libre price tracker](https://github.com/piotrv1001/mercado-libre-price-tracker) and [brand mention monitor](https://github.com/piotrv1001/brand-mention-monitor) — the same pattern for marketplace
  prices and social listening
