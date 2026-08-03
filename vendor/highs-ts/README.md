# @autoschedule/highs-ts

This project-local package is based on `@bubblyworld/highs-ts` 1.3.0 and
HiGHS 1.13.0. Its WebAssembly build additionally exports the official HiGHS
multi-objective and incremental-model C APIs required by autoschedule's
whole-day lexicographic solver.

The original MIT license is retained in `LICENSE`. Regular small solver jobs
continue to use the upstream npm package; this build is reserved for the
whole-day scheduling model.
