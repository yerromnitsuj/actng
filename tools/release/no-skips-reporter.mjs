// The only non-release test spends live model API tokens and evaluates a
// probabilistic explainer. Its deterministic tools are tested independently.
const optionalModelEvaluation = {
  file: "/packages/agents/test/divergence.test.ts",
  suite: "live divergence explainer (opt-in)",
  name: "names sigma_interpolation as the misaligned flag on the committed misaligned pair",
};

export function unapprovedSkips(files) {
  const skipped = [];
  function visit(task, file, parents) {
    if (task.type === "test" && ["skip", "todo"].includes(task.mode)) {
      const exempt =
        task.mode === "skip" &&
        file.endsWith(optionalModelEvaluation.file) &&
        parents.includes(optionalModelEvaluation.suite) &&
        task.name === optionalModelEvaluation.name;
      if (!exempt)
        skipped.push(`${file}: ${[...parents, task.name].join(" > ")}`);
    }
    for (const child of task.tasks ?? [])
      visit(child, file, [...parents, task.name]);
  }
  for (const file of files)
    visit(file, file.filepath.replaceAll("\\", "/"), []);
  return skipped;
}

export default class NoSkipsReporter {
  onFinished(files = []) {
    const skipped = unapprovedSkips(files);
    if (skipped.length) {
      console.error(
        `Release tests may not skip applicable cases:\n${skipped.join("\n")}`,
      );
      process.exitCode = 1;
    }
  }
}
