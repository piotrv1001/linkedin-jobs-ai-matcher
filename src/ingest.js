// Fetch open roles at every company in companies.txt and upsert them into Postgres.
import { readFile } from 'node:fs/promises';
import { ApifyClient } from 'apify-client';
import { db } from './db.js';

const ACTOR_ID = 'piotrv1001/linkedin-company-jobs-scraper';
const { KEYWORDS = '', LOCATION = '', POSTED_WITHIN = '', MAX_JOBS = '60' } = process.env;
const POSTED = { '': '', day: 'r86400', week: 'r604800', month: 'r2592000' };
if (!(POSTED_WITHIN in POSTED)) throw new Error('POSTED_WITHIN must be day, week, month or empty');

const companies = (await readFile('companies.txt', 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

console.log(`Fetching up to ${MAX_JOBS} jobs at ${companies.length} companies...`);
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
const run = await client.actor(ACTOR_ID).call({
    companies,
    keywords: KEYWORDS,
    location: LOCATION,
    postedWithin: POSTED[POSTED_WITHIN],
    scrapeJobDetails: true, // description, salary and seniority, needed for scoring
    maxItems: Number(MAX_JOBS),
}, { log: null });
console.log(`Run ${run.status}: https://console.apify.com/actors/runs/${run.id}`);

const { items } = await client.dataset(run.defaultDatasetId).listItems();
let added = 0;
for (const job of items) {
    const { rows: [row] } = await db.query(
        `INSERT INTO jobs (job_id, company, title, location, url, posted_date, seniority,
                           employment_type, salary_text, applicants, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (job_id) DO UPDATE
         SET last_seen = now(), applicants = EXCLUDED.applicants, description = EXCLUDED.description
         RETURNING (xmax = 0) AS inserted`,
        [
            job.jobId, job.companyName, job.title, job.location, job.jobUrl, job.postedDate,
            job.seniorityLevel, job.employmentType, job.salaryText,
            job.applicantCount ? Number(job.applicantCount) : null, job.description,
        ],
    );
    if (row.inserted) added++;
}
console.log(`Saved ${items.length} jobs, ${added} of them new.`);

await db.end();
