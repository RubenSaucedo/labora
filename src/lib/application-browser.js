import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { mkdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import puppeteer from "puppeteer-core";
import { requireChrome } from "./browser.js";
import { sha256 } from "./persona-files.js";
import { captureFormDocument, formFingerprint } from "./application-form.js";

const observations = new WeakMap();
const NETWORK_POLICY = "connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'";

function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 ||
        (b === 0 && [0, 2].includes(c)) || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 ||
        (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  return isIP(address) === 6 && /^[23]/i.test(address) &&
    !/^2001:(?:0*:|0*[0-9a-f]{1,2}:|db8:)/i.test(address) && !/^(?:2002|3fff):/i.test(address);
}

export async function publicApplicationUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Use an explicit public HTTP(S) application URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Use an explicit public HTTP(S) URL without credentials.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  try { addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }); }
  catch { throw new Error("The public application host could not be resolved."); }
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
    throw new Error("Private, loopback and reserved application destinations are not supported.");
  }
  return { url, address: addresses[0].address };
}

function submissionGuards() {
  const stop = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  for (const name of ["submit", "requestSubmit"]) {
    Object.defineProperty(HTMLFormElement.prototype, name, {
      value() {}, writable: false, configurable: false,
    });
  }
  window.addEventListener("submit", stop, true);
  window.addEventListener("keydown", (event) => { if (event.key === "Enter") stop(event); }, true);
  Object.defineProperty(window, "open", { value: () => null, writable: false, configurable: false });
}

async function isolated(page, operation, argument) {
  const state = observations.get(page);
  if (!state) throw new Error("Observe this fresh browser page before application entry.");
  const { frameTree } = await state.session.send("Page.getFrameTree");
  const { executionContextId } = await state.session.send("Page.createIsolatedWorld", {
    frameId: frameTree.frame.id, worldName: "labora-application",
  });
  const response = await state.session.send("Runtime.callFunctionOn", {
    executionContextId, functionDeclaration: operation.toString(),
    arguments: argument === undefined ? [] : [{ value: argument }],
    returnByValue: true, awaitPromise: true,
  });
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description ?? "";
    if (description.includes("This posting is closed")) throw new Error("This posting is closed; obtain a current application form.");
    if (description.includes("No directly reachable")) throw new Error("No directly reachable application fields were found; reveal and login flows stay manual.");
    throw new Error("The application document could not be inspected safely.");
  }
  return response.result.value;
}

// Also used by local fixture hosts. This installs guards, but does not navigate
// or make a URL public: observeApplication is the public navigation boundary.
export async function guardApplicationPage(page, initialUrl) {
  if (observations.has(page)) throw new Error("This page is already observed; use a fresh browser.");
  if (page.url() !== "about:blank") throw new Error("Observation needs a fresh blank page, not an existing session.");
  const initial = new URL(initialUrl);
  initial.hash = "";
  const session = await page.createCDPSession();
  const { frameTree } = await session.send("Page.getFrameTree");
  const { targetInfo } = await session.send("Target.getTargetInfo");
  const state = { session, origin: initial.origin, frozen: false, started: false, failed: false };
  observations.set(page, state);
  await page.setBypassServiceWorker(true);
  await session.send("Network.enable");
  await session.send("Network.setBypassServiceWorker", { bypass: true });
  const allowedNavigations = new Set();
  session.on("Fetch.requestPaused", async (event) => {
    try {
      if (state.frozen || state.failed || event.responseErrorReason) {
        await session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
      } else if (event.responseStatusCode) {
        if (event.responseStatusCode >= 300 && event.responseStatusCode < 400) {
          await session.send("Fetch.continueResponse", { requestId: event.requestId });
        } else {
          const body = await session.send("Fetch.getResponseBody", { requestId: event.requestId });
          // Re-fulfill the unchanged body: continueResponse header overrides do
          // not reliably enforce CSP on supported installed Chrome versions.
          await session.send("Fetch.fulfillRequest", {
            requestId: event.requestId, responseCode: event.responseStatusCode,
            body: body.base64Encoded ? body.body : Buffer.from(body.body).toString("base64"),
            responseHeaders: [...(event.responseHeaders ?? []).filter(({ name }) =>
              !["content-encoding", "content-length", "transfer-encoding"].includes(name.toLowerCase())),
            { name: "Content-Security-Policy", value: NETWORK_POLICY }],
          });
        }
      } else {
        let allowed = false;
        try {
          const destination = new URL(event.request.url);
          const navigation = event.resourceType === "Document";
          const explicit = navigation && event.frameId === frameTree.frame.id &&
            ((!state.started && destination.href === initial.href) ||
              allowedNavigations.has(event.redirectedRequestId));
          allowed = event.request.method === "GET" &&
            destination.origin === initial.origin && !destination.username && !destination.password &&
            (navigation ? explicit : ["Script", "Stylesheet", "Image", "Font", "Media"].includes(event.resourceType));
          if (allowed && navigation) {
            state.started = true;
            allowedNavigations.add(event.requestId);
          }
        } catch { /* Non-HTTP destinations are not part of this observation. */ }
        await session.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed
          ? { requestId: event.requestId, interceptResponse: event.resourceType === "Document" }
          : { requestId: event.requestId, errorReason: "BlockedByClient" });
      }
    } catch {
      state.failed = true;
      await session.send("Fetch.failRequest", {
        requestId: event.requestId, errorReason: "BlockedByClient",
      }).catch(() => {});
    }
  });
  await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await page.evaluateOnNewDocument(submissionGuards);
  page.on("popup", (popup) => { void popup.close().catch(() => {}); });
  page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => {}); });
  const browserSession = await page.browser().target().createCDPSession();
  state.browserSession = browserSession;
  await browserSession.send("Browser.setDownloadBehavior", { behavior: "deny" });
  browserSession.on("Target.attachedToTarget", (event) => {
    if (event.targetInfo.type !== "page" || event.targetInfo.targetId !== targetInfo.targetId) {
      void browserSession.send("Target.closeTarget", { targetId: event.targetInfo.targetId })
        .catch(() => { state.failed = true; });
    }
  });
  await browserSession.send("Target.setAutoAttach", {
    autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
    filter: [{ type: "page" }, { type: "worker" }, { type: "shared_worker" }, { type: "service_worker" }],
  });
}

export async function captureApplicationPage(page) {
  const state = observations.get(page);
  if (!state || state.failed) throw new Error("Application observation guards are unavailable; start a fresh browser.");
  const actual = new URL(page.url());
  if (!["http:", "https:"].includes(actual.protocol) || actual.origin !== state.origin) {
    throw new Error("The document left its explicitly observed HTTP(S) origin; obtain a fresh direct application URL.");
  }
  const document = await isolated(page, captureFormDocument);
  const form = {
    schemaVersion: "1.0", url: page.url(), capturedAt: new Date().toISOString(),
    ...document,
  };
  form.limitations.push("Observation blocks cross-origin resources, background API requests, frames, workers, popups and submission.");
  form.snapshotHash = formFingerprint(form);
  return form;
}

export async function launchApplicationBrowser({ headless = true, resolverRule } = {}) {
  let executablePath;
  try { executablePath = requireChrome(); }
  catch { throw new Error("Application browser checks require Chrome. Install Chrome or set LABORA_CHROME to its executable."); }
  const directory = path.resolve(".labora-browser-sessions", randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const cleanup = async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rmdir(path.dirname(directory)).catch(() => {});
  };
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath, headless, userDataDir: directory,
      env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
      args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking",
        "--disable-sync", "--disable-extensions", "--disable-component-update", "--no-proxy-server",
        "--disable-breakpad", "--disable-crash-reporter", "--block-new-web-contents",
        "--disable-quic", "--dns-prefetch-disable",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ...(resolverRule ? [`--host-resolver-rules=${resolverRule}`] : [])],
    });
  } catch {
    await cleanup();
    throw new Error("Could not launch a fresh application browser; check Chrome and LABORA_CHROME.");
  }
  return {
    browser,
    close: async () => {
      await browser.close();
      await cleanup();
    },
  };
}

export async function observeApplication(url, { headless = true } = {}) {
  const destination = await publicApplicationUrl(url);
  const address = destination.address.includes(":") ? `[${destination.address}]` : destination.address;
  const handle = await launchApplicationBrowser({
    headless, resolverRule: `MAP ${destination.url.hostname} ${address}, MAP * ~NOTFOUND`,
  });
  try {
    const pages = await handle.browser.pages();
    const page = pages[0] ?? await handle.browser.newPage();
    await guardApplicationPage(page, destination.url.href);
    await page.goto(destination.url.href, { waitUntil: "networkidle0", timeout: 30000 });
    const form = await captureApplicationPage(page);
    return { ...handle, page, form };
  } catch {
    await handle.close();
    throw new Error("The application form could not be observed safely. Closed, empty, login, reveal and cross-origin redirect flows stay manual.");
  }
}

async function freeze(page) {
  const state = observations.get(page);
  if (!state || state.failed) throw new Error("Application guards are unavailable; no applicant data was entered.");
  state.frozen = true;
  try {
    await page.setJavaScriptEnabled(false);
    await state.session.send("Emulation.setScriptExecutionDisabled", { value: true });
    await state.session.send("Network.setBlockedURLs", { urls: ["*"] });
    await state.session.send("Network.emulateNetworkConditions", {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });
    await state.session.send("Network.setBypassServiceWorker", { bypass: true });
    await state.session.send("Page.stopLoading");
  } catch {
    throw new Error("Could not enforce offline, script-disabled entry; no applicant data was entered.");
  }
  if (state.failed) throw new Error("Application guards failed; no applicant data was entered.");
}

// No site methods or events are called. Native prototypes here belong to the
// isolated world, so page-defined setters cannot observe the supplied answers.
export function enterApplicationAnswers({ questions, decisions, artifact }) {
  const filled = [];
  const skipped = [];
  const errors = [];
  const error = (questionId, code) => errors.push({ questionId, code,
    message: "The current native control could not receive this exact approved answer; review it manually." });
  const one = (selector) => {
    const matches = document.querySelectorAll(selector);
    if (matches.length !== 1) throw new Error(matches.length ? "ambiguous_target" : "missing_target");
    return matches[0];
  };
  const usable = (element) => {
    if (element.matches(":disabled") || element.readOnly || element.getAttribute("aria-disabled") === "true" ||
        element.closest("[role=combobox],[hidden],[inert]") ||
        getComputedStyle(element).display === "none" || getComputedStyle(element).visibility === "hidden") {
      throw new Error("unavailable_target");
    }
  };
  const input = (element, type) => {
    usable(element);
    if (!(element instanceof HTMLInputElement) || element.type !== type ||
        ["submit", "image", "button", "reset", "hidden"].includes(element.type)) throw new Error("changed_control");
  };
  for (const question of questions) {
    const decision = decisions.find((item) => item.questionId === question.id);
    if (!decision || decision.canFill !== true || decision.status === "self_id") {
      skipped.push(question.id);
      continue;
    }
    try {
      if (question.disabled || question.readOnly || ["unsupported", "combobox"].includes(question.type)) {
        throw new Error("unsupported_control");
      }
      const target = one(question.selector);
      usable(target);
      const constraints = question.constraints ?? {};
      for (const [key, attribute] of Object.entries({
        maxLength: "maxlength", minLength: "minlength", pattern: "pattern", accept: "accept",
        min: "min", max: "max", multiple: "multiple",
      })) {
        if (["radio-group", "checkbox-group"].includes(question.type)) break;
        const actual = key === "multiple" ? (target.hasAttribute(attribute) ? true : undefined) :
          target.hasAttribute(attribute) ? target.getAttribute(attribute) : undefined;
        if (String(actual) !== String(constraints[key] === true ? true : constraints[key])) {
          throw new Error("changed_constraints");
        }
      }
      if (["radio-group", "checkbox-group"].includes(question.type)) {
        const type = question.type === "radio-group" ? "radio" : "checkbox";
        const values = Array.isArray(decision.value) ? decision.value : [decision.value];
        if ((type === "radio" && values.length !== 1) ||
            values.some((value) => question.options.filter((option) => option.value === value && !option.disabled).length !== 1)) {
          throw new Error("invalid_option");
        }
        const members = question.options.map((option) => {
          const element = one(option.selector);
          if (!(element instanceof HTMLInputElement) || element.type !== type ||
              !target.contains(element) || (element.getAttribute("value") ?? "on") !== option.value) {
            throw new Error("changed_control");
          }
          if (element.matches(":disabled") !== Boolean(option.disabled)) throw new Error("changed_control");
          if (!option.disabled) usable(element);
          return element;
        });
        if (type === "radio" && members.some((member) =>
          !member.name || member.name !== members[0].name || member.form !== members[0].form)) {
          throw new Error("changed_control");
        }
        if (type === "checkbox" && members.some((member, index) =>
          question.options[index].disabled && member.checked &&
          !values.includes(question.options[index].value))) throw new Error("unavailable_target");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked").set;
        const previous = members.map((member) => member.checked);
        members.forEach((member, index) => {
          if (!question.options[index].disabled) setter.call(member, values.includes(question.options[index].value));
        });
        if (members.some((member) => !member.validity.valid)) {
          members.forEach((member, index) => setter.call(member, previous[index]));
          throw new Error("invalid_value");
        }
      } else if (question.type === "checkbox") {
        input(target, "checkbox");
        if (typeof decision.value !== "boolean") throw new Error("invalid_value");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked").set;
        const previous = target.checked;
        setter.call(target, decision.value);
        if (!target.validity.valid) {
          setter.call(target, previous);
          throw new Error("invalid_value");
        }
      } else if (question.type === "select") {
        if (!(target instanceof HTMLSelectElement) || target.multiple) throw new Error("changed_control");
        const options = Array.from(target.options).filter((option) => option.value === decision.value);
        if (options.length !== 1 || options[0].disabled || options[0].closest("optgroup")?.disabled) {
          throw new Error("invalid_option");
        }
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        const previous = target.value;
        setter.call(target, decision.value);
        if (!target.validity.valid) {
          setter.call(target, previous);
          throw new Error("invalid_value");
        }
      } else if (question.type === "file") {
        input(target, "file");
        if (question.attachment !== "resume" || !artifact ||
            decision.artifact?.sha256 !== artifact.sha256) throw new Error("unapproved_artifact");
        const accepted = (target.accept || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
        if (accepted.length && !accepted.some((item) => item.startsWith(".")
          ? artifact.name.toLowerCase().endsWith(item)
          : item.endsWith("/*") ? artifact.mime.startsWith(item.slice(0, -1)) : item === artifact.mime)) {
          throw new Error("artifact_type");
        }
        const bytes = Uint8Array.from(atob(artifact.base64), (character) => character.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], artifact.name, { type: artifact.mime }));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files").set.call(target, transfer.files);
      } else {
        if (question.type === "textarea") {
          if (!(target instanceof HTMLTextAreaElement)) throw new Error("changed_control");
        } else {
          if (!["text", "email", "tel", "url", "number", "date"].includes(question.type)) throw new Error("unsupported_control");
          input(target, question.type);
        }
        if (typeof decision.value !== "string" ||
            (constraints.maxLength >= 0 && decision.value.length > constraints.maxLength) ||
            (constraints.minLength > decision.value.length)) throw new Error("invalid_value");
        const prototype = question.type === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
        const previous = target.value;
        setter.call(target, decision.value);
        if (target.value !== decision.value || !target.validity.valid) {
          setter.call(target, previous);
          throw new Error("invalid_value");
        }
      }
      filled.push(question.id);
    } catch (failure) {
      error(question.id, ["ambiguous_target", "missing_target", "unavailable_target", "changed_control",
        "changed_constraints", "unsupported_control", "invalid_option", "invalid_value", "unapproved_artifact",
        "artifact_type"].includes(failure.message) ? failure.message : "entry_failed");
    }
  }
  const complete = !errors.length && skipped.every((id) => {
    const question = questions.find((item) => item.id === id);
    return !question.required && decisions.find((item) => item.questionId === id)?.status === "self_id";
  });
  return { complete, filled, skipped, errors, networkDisabled: true };
}

export async function fillApplicationPage(page, { form, plan, resumeBytes = null }) {
  if (!form?.questions?.length || form.snapshotHash !== formFingerprint(form) ||
      plan?.readyForEntry !== true || plan.formHash !== form.snapshotHash) {
    throw new Error("Entry needs a fresh matching form and a ready, separately approved answer plan.");
  }
  const fresh = await captureApplicationPage(page);
  if (fresh.snapshotHash !== form.snapshotHash) {
    throw new Error("The application form changed; observe it again and make a fresh answer plan.");
  }
  if (!Array.isArray(plan.decisions) || new Set(plan.decisions.map((item) => item.questionId)).size !== plan.decisions.length ||
      plan.decisions.some((item) => !form.questions.some((question) => question.id === item.questionId))) {
    throw new Error("The answer plan contains invalid or duplicate question bindings.");
  }
  let artifact = null;
  if (resumeBytes !== null) {
    if (!Buffer.isBuffer(resumeBytes) || sha256(resumeBytes) !== plan.resume?.artifact?.sha256) {
      throw new Error("Resume bytes do not match the exact approved artifact; nothing was entered.");
    }
    const name = path.basename(plan.resume.artifact.path ?? "resume.pdf");
    const mime = /\.pdf$/i.test(name) ? "application/pdf" :
      /\.docx$/i.test(name) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" :
        "application/octet-stream";
    artifact = { base64: resumeBytes.toString("base64"), sha256: sha256(resumeBytes), name, mime };
  }
  await freeze(page);
  const frozen = await captureApplicationPage(page);
  if (frozen.snapshotHash !== form.snapshotHash) {
    throw new Error("The application form changed while freezing; re-observe and replan before entering data.");
  }
  try {
    return await isolated(page, enterApplicationAnswers, {
      questions: form.questions, decisions: plan.decisions, artifact,
    });
  } catch {
    return {
      complete: false, filled: [], skipped: form.questions.map((question) => question.id),
      errors: [{ code: "entry_interrupted",
        message: "Entry was interrupted; some values may have changed but could not be verified. Inspect the browser manually." }],
      networkDisabled: true,
    };
  }
}
