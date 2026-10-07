-- Every job seen at the watched companies. Upserted on each run.
CREATE TABLE jobs (
    job_id           text PRIMARY KEY,
    company          text NOT NULL,
    title            text NOT NULL,
    location         text,
    url              text NOT NULL,
    posted_date      date,
    seniority        text,
    employment_type  text,
    salary_text      text,
    applicants       int,
    description      text,
    first_seen       timestamptz NOT NULL DEFAULT now(),
    last_seen        timestamptz NOT NULL DEFAULT now()
);

-- Claude's fit score for a job against one version of the resume.
-- Editing resume.md changes resume_hash, so every job is scored again.
CREATE TABLE matches (
    job_id       text NOT NULL REFERENCES jobs,
    resume_hash  text NOT NULL,
    score        int  NOT NULL CHECK (score BETWEEN 0 AND 100),
    verdict      text NOT NULL CHECK (verdict IN ('apply', 'maybe', 'skip')),
    strengths    text[] NOT NULL,
    gaps         text[] NOT NULL,
    pitch        text NOT NULL,
    scored_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, resume_hash)
);
