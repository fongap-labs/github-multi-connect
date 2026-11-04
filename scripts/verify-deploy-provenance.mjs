#!/usr/bin/env node

// A source-context deployment has no access to Action Worker's signing key.
// Check immutable GitHub run provenance and signed status *presence*; the
// central Action Worker remains the authority that validates status HMACs.
const SOURCE_REPOSITORY = 'fongap-labs/mcp-hub';
const CONTROL_REPOSITORY = 'fongap-labs/action-worker';
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const RUN_PATTERN = /^https:\/\/github\.com\/fongap-labs\/action-worker\/actions\/runs\/([1-9][0-9]*)$/;
const SIGNED_PATTERN = / \[aw1:[A-Za-z0-9_-]{43}\]$/;
const GATES = {
  'CI Evidence': {
    paths: ['.github/workflows/central-ci-dispatch.yml'],
    jobs: ['Publish Central CI'],
  },
  'Main Write Guard': {
    paths: [
      '.github/workflows/intake.yml',
      '.github/workflows/ci-follow-up.yml',
      '.github/workflows/main-write-guard.yml',
    ],
    jobs: ['Main write audit', 'Independent CI follow-ups', 'Main Write Guard'],
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function verifyProvenance(env, fetcher = fetch) {
  const repo = env.GITHUB_REPOSITORY;
  const sha = env.GITHUB_SHA;
  const ref = env.GITHUB_REF;
  const token = env.GITHUB_TOKEN;
  assert(repo === SOURCE_REPOSITORY, 'Wrong source repository for deployment');
  assert(ref === 'refs/heads/main' && SHA_PATTERN.test(sha ?? ''), 'Deploy must use an immutable main SHA');
  assert(typeof token === 'string' && token.length > 0, 'A read-only GITHUB_TOKEN is required');
  const api = async (repository, path) => {
    const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(repository === SOURCE_REPOSITORY ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(12000),
    });
    assert(response.ok, `GitHub attestation query failed: HTTP ${response.status}`);
    return response.json();
  };
  const head = await api(repo, 'commits/main');
  assert(head?.sha === sha, 'Source main moved after workflow dispatch');
  const combined = await api(repo, `commits/${sha}/status`);
  const statuses = Array.isArray(combined?.statuses) ? combined.statuses : [];
  for (const [context, rule] of Object.entries(GATES)) {
    // Combined status returns the most recent status for each context.
    const entry = statuses.find((value) => value?.context === context);
    assert(entry?.state === 'success', `Central ${context} is missing or not successful`);
    assert(SIGNED_PATTERN.test(entry.description ?? ''), `Central ${context} is not in attested status format`);
    const match = RUN_PATTERN.exec(entry.target_url ?? '');
    assert(match, `Central ${context} does not reference the trusted control repository`);
    const run = await api(CONTROL_REPOSITORY, `actions/runs/${match[1]}`);
    assert(run?.status === 'completed' && run?.conclusion === 'success', `Central ${context} run did not complete successfully`);
    assert(rule.paths.includes(run.path), `Central ${context} run has an unexpected workflow`);
    assert(run.event === 'repository_dispatch', `Central ${context} run was not centrally dispatched`);
    const jobs = await api(CONTROL_REPOSITORY, `actions/runs/${match[1]}/jobs?per_page=100`);
    assert(Array.isArray(jobs?.jobs) && jobs.jobs.some((job) => rule.jobs.includes(job.name) && job.conclusion === 'success'), `Central ${context} run lacks its successful authoritative job`);
  }
  // Verify that the merge relationship is platform-attested, not just a main status.
  const linked = await api(repo, `commits/${sha}/pulls?per_page=100`);
  assert(Array.isArray(linked) && linked.some((pr) => pr?.merged_at && pr.merge_commit_sha === sha && pr.base?.ref === 'main'), 'Main SHA is not attributable to a merged PR');
  return sha;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  verifyProvenance(process.env).then(sha => console.log(`Central source gates verified for ${sha}`)).catch(error => {
    console.error(`::error::Deployment attestation check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
