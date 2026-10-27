import { sha256 } from "./persona-files.js";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function formFingerprint(form) {
  const questionKeys = ["id", "label", "type", "selector", "required", "options",
    "constraints", "disabled", "readOnly", "attachment", "country"];
  const optionKeys = ["label", "value", "selector", "disabled"];
  const submitKeys = ["selector", "label", "type", "disabled", "formAction", "formMethod", "formNoValidate"];
  const pick = (object, keys) => Object.fromEntries(keys.filter((key) =>
    Object.hasOwn(object, key)).map((key) => [key, object[key]]));
  return sha256(JSON.stringify(canonical({
    url: form.url,
    questions: (form.questions ?? []).map((question) => {
      const result = pick(question, questionKeys);
      if (result.options) result.options = result.options.map((option) => pick(option, optionKeys));
      return result;
    }),
    submitControls: (form.submitControls ?? []).map((control) => pick(control, submitKeys)),
  })));
}

// Kept self-contained: this runs in a fresh CDP isolated world, not the site's world.
export function captureFormDocument() {
  const normalize = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const text = (element) => {
    if (!element) return "";
    if (element.matches("input,textarea,select")) return "";
    const parts = [];
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) parts.push(node.nodeValue);
      else if (node.nodeType === Node.ELEMENT_NODE && (node === element ||
        !node.matches("input,textarea,select,script,style,[role=combobox],[role=option]"))) {
        node.childNodes.forEach(visit);
      }
    };
    visit(element);
    return normalize(parts.join(""));
  };
  const references = (element) => normalize((element.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/).filter(Boolean).map((id) => text(document.getElementById(id))).join(" "));
  const label = (element) => references(element) || normalize(element.getAttribute("aria-label")) ||
    normalize(Array.from(element.labels ?? []).map(text).join(" "));
  const groupLabel = (element) => references(element) || normalize(element.getAttribute("aria-label")) ||
    text(Array.from(element.children).find((child) => child.tagName === "LEGEND"));
  const contextLabels = (element) => {
    const labels = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.matches("fieldset,[role=group],[role=radiogroup]")) {
        const description = groupLabel(parent);
        if (description && !labels.includes(description)) labels.unshift(description);
      }
    }
    return labels;
  };
  const selector = (element) => {
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) {
      return `#${CSS.escape(element.id)}`;
    }
    const parts = [];
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const siblings = Array.from(node.parentElement?.children ?? [])
        .filter((sibling) => sibling.tagName === node.tagName);
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1 || 1})`);
    }
    return parts.join(" > ");
  };
  const identifier = (value) => {
    let hash = 2166136261;
    for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
    return `q-${hash.toString(16).padStart(8, "0")}`;
  };
  const requiredMarker = /[*∗⁎✱✲✳✻✼＊﹡❋]/u;
  const required = (element, description) => Boolean(element.required ||
    element.getAttribute("aria-required") === "true" || requiredMarker.test(description));
  const disabled = (element) => element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";
  const constraints = (element) => {
    const result = {};
    for (const attribute of ["maxlength", "minlength", "pattern", "accept", "min", "max"]) {
      if (!element.hasAttribute(attribute)) continue;
      const key = { maxlength: "maxLength", minlength: "minLength" }[attribute] ?? attribute;
      result[key] = ["maxlength", "minlength"].includes(attribute)
        ? Number(element.getAttribute(attribute)) : element.getAttribute(attribute);
    }
    if (element.hasAttribute("multiple")) result.multiple = true;
    return result;
  };
  const visible = (element) => !element.closest("[hidden],[inert]") &&
    getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden";
  const bodyText = normalize(document.body?.innerText);
  if (/\b(?:job|position|opening|posting|applications?)\s+(?:(?:is|are|has been)\s+)?(?:closed|no longer available)\b/i.test(bodyText) ||
      /\bno longer accepting (?:new )?applications\b/i.test(bodyText)) {
    throw new Error("This posting is closed; obtain a current, directly reachable application form.");
  }
  const submitElements = Array.from(document.querySelectorAll("button,input")).filter((element) =>
    (element.tagName === "BUTTON" && (element.type === "submit" && element.form)) ||
    (element.tagName === "BUTTON" && element.getAttribute("type") === "submit") ||
    (element.tagName === "INPUT" && ["submit", "image"].includes(element.type)));
  const submitControls = submitElements.map((element) => ({
    selector: selector(element),
    label: element.tagName === "INPUT" ? normalize(element.getAttribute("value") || element.getAttribute("alt"))
      : text(element),
    type: element.type,
    disabled: disabled(element),
    formAction: element.getAttribute("formaction") ?? element.form?.getAttribute("action") ?? "",
    formMethod: element.getAttribute("formmethod") ?? element.form?.getAttribute("method") ?? "get",
    formNoValidate: element.hasAttribute("formnovalidate") || Boolean(element.form?.noValidate),
  }));
  const customRoles = "[role=combobox],[role=radiogroup],[role=listbox],[role=checkbox],[role=radio],[role=switch],[role=slider],[role=spinbutton]";
  const controls = Array.from(document.querySelectorAll(
    `input,textarea,select,${customRoles},[role=textbox],[contenteditable=true],[aria-required=true]`))
    .filter((element) => !submitElements.includes(element) &&
      !(element.tagName === "INPUT" && ["hidden", "button", "reset"].includes(element.type)) &&
      !(element.matches("[role=radiogroup]") && element.querySelector("input[type=radio]")) &&
      !(element.getAttribute("role") === "listbox" && element.id &&
        Array.from(document.querySelectorAll("[role=combobox]")).some((combo) =>
          `${combo.getAttribute("aria-controls") ?? ""} ${combo.getAttribute("aria-owns") ?? ""}`
            .split(/\s+/).includes(element.id))) &&
      (!element.parentElement?.closest(customRoles) ||
        element.parentElement.closest(customRoles).matches("[role=radiogroup]") &&
        element.parentElement.closest(customRoles).querySelector("input[type=radio]")) &&
      !(element.matches("[aria-required=true]:not(input):not(textarea):not(select)") &&
        !element.hasAttribute("role") && element.querySelector("input,textarea,select")) &&
      (!element.closest("[role=combobox]") || element.closest("[role=combobox]") === element) &&
      visible(element));
  const consumed = new Set();
  const questions = [];
  for (const element of controls) {
    if (consumed.has(element)) continue;
    consumed.add(element);
    let type = element.getAttribute("role") === "combobox" ? "combobox" :
      element.tagName === "TEXTAREA" ? "textarea" :
        element.tagName === "SELECT" ? (element.multiple ? "unsupported" : "select") :
          element.tagName === "INPUT" ? element.type : "unsupported";
    if (!["text", "email", "tel", "url", "number", "date", "textarea", "select", "radio",
      "checkbox", "file", "combobox"].includes(type)) type = "unsupported";
    const group = element.closest("fieldset,[role=group],[role=radiogroup]");
    let members = [element];
    if (["radio", "checkbox"].includes(type)) {
      members = controls.filter((other) => other.tagName === "INPUT" && other.type === type &&
        other.form === element.form && (type === "radio"
          ? Boolean(element.name) && other.name === element.name
          : (group && groupLabel(group)
            ? other.closest("fieldset,[role=group],[role=radiogroup]") === group
            : Boolean(element.name) && other.name === element.name)));
      if (!members.length) members = [element];
      if (type === "radio" || members.length > 1) {
        type = type === "radio" ? "radio-group" : "checkbox-group";
        members.forEach((member) => consumed.add(member));
      }
    }
    const grouped = ["radio-group", "checkbox-group"].includes(type);
    const parentLabel = contextLabels(element).join(" — ");
    const ownLabel = label(element);
    const description = grouped ? parentLabel || ownLabel :
      [parentLabel, ownLabel].filter((value, index, values) => value && values.indexOf(value) === index).join(" — ");
    let parent = element;
    if (grouped) {
      parent = group ?? element.parentElement;
      while (parent && !members.every((member) => parent.contains(member))) parent = parent.parentElement;
    }
    const target = selector(parent ?? element);
    const question = {
      id: identifier(grouped ? `${type}:${members.map(selector).join("|")}` : target),
      label: description, type, selector: target,
      required: members.some((member) => required(member, `${description} ${label(member)}`)) ||
        Boolean(group && required(group, parentLabel)),
      disabled: members.every(disabled), readOnly: Boolean(element.readOnly),
      constraints: constraints(element),
    };
    if (grouped) question.options = members.map((member) => ({
      label: label(member), value: member.getAttribute("value") ?? "on",
      selector: selector(member), disabled: disabled(member),
    }));
    if (type === "select") question.options = Array.from(element.options).map((option) => ({
      label: normalize(option.label), value: option.getAttribute("value") ?? option.value,
      selector: selector(option), disabled: option.disabled || Boolean(option.closest("optgroup")?.disabled),
    }));
    if (type === "combobox") {
      const roots = [element, ...(element.getAttribute("aria-controls") ?? "").split(/\s+/),
        ...(element.getAttribute("aria-owns") ?? "").split(/\s+/)]
        .map((root) => typeof root === "string" ? document.getElementById(root) : root).filter(Boolean);
      question.options = [...new Set(roots.flatMap((root) =>
        Array.from(root.querySelectorAll("[role=option]"))))].map((option) => ({
        label: text(option), value: option.getAttribute("data-value") ?? text(option),
        selector: selector(option), disabled: disabled(option),
      }));
    }
    if (type === "file") {
      question.attachment = /\bcover[\s_-]*letter\b/i.test(description) ? "cover_letter" :
        /(?:^|[^\p{L}])(?:resume|résumé|cv)(?:$|[^\p{L}])/iu.test(description) ? "resume" : "other";
    }
    questions.push(question);
  }
  if (!questions.length) {
    throw new Error("No directly reachable application fields were found. Reveal, login and custom flows stay manual.");
  }
  return {
    questions, submitControls,
    limitations: [
      "Only directly reachable, visible main-document controls are captured; frames, shadow DOM and reveal/login flows stay manual.",
      "Custom controls stay manual; a structural observation is not a promise of arbitrary site compatibility.",
    ],
  };
}
