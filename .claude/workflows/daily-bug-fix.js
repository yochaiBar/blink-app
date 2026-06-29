export const meta = {
  name: 'daily-bug-fix',
  description: 'Read the Bug Inbox, fix bugs in an isolated worktree, gate on the full test suite, push + open PR only if green, report to the Telegram testers group, then clean up.',
  phases: [
    { title: 'Triage' },
    { title: 'Prepare' },
    { title: 'Fix' },
    { title: 'Verify' },
    { title: 'Integrate' },
    { title: 'Report' },
    { title: 'Cleanup' },
  ],
}

// Self-sufficient: no reliance on args. Runs in an ISOLATED worktree off
// origin/main, so the user's working tree (WIP, uncommitted changes) is never
// touched and never blocks the run.
const INBOX = '/Users/yochaibar/Documents/Obsidian Vault/Blink/Tasks/Bug Inbox.md'
const REPO = '/Users/yochaibar/personal/blink'
const WORKTREE = '/Users/yochaibar/.claude/blink-bugbot/worktree'
const GROUP_CHAT_ID = '-5426625668'

// The report agent posts to Telegram WITHOUT the token entering this script: it
// reads the token from the .env at runtime.
const POST_INSTRUCTIONS =
  `To post to the Telegram testers group, read the bot token from ` +
  `~/.claude/channels/telegram/.env (the TELEGRAM_BOT_TOKEN= line), then run: ` +
  `curl -s "https://api.telegram.org/bot<TOKEN>/sendMessage" --data-urlencode chat_id=${GROUP_CHAT_ID} --data-urlencode text="<message>". ` +
  `Never print the token.`

// Remove the worktree (and its branch checkout) — best-effort, safe to call anytime.
const CLEANUP_CMD =
  `cd ${REPO} && git worktree remove --force ${WORKTREE} 2>/dev/null; rm -rf ${WORKTREE}; git worktree prune`

const BUG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    bugs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          report: { type: 'string' },
          domain: { type: 'string', enum: ['server', 'app', 'fullstack', 'unknown'] },
        },
        required: ['id', 'title', 'report', 'domain'],
      },
    },
  },
  required: ['bugs'],
}

// ── Phase 1: Triage ────────────────────────────────────────────────────────
phase('Triage')
const triage = await agent(
  `Read the file "${INBOX}". Parse every bug block (lines starting with "### BUG-") that has ` +
    `"- Status: new". For each, extract: id (the BUG-... token), title (text after the em-dash), ` +
    `the verbatim Report text, and classify domain as "server" (blink-server/Express/Postgres), ` +
    `"app" (blink-app/Expo/React Native), "fullstack" (both), or "unknown". Return ONLY new-status bugs.`,
  { phase: 'Triage', schema: BUG_SCHEMA },
)

const bugs = (triage && triage.bugs) || []
log(`Triage: ${bugs.length} new bug(s)`)

if (bugs.length === 0) {
  return { bugs: 0, pushed: false, note: 'no new bugs' }
}

// ── Phase 2: Prepare isolated worktree + install deps ────────────────────────
phase('Prepare')
const PREP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    branch: { type: 'string' },
    date: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['ok', 'branch', 'date', 'note'],
}
const prep = await agent(
  `Set up a clean, isolated git worktree for an automated bug-fix run. Run these in ${REPO}:\n` +
    `1. D=$(date +%F)\n` +
    `2. Remove any stale worktree: ${CLEANUP_CMD}\n` +
    `3. git fetch origin\n` +
    `4. Delete any stale local branch: git branch -D "auto-fix/bugs-$D" 2>/dev/null || true\n` +
    `5. git worktree add "${WORKTREE}" -b "auto-fix/bugs-$D" origin/main\n` +
    `6. Install deps IN THE WORKTREE (required for tests; node_modules is not shared):\n` +
    `   cd "${WORKTREE}/blink-server" && npm ci --registry https://registry.npmjs.org\n` +
    `   cd "${WORKTREE}/blink-app" && npm ci --legacy-peer-deps --registry https://registry.npmjs.org\n` +
    `If every step succeeds, return ok=true, branch="auto-fix/bugs-$D", date="$D". ` +
    `If anything fails, run the cleanup command and return ok=false with the failing step in note.`,
  { phase: 'Prepare', agentType: 'fullstack-developer', schema: PREP_SCHEMA },
)

if (!prep || !prep.ok) {
  phase('Report')
  await agent(
    `${POST_INSTRUCTIONS}\nPost: "⚠️ Daily bug run aborted during setup ` +
      `(${(prep && prep.note ? prep.note : 'unknown').slice(0, 150)}). ${bugs.length} new bug(s) left untouched." ` +
      `Do not modify the inbox.`,
    { phase: 'Report' },
  )
  await agent(`Run this cleanup command exactly: ${CLEANUP_CMD}`, { phase: 'Cleanup' })
  return { bugs: bugs.length, pushed: false, aborted: true }
}
const BRANCH = prep.branch
const DATE = prep.date

// ── Phase 3: Fix (SEQUENTIAL in the worktree — shared branch, no parallel edits) ─
phase('Fix')
const agentForDomain = (d) =>
  d === 'server' ? 'backend-developer' : d === 'app' ? 'frontend-developer' : 'fullstack-developer'

const FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    fixed: { type: 'boolean' },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'fixed', 'summary', 'filesChanged'],
}

const fixes = []
for (const bug of bugs) {
  const fix = await agent(
    `You are resolving a single reported bug. Work ONLY inside the worktree at ${WORKTREE} (cd there first; ` +
      `do NOT touch ${REPO}). You are on branch ${BRANCH}.\n\n` +
      `BUG ${bug.id}: ${bug.title}\nReport: ${bug.report}\n\n` +
      `Reproduce if possible, find root cause, implement the minimal correct fix following the repo's ` +
      `CLAUDE.md conventions (parameterized SQL, Zod schemas, asyncHandler, snake_case DB / camelCase TS, etc.). ` +
      `Add or update tests that cover the fix. Then "git add -A && git commit" with message ` +
      `'fix(${bug.id}): <summary>'. If you cannot confidently fix it (unclear, needs info, not a real bug), ` +
      `make NO changes and return fixed=false with the reason in summary. Return the files you changed.`,
    { label: `fix:${bug.id}`, phase: 'Fix', agentType: agentForDomain(bug.domain), schema: FIX_SCHEMA },
  )
  fixes.push(fix || { id: bug.id, fixed: false, summary: 'agent returned no result', filesChanged: [] })
  log(`${bug.id}: ${fixes[fixes.length - 1].fixed ? 'fix committed' : 'skipped'}`)
}

const attempted = fixes.filter((f) => f.fixed)
if (attempted.length === 0) {
  phase('Report')
  await agent(
    `${POST_INSTRUCTIONS}\nPost: "🤖 Daily bug run ${DATE}: reviewed ${bugs.length} new bug(s), none could ` +
      `be auto-fixed (need more info or manual work)." Then in "${INBOX}", set Status to "needs-info" for: ` +
      `${bugs.map((b) => b.id).join(', ')}.`,
    { phase: 'Report' },
  )
  await agent(`Run this cleanup command exactly: ${CLEANUP_CMD}`, { phase: 'Cleanup' })
  return { bugs: bugs.length, fixed: 0, pushed: false }
}

// ── Phase 4: Verify (HARD GATE) ───────────────────────────────────────────────
phase('Verify')
const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { passed: { type: 'boolean' }, details: { type: 'string' } },
  required: ['passed', 'details'],
}
const verify = await agent(
  `In the worktree ${WORKTREE} on branch ${BRANCH}, run the FULL quality gate and report pass/fail honestly. ` +
    `Run, in order:\n` +
    `  (server) cd ${WORKTREE}/blink-server && npm run typecheck && npm run lint && npm test\n` +
    `  (app)    cd ${WORKTREE}/blink-app && npm run typecheck && npm run lint && npm test\n` +
    `passed=true ONLY if every command exits 0. If anything fails, passed=false and put the failing command ` +
    `+ a short error excerpt in details. Do not fix anything — just report.`,
  { phase: 'Verify', agentType: 'qa-expert', schema: VERIFY_SCHEMA },
)
const green = !!(verify && verify.passed)
log(`Verify: ${green ? 'PASS' : 'FAIL'}`)

// ── Phase 5: Integrate (push branch + PR only if green) ───────────────────────
phase('Integrate')
let prUrl = null
if (green) {
  const integrate = await agent(
    `In the worktree ${WORKTREE} on branch ${BRANCH}: push (git push -u origin ${BRANCH}) and open a PR with ` +
      `gh: title "Auto-fix: bugs ${DATE}", body listing each fixed bug id + summary, plus a note that this was ` +
      `generated by the automated daily bug-fix run and needs human review before merge. Return the PR URL on a ` +
      `line starting "PR_URL: ". Fixed bugs:\n${attempted.map((f) => `- ${f.id}: ${f.summary}`).join('\n')}`,
    { phase: 'Integrate' },
  )
  const m = integrate && integrate.match(/PR_URL:\s*(\S+)/)
  prUrl = m ? m[1] : `(branch ${BRANCH})`
}

// ── Phase 6: Report + update inbox ────────────────────────────────────────────
phase('Report')
if (green) {
  await agent(
    `${POST_INSTRUCTIONS}\nPost: "🤖 Daily bug run ${DATE}: fixed ${attempted.length}/${bugs.length} bug(s), ` +
      `tests green ✅. PR (needs review): ${prUrl}". Then in "${INBOX}", for each fixed bug id set Status to ` +
      `"fixed" and append a "- Resolution: <summary> (PR ${prUrl})" line: ` +
      attempted.map((f) => `${f.id} → ${f.summary}`).join(' | '),
    { phase: 'Report' },
  )
} else {
  await agent(
    `${POST_INSTRUCTIONS}\nThe fixes FAILED the test gate, so nothing was pushed. Post: ` +
      `"⚠️ Daily bug run ${DATE}: attempted ${attempted.length} fix(es) but the test suite failed — NOT pushed. ` +
      `The branch ${BRANCH} is discarded; bugs left for manual work. (${(verify && verify.details ? verify.details : '').slice(0, 180)})". ` +
      `Then in "${INBOX}", set Status to "triaged" for: ${attempted.map((f) => f.id).join(', ')}.`,
    { phase: 'Report' },
  )
}

// ── Phase 7: Cleanup (always) ─────────────────────────────────────────────────
phase('Cleanup')
await agent(
  `Run this cleanup command exactly to remove the temporary worktree: ${CLEANUP_CMD}\n` +
    (green
      ? `The branch was already pushed to origin, so removing the local worktree loses nothing.`
      : `The local branch ${BRANCH} keeps its commits in git history if anyone wants to inspect it later.`),
  { phase: 'Cleanup' },
)

return { date: DATE, bugs: bugs.length, fixed: attempted.length, pushed: green, prUrl }
