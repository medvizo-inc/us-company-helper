"use strict";

/*
 * US Company Helper: the company's details kept in chrome.storage.local,
 * each with a Copy button. Four fields are fixed; the person can add their
 * own (a bank's routing number, a state ID, a registered agent...), name
 * them, and remove them. Nothing leaves the browser: no network calls, no
 * sync storage, no host permissions.
 */

const FIXED = ["companyName", "ein", "address", "phone"];
const CUSTOM_KEY = "customFields";
const MAX_CUSTOM = 20;
const SAVE_DELAY_MS = 300;
const COPIED_MS = 1500;
const UNDO_MS = 5000;

const fixedInputs = Object.fromEntries(FIXED.map((key) => [key, document.getElementById(key)]));
const customBox = document.getElementById("custom");
const addButton = document.getElementById("addField");
const savedLine = document.getElementById("saved");

/** The custom fields, in order: { id, label, value }. */
let custom = [];

/* An EIN is nine digits, written 12-3456789. Typed or pasted digits are
   put in that shape; anything else is left as the person typed it. */
function formatEin(raw) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 9 || /[^\d\s-]/.test(raw)) return raw;
  return digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits;
}

const newId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ------------------------------ saving ------------------------------ */

let saveTimer = null;
let noticeTimer = null;

function notice(text, action) {
  clearTimeout(noticeTimer);
  savedLine.replaceChildren(text);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.run);
    savedLine.append(button);
  }
  noticeTimer = setTimeout(() => savedLine.replaceChildren(), action ? UNDO_MS : 1200);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

async function save({ quiet = false } = {}) {
  clearTimeout(saveTimer);
  saveTimer = null;
  const values = Object.fromEntries(FIXED.map((key) => [key, fixedInputs[key].value]));
  values[CUSTOM_KEY] = custom.map(({ id, label, value }) => ({ id, label, value }));
  try {
    await chrome.storage.local.set(values);
    if (!quiet) notice("Saved");
  } catch {
    notice("Couldn't save. Try again.");
  }
}

async function load() {
  try {
    const stored = await chrome.storage.local.get([...FIXED, CUSTOM_KEY]);
    for (const key of FIXED) {
      if (typeof stored[key] === "string") fixedInputs[key].value = stored[key];
    }
    if (Array.isArray(stored[CUSTOM_KEY])) {
      custom = stored[CUSTOM_KEY]
        .filter((f) => f && typeof f.id === "string")
        .slice(0, MAX_CUSTOM)
        .map((f) => ({ id: f.id, label: String(f.label ?? ""), value: String(f.value ?? "") }));
    }
  } catch {
    notice("Couldn't load your saved details.");
  }
  renderCustom();
  refreshButtons();
}

/* ------------------------------ copying ----------------------------- */

/* The clipboard API first; the older copy command if the browser refuses it. */
async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const ok = document.execCommand("copy");
    helper.remove();
    return ok;
  }
}

function refreshButtons() {
  for (const button of document.querySelectorAll("button.copy")) {
    if (button.classList.contains("done")) continue;
    const input = document.getElementById(button.dataset.for);
    button.disabled = !input || input.value.trim() === "";
  }
  addButton.disabled = custom.length >= MAX_CUSTOM;
  addButton.title = addButton.disabled ? `Up to ${MAX_CUSTOM} fields of your own` : "";
}

async function copyFrom(button) {
  const input = document.getElementById(button.dataset.for);
  const text = input ? input.value.trim() : "";
  if (!text) return;
  const ok = await writeClipboard(text);
  button.textContent = ok ? "Copied!" : "Failed";
  button.classList.toggle("done", ok);
  setTimeout(() => {
    button.textContent = "Copy";
    button.classList.remove("done");
    refreshButtons();
  }, COPIED_MS);
}

/* One listener for every Copy button, the ones added later included. */
document.addEventListener("click", (event) => {
  const button = event.target.closest("button.copy");
  if (button) copyFrom(button);
});

/* ---------------------------- custom fields ------------------------- */

function fieldElement(field) {
  const valueId = `custom-${field.id}`;
  const wrap = document.createElement("div");
  wrap.className = "field";
  wrap.dataset.id = field.id;

  const head = document.createElement("div");
  head.className = "head";
  const name = document.createElement("input");
  name.className = "name";
  name.type = "text";
  name.maxLength = 40;
  name.spellcheck = false;
  name.placeholder = "Name this field";
  name.setAttribute("aria-label", "Field name");
  name.value = field.label;
  name.addEventListener("input", () => {
    field.label = name.value;
    value.setAttribute("aria-label", field.label || "Custom field");
    scheduleSave();
  });
  const remove = document.createElement("button");
  remove.className = "remove";
  remove.type = "button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Remove ${field.label || "this field"}`);
  remove.addEventListener("click", () => removeField(field.id));
  head.append(name, remove);

  const row = document.createElement("div");
  row.className = "row";
  const value = document.createElement("input");
  value.id = valueId;
  value.type = "text";
  value.autocomplete = "off";
  value.spellcheck = false;
  value.maxLength = 500;
  value.placeholder = "Value";
  value.setAttribute("aria-label", field.label || "Custom field");
  value.value = field.value;
  value.addEventListener("input", () => {
    field.value = value.value;
    refreshButtons();
    scheduleSave();
  });
  const copy = document.createElement("button");
  copy.className = "copy";
  copy.type = "button";
  copy.dataset.for = valueId;
  copy.textContent = "Copy";
  row.append(value, copy);

  wrap.append(head, row);
  return wrap;
}

function renderCustom() {
  customBox.replaceChildren(...custom.map(fieldElement));
}

function addField() {
  if (custom.length >= MAX_CUSTOM) return;
  const field = { id: newId(), label: "", value: "" };
  custom.push(field);
  const element = fieldElement(field);
  customBox.append(element);
  refreshButtons();
  save({ quiet: true });
  element.querySelector("input.name").focus();
}

function removeField(id) {
  const index = custom.findIndex((f) => f.id === id);
  if (index < 0) return;
  const [gone] = custom.splice(index, 1);
  renderCustom();
  refreshButtons();
  save({ quiet: true });
  /* A field can hold something hard to find again, so it can come back. */
  notice(`Removed ${gone.label || "a field"}.`, {
    label: "Undo",
    run: () => {
      custom.splice(Math.min(index, custom.length), 0, gone);
      renderCustom();
      refreshButtons();
      save();
    },
  });
}

addButton.addEventListener("click", addField);

/* ---------------------------- fixed fields -------------------------- */

for (const key of FIXED) {
  fixedInputs[key].addEventListener("input", () => {
    if (key === "ein") {
      const formatted = formatEin(fixedInputs.ein.value);
      if (formatted !== fixedInputs.ein.value) fixedInputs.ein.value = formatted;
    }
    refreshButtons();
    scheduleSave();
  });
}

/* Closing the popup mid-typing must not lose the last keystrokes. */
window.addEventListener("pagehide", () => {
  if (saveTimer) save({ quiet: true });
});

load();
