// Deterministic checks use Promptfoo test vars, never the target model's prompt.
function success(pass, reason, score = pass ? 1 : 0) {
  return { pass, score, reason };
}
function parseOutput(output) {
  if (typeof output !== 'string') {
    return output && typeof output === 'object' && !Array.isArray(output)
      ? output
      : null;
  }
  try {
    const parsed = JSON.parse(output);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}
function toolSelection(output, context) {
  const parsed = parseOutput(output);
  if (!parsed || !Array.isArray(parsed.tool_calls)) {
    return success(false, 'Provider output must contain a JSON tool_calls array.');
  }
  const expected = context.vars.expected_tools ?? [];
  // Tool strategy is unconstrained unless a case marks an operational result
  // as requiring a specific lookup. Policy support is checked via evidence recall.
  if (expected.length === 0) return success(true, 'No specific tool route required.');
  const actual = parsed.tool_calls;
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
  const parsed = parseOutput(output);
  if (!parsed || !Array.isArray(parsed.retrieved_sections)) {
    return success(false, 'Provider output must contain a JSON retrieved_sections array.');
  }
  const required = context.vars.relevant_sections ?? [];
  const seen = new Set(parsed.retrieved_sections);
  const missing = required.filter((id) => !seen.has(id));
  const score = required.length ? (required.length - missing.length) / required.length : 1;
  return success(missing.length === 0, missing.length ? 'Missing retrieved policy sections: ' + missing.join(', ') : 'All required policy sections available to the model.', score);
}
module.exports = { toolSelection, evidenceRecall };
