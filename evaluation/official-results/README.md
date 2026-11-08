# Official benchmark results

Each `v<version>/` directory is an immutable, reviewable snapshot of one
official run. It contains the run's original artifacts, a `release.json`
recording the benchmark version and source run, and `SHA256SUMS` for the
copied run artifacts. The source under `evaluation/results/` remains the
working output and is not changed when a snapshot is promoted.

Use the version in `evaluation/benchmark.json` for the current benchmark
definition. Run timestamps identify individual executions; they do not replace
the benchmark version. Do not overwrite an existing version directory.

For future releases:

- Increment the major version when scoring meaning or core evaluation behavior
  changes, including prompts, tools, retrieval, policy/data snapshots, judge,
  rubric, or existing expected labels.
- Increment the minor version when adding independently reviewed cases or
  categories without changing existing labels. Aggregate scores across such
  versions have different test mixes.
- Increment the patch version for documentation or report-only changes that
  cannot affect model inputs, execution, grading, or scores.

Record model candidates and run parameters in each run's metadata. Changing
only the candidate model list does not change the benchmark version. Keep
dataset, selected-case, source, judge, and parameter hashes/configuration fixed
when making direct score comparisons.

To verify a snapshot's copied run artifacts, change into its version directory
and run `sha256sum --check SHA256SUMS`.
