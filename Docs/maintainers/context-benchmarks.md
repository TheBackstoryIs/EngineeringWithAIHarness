# Verify EWAI context preparation

This page is for engineers changing the harness's context selection or performance. Run source-checkout commands in the EWAI repository, not your application. For everyday inspection, see [context management](../context-management-and-token-efficiency.md).

## Run the regression corpus

From the EWAI source checkout, run:

```bash
npm run context:benchmark
```

The packaged CLI also exposes the same corpus:

```bash
ewai context benchmark --json
```

The committed equal-input corpus contains exactly one fixture for each profile. The benchmark fails unless:

- all seven profiles are present and individually ready;
- every profile retains 100% mandatory recall;
- median estimated input-demand reduction is at least 40%;
- median local preparation is no more than 75 ms;
- aggregate peak RSS growth is no more than 32 MiB.

Run the normal syntax and full test suites as well. The benchmark controls a repeatable local regression surface; provider latency, model quality and production workload performance still need appropriate environment evidence.

Estimated reduction must never be achieved by giving one profile an easier corpus, omitting a profile, suppressing overflow, or weakening mandatory markers.
