// Deterministic checks use Promptfoo test vars, never the target model's prompt.
function success(pass, reason, score = pass ? 1 : 0) {
  return { pass, score, reason };
}
function toolSelection(output, context) {
  const expected = context.vars.expected_tools ?? [];
  const actual = output.tool_calls ?? [];
  const allowed = new Set(expected.map((t) => t.name));
  const unexpected = actual.filter((c) => !allowed.has(c.name));
  const missing = expected.filter((expectation) =>
    !actual.some((call) => {
      if (call.name !== expectation.name) return false;
      return Object.entries(expectation.arguments ?? {}).every(
        ([key, value]) => call.args && call.args[key] === value,
      );
    }),
  );
  const pass = !unexpected.length && !missing.length;
  return success(pass, pass ? 'Required tools/arguments matched; no unexpected tools.' : 'Missing: ' + JSON.stringify(missing) + '; unexpected: ' + JSON.stringify(unexpected));
}
function evidenceRecall(output, context) {
  const required = context.vars.relevant_sections ?? [];
  const seen = new Set(output.retrieved_sections ?? []);
  const missing = required.filter((id) => !seen.has(id));
  const score = required.length ? (required.length - missing.length) / required.length : 1;
  return success(missing.length === 0, missing.length ? 'Missing retrieved policy sections: ' + missing.join(', ') : 'All required policy sections available to the model.', score);
}
module.exports = { toolSelection, evidenceRecall };
