---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when the user wants to stress-test a plan, get grilled on their design, mentions "grill me", or when an agent (e.g. research-planner) hits an open decision it shouldn't guess at.
---

Interview the user relentlessly about the plan or design at hand until
reaching shared understanding. Walk down each branch of the decision tree,
resolving dependencies between decisions one at a time rather than dumping
every open question at once.

- **One question at a time.** Wait for the answer before asking the next —
  earlier answers often make later questions moot or reshape them.
- **Recommend, don't just ask.** For every question, state your recommended
  answer and the reasoning behind it. Let the user confirm, override, or
  redirect — don't hand them a blank-slate decision they'd have to fully
  reason through themselves.
- **Explore before asking.** If a question can be answered by reading the
  codebase, docs, or prior plan/issue files, do that instead of asking the
  user. Only surface questions that genuinely require a human judgment call.
- **Follow dependency order.** If decision B only matters given a particular
  answer to decision A, resolve A first — don't ask both in parallel.
- **Stop when resolved.** Once every open branch has a settled answer, stop
  interviewing and summarize the decisions reached — don't keep grilling for
  its own sake.
