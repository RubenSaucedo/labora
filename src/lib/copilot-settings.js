// Reads the host runtime's agent-model configuration.
//
// labora cannot ship model selection. Which model backs a sub-agent is a
// property of the operator's runtime, not of this plugin: there is no
// frontmatter field a plugin can set to choose one. The only place the choice
// lives is the CLI's own settings file, under `subagents.agents.<name>.model`.
//
// This module reads that file so the pipeline can *record what was configured*
// instead of asking an agent to introspect. An agent cannot report its own
// model: prompted directly, one runtime model answered "Claude 3.5 Sonnet"
// while actually running as claude-haiku-4.5. A confidently wrong answer is
// indistinguishable from a correct one, so self-report is not evidence.
//
// Honest limits, which callers must preserve rather than round off:
//   * This reads the *user* settings file. The CLI also accepts repo- and
//     local-scoped settings whose resolution order is not documented, so
//     configuration may exist that this module cannot see. The error is always
//     in the safe direction: unseen configuration can only make the real setup
//     *more* diverse than reported, never less.
//   * Configured is not observed. Knowing a model was selected is weaker than
//     knowing it ran. Nothing here should ever be described as proof that two
//     judges reasoned on different models.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TAILOR_AGENT = "resume-tailor";
export const JUDGE_AGENTS = ["judge-ats", "judge-engineer", "judge-hr"];

// COPILOT_HOME relocates the whole config directory; otherwise it is ~/.copilot.
export function configDir(env = process.env, homedir = os.homedir()) {
  return path.join(env.COPILOT_HOME || homedir, ".copilot");
}

export function defaultSettingsPath(env = process.env, homedir = os.homedir()) {
  return path.join(configDir(env, homedir), "settings.json");
}

// `status` distinguishes four cases that must never be collapsed:
//   ok           - the file was read and parsed
//   missing      - the config directory exists but holds no settings file, so
//                  nothing is configured (a knowable answer)
//   unsupported  - there is no config directory at all. This host is probably
//                  not the runtime whose configuration this module can read
//                  (labora also runs under Claude Code, which selects models
//                  by a mechanism this module cannot see). Unknown, not empty.
//   error        - a file exists but could not be read or parsed (unknown)
export function readCopilotSettings(settingsPath) {
  const resolved = path.resolve(settingsPath);
  if (!fs.existsSync(resolved)) {
    // An absent file inside an existing config directory means "configured
    // nothing". An absent directory means "this is not that runtime", which is
    // a different answer and must not be reported as the first one.
    const status = fs.existsSync(path.dirname(resolved)) ? "missing" : "unsupported";
    return {
      path: resolved,
      status,
      settings: {},
      error: status === "unsupported"
        ? `No config directory at ${path.dirname(resolved)}; this runtime's model configuration cannot be read.`
        : null,
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { path: resolved, status: "error", settings: {}, error: "settings.json is not a JSON object" };
    }
    return { path: resolved, status: "ok", settings: parsed, error: null };
  } catch (error) {
    return { path: resolved, status: "error", settings: {}, error: error.message };
  }
}

// True when the configuration was actually read, so per-agent answers are real
// rather than inferred from an empty stand-in object.
export function isKnown(status) {
  return status === "ok" || status === "missing";
}

// The model that will actually back `agentName`, and where that came from.
//
// A null model is not a failure: it means no name is configured anywhere and
// the runtime will apply its own default. That is still a complete answer for
// diversity, because every unconfigured agent inherits the *same* default.
export function effectiveModel(settings, agentName) {
  const perAgent = settings?.subagents?.agents?.[agentName]?.model;
  if (typeof perAgent === "string" && perAgent.trim()) {
    return { model: perAgent.trim(), source: `subagents.agents.${agentName}.model` };
  }
  const fallback = settings?.model;
  if (typeof fallback === "string" && fallback.trim()) {
    return { model: fallback.trim(), source: "model" };
  }
  return { model: null, source: "runtime default" };
}

// The value recorded as a judge's `metadata.model`, and the key calibration
// groups on. It is a bare model *identity*, never a description: the same model
// reached by inheritance and by an explicit per-agent pin must produce the same
// string, or calibration invents a model change that never happened. Provenance
// lives in `source`, which travels beside it.
export const UNKNOWN_MODEL = "unknown";

export function modelLabel({ status, model }) {
  if (!isKnown(status)) return UNKNOWN_MODEL;
  return model || "runtime-default";
}

// Looks up the recorded label for one agent in an existing report. Callers get
// the label without the report ever having to carry the raw settings file,
// which may hold configuration unrelated to models.
export function configuredModelLabel(report, agentName) {
  const entry = [report.tailor, ...report.judges].find((candidate) => candidate.agent === agentName);
  if (!entry) return UNKNOWN_MODEL;
  return entry.label;
}

// Are the judges backed by at least one model that differs from the tailor's?
//
// `diverse` is deliberately tri-state. `null` means the question could not be
// answered, which is different from answering "no" -- collapsing the two is how
// an unrunnable check starts looking like a passing one.
export function judgeModelReport({
  settingsPath = defaultSettingsPath(),
  env = process.env,
} = {}) {
  void env;
  const read = readCopilotSettings(settingsPath);
  const known = isKnown(read.status);
  // When the configuration could not be read, every per-agent field stays null.
  // Reporting `source: "runtime default"` and `differsFromTailor: false` from an
  // empty stand-in object would state three definite facts about a file nobody
  // managed to open -- exactly the collapse this module exists to prevent.
  const resolve = (agent) => {
    if (!known) return { agent, model: null, source: null, label: UNKNOWN_MODEL };
    const { model, source } = effectiveModel(read.settings, agent);
    return { agent, model, source, label: modelLabel({ status: read.status, model }) };
  };

  const tailor = resolve(TAILOR_AGENT);
  const judges = JUDGE_AGENTS.map((agent) => {
    const resolved = resolve(agent);
    return {
      ...resolved,
      differsFromTailor: known ? resolved.model !== tailor.model : null,
    };
  });

  const diverse = known ? judges.some((judge) => judge.differsFromTailor) : null;

  return {
    settingsPath: read.path,
    status: read.status,
    error: read.error,
    tailor,
    judges,
    diverse,
    // Every consumer of this report inherits this caveat. It travels with the
    // data so a release record cannot quietly upgrade it into a stronger claim.
    caveat: "Reflects configured models in the user settings file only. Configuration is not observation: it does not prove which model produced a verdict.",
  };
}
