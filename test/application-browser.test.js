import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sha256 } from "../src/lib/persona-files.js";
import { formFingerprint } from "../src/lib/application-form.js";
import { planApplication, valueSha256 } from "../src/lib/application-plan.js";
import {
  launchApplicationFixtureBrowser, applicationBrowserLaunchError, applicationBrowserProfileDirectory, captureApplicationPage,
  fillApplicationPage, enterApplicationAnswers, observeApplication, publicApplicationUrl,
} from "../src/lib/application-browser.js";

const openingId = "synthetic-opening";
const at = "2026-10-01T10:00:00Z";
const approved = (value) => ({ kind: "fact", value,
  confirmation: { reference: "synthetic-confirmation", at, valueSha256: valueSha256(value) } });

async function fixture(t, html) {
  const counts = { writes: 0, requests: [], clicks: 0 };
  const server = createServer((request, response) => {
    counts.requests.push(`${request.method} ${request.url}`);
    if (request.url === "/form" && request.method === "GET") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><meta charset="utf-8">${html}`);
    } else {
      counts.writes++;
      response.end("unexpected transport");
    }
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const url = `http://127.0.0.1:${server.address().port}/form`;
  const handle = await launchApplicationFixtureBrowser(url);
  t.after(() => handle.close());
  return { ...handle, counts, url };
}

test("sandbox-free fixture launch rejects public or non-fixture destinations before starting Chrome", async () => {
  for (const url of ["https://example.invalid:8443/form", "http://192.168.1.1:8080/form",
    "http://127.0.0.1/form", "file:///synthetic/form", "/relative"]) {
    await assert.rejects(launchApplicationFixtureBrowser(url), /explicit HTTP loopback/);
  }
});

test("Chrome launch diagnostics retain actionable categories without exposing raw stderr or private paths", () => {
  const failures = [
    ["No usable sandbox! /synthetic/private/profile https://example.invalid/?token=SENTINEL", /sandbox.*user-namespace/i],
    ["Failed to move to new namespace: Operation not permitted /synthetic/private/profile", /sandbox/i],
    ["The browser is already running for /synthetic/private/profile. Use a different userDataDir.", /category=profile-singleton.*runtime-directory socket-path/i],
    ["error while loading shared libraries: /synthetic/private/libSENTINEL.so", /runtime libraries/i],
    ["Missing X server or $DISPLAY /synthetic/private/profile", /desktop display/i],
    ["spawn /synthetic/private/chrome ENOENT", /could not be found/i],
    ["permission denied: /synthetic/private/profile", /workspace permissions/i],
    ["Timed out waiting for ws://127.0.0.1:1234/SENTINEL", /automation endpoint.*timeout/i],
    ["Unrecognized crash https://example.invalid/?token=SENTINEL /synthetic/private/profile", /platform dependencies/i],
  ];
  for (const [message, expected] of failures) {
    const diagnostic = applicationBrowserLaunchError(new Error(message)).message;
    assert.match(diagnostic, expected);
    assert.doesNotMatch(diagnostic, /SENTINEL|synthetic\/private|example\.invalid|127\.0\.0\.1|ws:\/\//);
  }
});

test("launch diagnostics distinguish protocol, closed-target and post-launch failures without raw exception data", () => {
  for (const [name, message, category] of [
    ["TargetCloseError", "Protocol error (Target.setAutoAttach): Target closed. /synthetic/private/SENTINEL", "target-closed"],
    ["ProtocolError", "Protocol error (Target.getBrowserContexts): https://example.invalid/SENTINEL", "protocol"],
    ["Error", "Failed to launch the browser process: Code: 21 /synthetic/private/SENTINEL", "browser-process-exit"],
  ]) {
    const error = new Error(message);
    error.name = name;
    const diagnostic = applicationBrowserLaunchError(error, {
      stage: "puppeteer-launch", profilePathBytes: 96,
    }).message;
    assert.match(diagnostic, new RegExp(`stage=puppeteer-launch; category=${category}; cause=${name}`));
    assert.match(diagnostic, /profile-path-bytes=96/);
    if (name === "TargetCloseError") assert.match(diagnostic, /method=Target\.setAutoAttach/);
    assert.doesNotMatch(diagnostic, /SENTINEL|synthetic\/private|example\.invalid/);
  }
  const postLaunch = applicationBrowserLaunchError(new Error("SENTINEL"), { stage: "guard-installation" }).message;
  assert.match(postLaunch, /stage=guard-installation; category=unclassified; cause=Error/);
  assert.doesNotMatch(postLaunch, /SENTINEL/);
});

test("fresh Linux profiles fit singleton socket limits instead of repeating the nested-profile CI failure", () => {
  const checkout = "/synthetic/runner/work/repository";
  const directory = applicationBrowserProfileDirectory(checkout, { platform: "linux" });
  assert.equal(path.dirname(directory), checkout);
  assert.ok(Buffer.byteLength(directory) <= 52);
  assert.ok(Buffer.byteLength(`${directory}/SingletonSocket`) <= 107);
  assert.ok(Buffer.byteLength(`${directory}/.org.chromium.Chromium.XXXXXX/SingletonSocket`) <= 107);
  const tooLong = `/synthetic/private/${"SENTINEL".repeat(12)}`;
  assert.throws(() => applicationBrowserProfileDirectory(tooLong, { platform: "linux" }), (error) => {
    assert.match(error.message, /shorter working-directory path/);
    assert.doesNotMatch(error.message, /synthetic\/private|SENTINEL/);
    return true;
  });
});

test("a fresh browser owns a private short profile and removes it on close", async (t) => {
  const { browser, close } = await fixture(t, `<label>Name<input></label>`);
  const argument = browser.process().spawnargs.find((value) => value.startsWith("--user-data-dir="));
  const directory = argument.slice("--user-data-dir=".length);
  assert.equal(path.dirname(directory), process.cwd());
  if (process.platform !== "win32") assert.equal((await stat(directory)).mode & 0o777, 0o700);
  await close();
  await assert.rejects(stat(directory), { code: "ENOENT" });
});

function plan(form, values = {}, options = {}) {
  const bank = { schemaVersion: "1.0", answers: {}, bindings: {} };
  for (const question of form.questions) {
    if (!Object.hasOwn(values, question.label)) continue;
    const value = values[question.label];
    bank.answers[question.id] = value?.kind ? value : approved(value);
    bank.bindings[question.id] = { answer: question.id };
  }
  return planApplication(form, bank, { openingId, country: "US", ...options });
}

test("public navigation rejects credentials, private and non-HTTP destinations without opening Chrome", async () => {
  for (const url of ["file:///etc/hosts", "http://127.0.0.1/", "http://[::1]/",
    "https://name:secret@example.invalid/", "http://192.168.1.1/", "http://169.254.169.254/",
    "http://[2001:db8::1]/"]) {
    await assert.rejects(observeApplication(url), (error) => {
      assert.doesNotMatch(error.message, /secret|name:|192\.168|169\.254/);
      return true;
    });
  }
  await assert.rejects(publicApplicationUrl("/relative"), /explicit public/);
});

test("observation never clicks ambiguous Apply or implicit submit controls, including GET and novalidate", async (t) => {
  const { page, counts } = await fixture(t, `
    <form id="post" action="/write" method="post" novalidate>
      <label>Email<input id="mail" type="email" required></label>
      <button type="submit" onclick="window.clicked++">Apply</button>
      <button onclick="window.clicked++">Apply</button><input type="submit" value="Send">
      <input type="image" alt="Apply">
    </form>
    <form id="get" action="/write" method="get" novalidate>
      <label>Website<input id="site" type="url"></label><button>Apply</button>
    </form>
    <script>
      window.clicked=0;
      window.submissions=0;
      document.querySelectorAll("form").forEach(form=>form.addEventListener("submit",()=>window.submissions++));
      document.querySelector("#post").submit();
      document.querySelector("#post").requestSubmit();
      document.querySelector("#get").submit();
      document.querySelector("#get").requestSubmit();
      fetch("/write",{method:"POST"}).catch(()=>{});
      fetch("/write").catch(()=>{});
      navigator.sendBeacon("/write","no");
      try { new WebSocket("ws://"+location.host+"/write"); } catch {}
      try { new EventSource("/write"); } catch {}
      try { new Worker("/write"); } catch {}
      navigator.serviceWorker.register("/write").catch(()=>{});
      window.open("/write");
    </script>`);
  const form = await captureApplicationPage(page);
  assert.equal(form.questions.length, 2);
  assert.equal(form.submitControls.length, 5);
  assert.ok(form.submitControls.every((control) => ["submit", "image"].includes(control.type)));
  assert.equal(form.submitControls.filter((control) => control.formNoValidate).length, 5);
  await page.focus("#mail");
  await page.keyboard.press("Enter");
  await page.focus("#site");
  await page.keyboard.press("Enter");
  await delay(50);
  assert.equal(await page.evaluate(() => window.clicked), 0);
  assert.equal(await page.evaluate(() => window.submissions), 0);
  assert.equal(counts.writes, 0);
  assert.equal(page.url(), form.url);
});

test("capture groups options, resolves external and parent labels, and never retains applicant values", async (t) => {
  const { page } = await fixture(t, `
    <span id="external">Full name ＊</span><input aria-labelledby="external" id="name" value="PRIVATE_SENTINEL">
    <label for="bio">Biography</label><textarea id="bio">PRIVATE_SENTINEL</textarea>
    <fieldset><legend>Preferred schedule ∗</legend>
      <label><input id="morning" type="radio" name="schedule" value="am" checked>Morning</label>
      <label for="evening">Evening</label><input id="evening" type="radio" name="schedule" value="pm">
    </fieldset>
    <fieldset><legend>Languages</legend>
      <label><input type="checkbox" name="languages" value="a" checked>Language A</label>
      <label><input type="checkbox" name="languages" value="b">Language B</label>
    </fieldset>
    <fieldset><legend>Voluntary disability self-identification</legend><fieldset><legend>Preference</legend>
      <label><input type="checkbox" id="private">Yes</label></fieldset>
    </fieldset>
    <label for="country">Country</label><select id="country"><option value="us" selected>USA</option><option value="ca" disabled>Canada</option></select>
    <span id="custom-label">Custom choice</span>
    <div role="combobox" aria-labelledby="custom-label" aria-controls="choices"></div>
    <div id="choices" role="listbox"><div role="option" data-value="a">Option A</div><div role="option" data-value="b" aria-disabled="true">Option B</div></div>
    <label>Résumé<input type="file" accept=".pdf" id="resume"></label>
    <label>Cover letter<input type="file" id="cover"></label>
    <label>Other attachment<input type="file" id="other"></label>`);
  const form = await captureApplicationPage(page);
  const byType = (type) => form.questions.find((question) => question.type === type);
  assert.equal(form.questions.find((question) => question.selector === "#name").label, "Full name ＊");
  assert.equal(form.questions.find((question) => question.selector === "#name").required, true);
  assert.equal(byType("radio-group").required, true);
  assert.equal(byType("radio-group").label, "Preferred schedule ∗");
  assert.deepEqual(byType("radio-group").options.map(({ label, value }) => ({ label, value })),
    [{ label: "Morning", value: "am" }, { label: "Evening", value: "pm" }]);
  assert.equal(byType("checkbox-group").options.length, 2);
  assert.equal(byType("combobox").options[1].disabled, true);
  assert.equal(byType("combobox").options[0].value, "a");
  assert.equal(byType("select").options[1].disabled, true);
  assert.deepEqual(form.questions.filter((question) => question.type === "file")
    .map((question) => question.attachment), ["resume", "cover_letter", "other"]);
  assert.doesNotMatch(JSON.stringify(form), /PRIVATE_SENTINEL|"selected"|"checked"/);
  const originalHash = form.snapshotHash;
  await page.evaluate(() => {
    document.querySelector("#name").value = "CHANGED_SENTINEL";
    document.querySelector("#bio").value = "CHANGED_SENTINEL";
    document.querySelector("#morning").checked = false;
    document.querySelector("#country").selectedIndex = -1;
  });
  const again = await captureApplicationPage(page);
  assert.equal(again.snapshotHash, originalHash);
  assert.deepEqual(again.questions.map((question) => question.id), form.questions.map((question) => question.id));
  assert.equal(formFingerprint({ ...form, capturedAt: "different", producer: "workspace", openingId: "other" }), originalHash);
  const decisions = plan(form).decisions;
  assert.equal(decisions.find((decision) => decision.label.includes("disability")).status, "self_id");
});

test("unknown custom required controls stay visible in the plan as manual work", async (t) => {
  const { page } = await fixture(t, `
    <label>Name<input id="name"></label>
    <div role="radiogroup" aria-label="Custom choice" aria-required="true">
      <div role="radio" aria-label="A"></div><div role="radio" aria-label="B"></div>
    </div>`);
  const form = await captureApplicationPage(page);
  assert.equal(form.questions.length, 2);
  const result = plan(form, { Name: "Synthetic" });
  assert.equal(result.readyForEntry, false);
  assert.equal(result.decisions.find((decision) => decision.label === "Custom choice").status, "manual");
  await assert.rejects(fillApplicationPage(page, { form, plan: result }), /ready/);
});

test("closed and empty pages are not successful captures", async (t) => {
  for (const html of ["<h1>This position is closed</h1><label>Name<input></label>",
    "<h1>We are no longer accepting applications</h1><label>Name<input></label>",
    "<button>Apply to reveal fields</button>"]) {
    await t.test(html.startsWith("<button") ? "empty" : "closed", async (child) => {
      const { page } = await fixture(child, html);
      await assert.rejects(captureApplicationPage(page), /closed|No directly reachable/);
    });
  }
  assert.equal(typeof formFingerprint({ url: "https://example.invalid", questions: [], submitControls: [] }), "string");
});

test("stale forms and stale plans reject before entering any answer", async (t) => {
  const { page } = await fixture(t, `<label>Full name<input id="name" required></label>`);
  const form = await captureApplicationPage(page);
  const approvedPlan = plan(form, { "Full name": "Synthetic Example" });
  await assert.rejects(fillApplicationPage(page, { form, plan: { ...approvedPlan, formHash: "stale" } }), /matching/);
  await assert.rejects(fillApplicationPage(page, { form, plan: { ...approvedPlan, readyForEntry: false } }), /ready/);
  await page.evaluate(() => document.querySelector("#name").setAttribute("maxlength", "8"));
  await assert.rejects(fillApplicationPage(page, { form, plan: approvedPlan }), /changed/);
  assert.equal(await page.$eval("#name", (element) => element.value), "");
});

test("failure to disable page scripts fails closed without entering any data", async (t) => {
  const { page, counts } = await fixture(t, `<label>Name<input id="name"></label>`);
  const form = await captureApplicationPage(page);
  page.setJavaScriptEnabled = async () => { throw new Error("Synthetic CDP failure"); };
  await assert.rejects(fillApplicationPage(page, { form, plan: plan(form, { Name: "Synthetic" }) }),
    /Could not enforce offline/);
  assert.equal(await page.$eval("#name", (element) => element.value), "");
  assert.equal(counts.writes, 0);
});

test("approved native answers enter offline without site setters, input/change handlers or post-freeze traffic", async (t) => {
  const { page, counts } = await fixture(t, `
    <form id="form" method="post" action="/write" novalidate>
      <label>Name<input id="name" maxlength="40" required></label>
      <label>Biography<textarea id="bio"></textarea></label>
      <label>Country<select id="country"><option value="a">Country A</option><option value="b">Country B</option></select></label>
      <fieldset><legend>Schedule</legend><label><input type="radio" name="shift" value="a">A</label><label><input type="radio" name="shift" value="b">B</label></fieldset>
      <fieldset><legend>Languages</legend><label><input type="checkbox" name="lang" value="a">A</label><label><input type="checkbox" name="lang" value="b">B</label></fieldset>
      <label>Willing to relocate<input id="relocate" type="checkbox"></label><button>Apply</button>
    </form>
    <script>
      window.events=0; window.setters=0; window.ticks=0;
      const native=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
      Object.defineProperty(HTMLInputElement.prototype,"value",{get:native.get,set(value){window.setters++;native.set.call(this,value)}});
      document.addEventListener("input",()=>{window.events++;fetch("/write",{method:"POST"})});
      document.addEventListener("change",()=>{window.events++;navigator.sendBeacon("/write","no")});
      setInterval(()=>{window.ticks++},10);
    </script>`);
  const form = await captureApplicationPage(page);
  const approvedPlan = plan(form, { Name: "Synthetic Example", Biography: "Exact synthetic text.",
    Country: "b", Schedule: "b", Languages: ["a", "b"], "Willing to relocate": true });
  const result = await fillApplicationPage(page, { form, plan: approvedPlan });
  assert.equal(result.networkDisabled, true);
  assert.equal(result.complete, true);
  assert.equal(result.filled.length, 6);
  assert.deepEqual(result.errors, []);
  const live = page;
  assert.deepEqual(await live.evaluate(() => ({
    name: document.querySelector("#name").value, bio: document.querySelector("#bio").value,
    country: document.querySelector("#country").value,
    schedule: document.querySelector('input[name=shift]:checked').value,
    languages: [...document.querySelectorAll('input[name=lang]:checked')].map((element) => element.value),
    relocate: document.querySelector("#relocate").checked, events: window.events, setters: window.setters,
  })), {
    name: "Synthetic Example", bio: "Exact synthetic text.", country: "b",
    schedule: "b", languages: ["a", "b"], relocate: true, events: 0, setters: 0,
  });
  const baseline = counts.requests.length;
  const ticks = await live.evaluate(() => window.ticks);
  await live.evaluate(() => {
    HTMLFormElement.prototype.submit.call(document.querySelector("#form"));
    document.querySelector("#form").requestSubmit();
    fetch("/write",{method:"POST"}).catch(()=>{});
    fetch("/write").catch(()=>{});
    navigator.sendBeacon("/write","no");
    new Image().src="/write?image";
    try { new WebSocket("ws://"+location.host+"/write"); } catch {}
    try { new Worker("/write"); } catch {}
  });
  await live.focus("#name");
  await live.keyboard.press("Enter");
  await delay(100);
  assert.equal(counts.requests.length, baseline);
  assert.equal(counts.writes, 0);
  assert.equal(await live.evaluate(() => window.ticks), ticks);
});

test("sensitive, unapproved and consent fields stay untouched, and manual fields make the result incomplete", async (t) => {
  const { page } = await fixture(t, `
    <label>Name<input id="name"></label>
    <label>Why this opening?<textarea id="essay">UNAPPROVED_SENTINEL</textarea></label>
    <fieldset><legend>Voluntary self-identification</legend><label>Gender<input id="sensitive" value="SENSITIVE_SENTINEL"></label></fieldset>
    <label>I agree to the privacy policy<input id="consent" type="checkbox"></label>`);
  const form = await captureApplicationPage(page);
  const proposed = { kind: "essay", value: "Unapproved synthetic proposal" };
  const approvedPlan = plan(form, { Name: "Synthetic", "Why this opening?": proposed,
    "I agree to the privacy policy": true });
  const sensitive = approvedPlan.decisions.find((decision) => decision.status === "self_id");
  sensitive.canFill = true;
  sensitive.value = "MUST_NOT_ENTER";
  const result = await fillApplicationPage(page, { form, plan: approvedPlan });
  assert.equal(result.complete, false);
  assert.equal(result.skipped.length, 3);
  assert.deepEqual(await page.evaluate(() => [
    document.querySelector("#essay").value, document.querySelector("#sensitive").value,
    document.querySelector("#consent").checked,
  ]), ["UNAPPROVED_SENTINEL", "SENSITIVE_SENTINEL", false]);
});

test("optional self-identification alone does not make successful entry incomplete", async (t) => {
  const { page } = await fixture(t, `<label>Name<input id="name"></label><label>Gender<input id="gender"></label>`);
  const form = await captureApplicationPage(page);
  const result = await fillApplicationPage(page, { form, plan: plan(form, { Name: "Synthetic" }) });
  assert.equal(result.complete, true);
  assert.equal(result.skipped.length, 1);
});

test("an essay is entered exactly only after question-and-opening-specific text approval", async (t) => {
  const { page } = await fixture(t, `<label>Why this opening?<textarea id="essay" required></textarea></label>`);
  const form = await captureApplicationPage(page);
  const value = 'Exact synthetic proposal — "unchanged".\nSecond line.';
  const essay = { kind: "essay", value, approval: {
    reference: "synthetic-approval", at, openingId, questionId: form.questions[0].id,
    valueSha256: valueSha256(value),
  } };
  const approvedPlan = plan(form, { "Why this opening?": essay });
  const result = await fillApplicationPage(page, { form, plan: approvedPlan });
  assert.equal(result.complete, true);
  assert.equal(await page.$eval("#essay", (element) => element.value), value);
});

test("only the exact approved resume bytes attach in memory, never cover letters or HTTP uploads", async (t) => {
  const { page, counts } = await fixture(t, `
    <form action="/write" method="post" enctype="multipart/form-data">
      <label>Resume<input type="file" id="resume" accept=".pdf" required onchange="fetch('/write',{method:'POST'})"></label>
      <label>Cover letter<input type="file" id="cover"></label><button>Apply</button>
    </form>`);
  const form = await captureApplicationPage(page);
  const bytes = Buffer.from("%PDF-1.4\nsynthetic fixture only");
  const resume = { artifact: { path: "shared/resume.pdf", sha256: sha256(bytes) } };
  const approvedPlan = plan(form, {}, { resume });
  await assert.rejects(fillApplicationPage(page, { form, plan: approvedPlan, resumeBytes: Buffer.from("different") }), /exact approved artifact/);
  assert.equal(await page.$eval("#resume", (element) => element.files.length), 0);
  const result = await fillApplicationPage(page, { form, plan: approvedPlan, resumeBytes: bytes });
  assert.equal(result.complete, false);
  assert.equal(result.filled.length, 1);
  assert.equal(result.skipped.length, 1);
  const attached = await page.$eval("#resume", async (element) => ({
    name: element.files[0].name, content: await element.files[0].text(),
  }));
  assert.deepEqual(attached, { name: "resume.pdf", content: bytes.toString() });
  assert.equal(await page.$eval("#cover", (element) => element.files.length), 0);
  assert.equal(counts.writes, 0);
});

test("missing artifact bytes and invalid native values return partial results with actionable target errors", async (t) => {
  const { page } = await fixture(t, `
    <label>Name<input id="name"></label>
    <label>Number<input id="number" type="number" min="5" max="10"></label>
    <label>Resume<input type="file" id="resume"></label>`);
  const form = await captureApplicationPage(page);
  const resume = { artifact: { path: "shared/resume.pdf", sha256: sha256(Buffer.from("synthetic")) } };
  const approvedPlan = plan(form, { Name: "Synthetic", Number: "12" }, { resume });
  const result = await fillApplicationPage(page, { form, plan: approvedPlan });
  assert.equal(result.complete, false);
  assert.equal(result.filled.length, 1);
  assert.deepEqual(result.errors.map((error) => error.code), ["invalid_value", "unapproved_artifact"]);
  assert.equal(await page.$eval("#number", (element) => element.value), "");
});

test("invalid or disabled grouped choices are reported without leaving partially changed checks", async (t) => {
  const { page } = await fixture(t, `
    <fieldset><legend>Required choices</legend>
      <label><input id="a" type="checkbox" name="required" value="a" checked required>A</label>
      <label><input id="b" type="checkbox" name="required" value="b" checked required>B</label>
    </fieldset>
    <fieldset><legend>Fixed choices</legend>
      <label><input id="fixed" type="checkbox" name="fixed" value="a" checked disabled>A</label>
      <label><input id="free" type="checkbox" name="fixed" value="b">B</label>
    </fieldset>`);
  const form = await captureApplicationPage(page);
  const approvedPlan = plan(form, { "Required choices": ["a"], "Fixed choices": ["b"] });
  const result = await fillApplicationPage(page, { form, plan: approvedPlan });
  assert.equal(result.complete, false);
  assert.deepEqual(result.errors.map((error) => error.code), ["invalid_value", "unavailable_target"]);
  assert.deepEqual(await page.evaluate(() => ["a", "b", "fixed", "free"]
    .map((id) => document.getElementById(id).checked)), [true, true, true, false]);
});

test("native entry surfaces missing, duplicate, changed-submit and changed-constraint targets without touching them", async (t) => {
  const { page } = await fixture(t, `
    <label>Name<input id="name" maxlength="20"></label>
    <input class="duplicate"><input class="duplicate"><button id="submit" type="submit">Apply</button>`);
  const original = (await captureApplicationPage(page)).questions.find((question) => question.selector === "#name");
  const questions = [
    { ...original, id: "missing", selector: "#missing" },
    { ...original, id: "duplicate", selector: ".duplicate" },
    { ...original, id: "submit", selector: "#submit", constraints: {} },
    { ...original, id: "constraint", constraints: { maxLength: 10 } },
  ];
  const result = await page.evaluate(enterApplicationAnswers, {
    questions, decisions: questions.map((question) => ({
      questionId: question.id, canFill: true, status: "ready", value: "Synthetic",
    })), artifact: null,
  });
  assert.equal(result.complete, false);
  assert.deepEqual(result.errors.map((error) => error.code),
    ["missing_target", "ambiguous_target", "changed_control", "changed_constraints"]);
  assert.equal(await page.$eval("#name", (element) => element.value), "");
  assert.equal(await page.$eval("#submit", (element) => element.textContent), "Apply");
});

test("frozen navigation cannot send even a new GET while the guarded browser stays open", async (t) => {
  const { page, counts, browser } = await fixture(t, `<label>Name<input id="name"></label>`);
  const form = await captureApplicationPage(page);
  await fillApplicationPage(page, { form, plan: plan(form, { Name: "Synthetic" }) });
  assert.equal(browser.connected, true);
  assert.equal(page.isClosed(), false);
  const baseline = counts.requests.length;
  await assert.rejects(page.goto(form.url, { timeout: 5000 }));
  assert.equal(counts.requests.length, baseline);
});
