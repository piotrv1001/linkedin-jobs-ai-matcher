// Write reports/index.html: jobs ranked by fit for the current resume.md.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { db } from './db.js';

const resume = await readFile('resume.md', 'utf8');
const resumeHash = createHash('sha256').update(resume).digest('hex').slice(0, 12);

const { rows: jobs } = await db.query(
    `SELECT j.*, m.score, m.verdict, m.strengths, m.gaps, m.pitch,
            (j.first_seen > now() - interval '1 day') AS is_new
     FROM jobs j JOIN matches m ON m.job_id = j.job_id AND m.resume_hash = $1
     ORDER BY m.score DESC, j.posted_date DESC NULLS LAST`,
    [resumeHash],
);
const { rows: [{ unscored }] } = await db.query(
    'SELECT count(*)::int AS unscored FROM jobs j WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.job_id = j.job_id AND m.resume_hash = $1)',
    [resumeHash],
);
await db.end();

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const shown = jobs.filter((j) => j.verdict !== 'skip');
const skipped = jobs.length - shown.length;

function card(j) {
    const tone = j.score >= 80 ? 'high' : j.score >= 60 ? 'mid' : 'low';
    const meta = [j.company, j.location, j.salary_text, j.seniority, j.posted_date && `posted ${j.posted_date.toISOString().slice(0, 10)}`]
        .filter(Boolean).map(esc).join(' · ');
    return `<article>
        <div class="score ${tone}">${j.score}</div>
        <div class="body">
            <h2><a href="${esc(j.url)}">${esc(j.title)}</a>${j.is_new ? ' <span class="new">new</span>' : ''}</h2>
            <div class="meta">${meta}</div>
            <ul class="chips">
                ${j.strengths.map((s) => `<li class="pro">✓ ${esc(s)}</li>`).join('')}
                ${j.gaps.map((s) => `<li class="con">✗ ${esc(s)}</li>`).join('')}
            </ul>
            <p class="pitch">${esc(j.pitch)}</p>
        </div>
    </article>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job matches</title>
<style>
    body { font: 14px/1.5 system-ui, -apple-system, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 32px; }
    main { max-width: 860px; margin: auto; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .muted, .meta { color: #6b7280; font-size: 13px; }
    article { display: flex; gap: 16px; background: #fff; border-radius: 12px; padding: 18px; margin-top: 12px; box-shadow: 0 1px 3px #0000001a; }
    .score { flex: none; width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 18px; }
    .score.high { background: #dcfce7; color: #15803d; }
    .score.mid { background: #fef3c7; color: #92400e; }
    .score.low { background: #f1f5f9; color: #475569; }
    h2 { font-size: 16px; margin: 0; }
    h2 a { color: inherit; text-decoration: none; }
    .new { font-size: 11px; font-weight: 600; background: #6366f1; color: #fff; border-radius: 999px; padding: 1px 8px; vertical-align: middle; }
    .chips { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .chips li { font-size: 12px; border-radius: 6px; padding: 2px 8px; }
    .pro { background: #f0fdf4; color: #166534; }
    .con { background: #fef2f2; color: #991b1b; }
    .pitch { margin: 10px 0 0; font-style: italic; color: #374151; }
</style></head>
<body><main>
    <h1>Job matches</h1>
    <div class="muted">${jobs.length} jobs scored against resume.md · ${shown.filter((j) => j.verdict === 'apply').length} to apply for · ${skipped} skipped${unscored ? ` · ${unscored} not scored yet (run npm run match)` : ''}</div>
    ${shown.map(card).join('\n')}
</main></body></html>`;

await mkdir('reports', { recursive: true });
await writeFile('reports/index.html', html);
console.log(`Wrote reports/index.html (${shown.length} matches, ${skipped} skipped)`);
