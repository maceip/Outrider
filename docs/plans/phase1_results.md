# Phase 1 exit gate — 2026-11-13

`cargo check -p proxyfor --all-targets` passes. The live test
`OUTRIDER_CLEF_MODEL=/Users/mac/.avery/redteam-models/gemma-4-e2b-it.litertlm cargo test -p proxyfor --test clef_litertlm_e2e -- --ignored --nocapture`
passes all three question types in 6.46 seconds on macOS arm64 / CPU. It connects
a real rmcp client to a recording handler, persists the received initialize
request, evaluates it, and verifies persisted picks, measured latency, token
counts recomputed through Engine::tokenize, and NULL option_scores.

The normal test run explicitly reports the model test as ignored with the
command required to run it. Unconfigured and invalid-model evaluations are
separately tested and contain no fabricated picks or token counts.

Input tokens are measured over the saved native-rendered preface plus message;
output tokens over the exact native response text. An explicit system preface
is required for this model's native preface rendering API. Tokenization or
rendering failure records ModelError, never a token estimate.

CLI configuration now accepts --clef-model / OUTRIDER_CLEF_MODEL,
--clef-backend cpu|gpu, --clef-threads, --clef-cache-dir and --db. Native work
uses spawn_blocking and an explicitly bounded semaphore, rejecting work when
all workers are occupied. Phase 2 connects this state to the admin interface.
