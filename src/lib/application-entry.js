import { prefillInputs } from "./application-preparation.js";
import { observeApplication, fillApplicationPage } from "./application-browser.js";
import { updateOpening } from "./application-workspace.js";

export async function enterApplication(root, openingId, { requestedOpeningId } = {}) {
  if (!openingId || requestedOpeningId !== openingId) {
    throw new Error("Live entry requires a separate explicit --live request for this exact named opening.");
  }
  const inputs = prefillInputs(root, openingId);
  const observed = await observeApplication(inputs.form.url, { headless: false });
  try {
    const result = await fillApplicationPage(observed.page, inputs);
    updateOpening(root, openingId, (entry) => ({
      ...entry, lastPrefill: {
        at: new Date().toISOString(), status: result.complete ? "entered_offline" : "partial",
        filled: result.filled, skipped: result.skipped, errors: result.errors,
      },
    }), { apply: true });
    const processId = observed.browser.process()?.pid;
    const closed = new Promise((resolve) => {
      if (observed.page.isClosed() || !observed.browser.connected) return resolve();
      observed.page.once("close", resolve);
      observed.browser.once("disconnected", resolve);
    });
    return { ...result, openingId, processId, submitted: false,
      handoff: "Browser stays open with scripts and network disabled while this command runs. Review incomplete fields, then close this guarded browser. Use the reviewed brief and your normal browser for manual completion and submission.",
      close: observed.close,
      waitForClose: async () => { await closed; await observed.close(); },
    };
  } catch (error) {
    await observed.close();
    throw error;
  }
}
