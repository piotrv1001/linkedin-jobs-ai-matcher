// Score every job that has no score for the current resume.md with Claude.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { db } from './db.js';

const CONCURRENCY = 4;

if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set, skipping scoring.');
    process.exit(0);
}

const Match = z.object({
    score: z.number().int().min(0).max(100).describe('Fit between the resume and the job, 0-100'),
    verdict: z.enum(['apply', 'maybe', 'skip']),
    strengths: z.array(z.string()).describe('Up to 3 reasons the candidate fits, 2-6 words each, like tags'),
    gaps: z.array(z.string()).describe('Up to 3 missing requirements or dealbreakers, 2-6 words each, like tags'),
    pitch: z.string().describe('One sentence the candidate could open a cover letter with, or why to skip'),
});

const resume = await readFile('resume.md', 'utf8');
const resumeHash = createHash('sha256').update(resume).digest('hex').slice(0, 12);

const { rows: jobs } = await db.query(
    `SELECT * FROM jobs j
     WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.job_id = j.job_id AND m.resume_hash = $1)
     ORDER BY first_seen DESC`,
    [resumeHash],
);
console.log(`Scoring ${jobs.length} jobs against resume ${resumeHash}...`);

const client = new Anthropic();
const system = [{
    type: 'text',
    // The resume is the same for every job, so it is cached after the first call.
    cache_control: { type: 'ephemeral' },
    text: `You screen job postings for one candidate. Score how well each job fits them.
90-100: strong fit, apply today. 70-89: good fit with minor gaps. 40-69: stretch or partial fit. Below 40: wrong role.
Respect what the candidate says they are not looking for, their location and their salary floor
(compare it with the posted salary when there is one).

<resume>
${resume}
</resume>`,
}];

async function score(job) {
    const response = await client.messages.parse({
        model: process.env.CLAUDE_MODEL ?? 'claude-opus-5-5',
        max_tokens: 16000,
        output_config: { effort: 'low', format: zodOutputFormat(Match) },
        system,
        messages: [{
            role: 'user',
            content: [
                `Company: ${job.company}`,
                `Title: ${job.title}`,
                `Location: ${job.location}`,
                `Seniority: ${job.seniority ?? 'not listed'}`,
                `Salary: ${job.salary_text ?? 'not listed'}`,
                '',
                job.description ?? '(no description)',
            ].join('\n'),
        }],
    });
    const m = response.parsed_output;
    if (!m) {
        console.error(`  ${job.title} @ ${job.company}: no score (stop reason "${response.stop_reason}")`);
        return;
    }
    await db.query(
        `INSERT INTO matches (job_id, resume_hash, score, verdict, strengths, gaps, pitch)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [job.job_id, resumeHash, m.score, m.verdict, m.strengths, m.gaps, m.pitch],
    );
    console.log(`  ${String(m.score).padStart(3)}  ${m.verdict.padEnd(5)}  ${job.title} @ ${job.company}`);
}

// Small batches keep us under the API rate limit.
for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(jobs.slice(i, i + CONCURRENCY).map(score));
}

await db.end();
