// The page side of agent control, shared by every web view backend.
//
// Backends inject this script into the main frame of every page before the page's own scripts
// run (WKUserScript at document start, WebView2 AddScriptToExecuteOnDocumentCreated, CEF
// OnContextCreated), then call the functions on `window.__silkAgent` through their script API:
//
//   snapshot()             a text outline of what the page shows, with refs on elements an
//                          agent can act on ("[ref=e12]")
//   locate(ref)            scrolls the element into view and returns where its center is, in
//                          CSS pixels of the top viewport, for a native click there
//   focusForFill(ref)      locate, focus the element and select its value, so native typing
//                          replaces it
//
// Every function returns plain JSON-able data. Clicks and typing are not done here: the
// backend sends real input at the returned position, so pages see trusted events.
(() => {
  "use strict";
  if (window.__silkAgent) return;

  const refs = new Map(); // ref -> WeakRef(element)
  const refOfElement = new WeakMap();
  let nextRef = 1;

  const MAX_NAME = 100;
  const MAX_TEXT = 200;

  // Roles that take their name from their content: their children are not listed.
  const NAME_FROM_CONTENT = new Set([
    "button", "link", "heading", "option", "tab", "menuitem", "menuitemcheckbox",
    "menuitemradio", "treeitem", "cell", "columnheader", "rowheader", "switch", "checkbox", "radio",
  ]);

  // Roles an agent can act on: they get a ref.
  const ACTIONABLE = new Set([
    "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option",
    "slider", "spinbutton", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio",
    "treeitem",
  ]);

  // Roles that show up as a level of the outline even without a name.
  const STRUCTURAL = new Set([
    "list", "listitem", "navigation", "main", "banner", "contentinfo", "complementary", "form",
    "dialog", "alertdialog", "table", "row", "menu", "menubar", "tablist", "tabpanel", "tree",
    "toolbar", "group", "radiogroup", "article", "region", "paragraph", "iframe", "alert",
    "status", "img", "heading",
  ]);

  function squash(text, limit) {
    const value = (text || "").replace(/\s+/g, " ").trim();
    return value.length > limit ? value.slice(0, limit - 1) + "…" : value;
  }

  function quote(text) {
    return JSON.stringify(text);
  }

  function inputRole(el) {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    switch (type) {
      case "checkbox": return "checkbox";
      case "radio": return "radio";
      case "button": case "submit": case "reset": case "image": return "button";
      case "range": return "slider";
      case "number": return "spinbutton";
      case "search": return "searchbox";
      case "hidden": return null;
      default: return el.hasAttribute("list") ? "combobox" : "textbox";
    }
  }

  function roleOf(el) {
    const explicit = (el.getAttribute("role") || "").trim().split(/\s+/)[0];
    if (explicit && explicit !== "none" && explicit !== "presentation") return explicit;
    if (explicit === "none" || explicit === "presentation") return null;
    switch (el.tagName) {
      case "A": case "AREA": return el.hasAttribute("href") ? "link" : null;
      case "BUTTON": case "SUMMARY": return "button";
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": return "heading";
      case "INPUT": return inputRole(el);
      case "TEXTAREA": return "textbox";
      case "SELECT": return el.multiple || el.size > 1 ? "listbox" : "combobox";
      case "OPTION": return "option";
      case "IMG": return el.getAttribute("alt") === "" ? null : "img";
      case "NAV": return "navigation";
      case "MAIN": return "main";
      case "HEADER": return el.closest("article, aside, main, nav, section") ? null : "banner";
      case "FOOTER": return el.closest("article, aside, main, nav, section") ? null : "contentinfo";
      case "ASIDE": return "complementary";
      case "FORM": return "form";
      case "UL": case "OL": case "MENU": return "list";
      case "LI": return "listitem";
      case "TABLE": return "table";
      case "TR": return "row";
      case "TD": return "cell";
      case "TH": return "columnheader";
      case "DIALOG": return "dialog";
      case "P": return "paragraph";
      case "ARTICLE": return "article";
      case "SECTION": return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : null;
      case "IFRAME": return "iframe";
      default: return el.isContentEditable && el.parentElement && !el.parentElement.isContentEditable ? "textbox" : null;
    }
  }

  function textOf(el) {
    return el.innerText !== undefined ? el.innerText : el.textContent;
  }

  function nameOf(el, role) {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const doc = el.ownerDocument;
      const text = labelledBy.split(/\s+/).map((id) => {
        const target = doc.getElementById(id);
        return target ? textOf(target) : "";
      }).join(" ");
      if (squash(text, MAX_NAME)) return squash(text, MAX_NAME);
    }
    const label = el.getAttribute("aria-label");
    if (label && label.trim()) return squash(label, MAX_NAME);
    if (el.labels && el.labels.length) {
      const text = Array.from(el.labels).map(textOf).join(" ");
      if (text.trim()) return squash(text, MAX_NAME);
    }
    if (el.tagName === "IMG" || el.tagName === "AREA" || (el.tagName === "INPUT" && el.type === "image")) {
      const alt = el.getAttribute("alt");
      if (alt) return squash(alt, MAX_NAME);
    }
    if (el.tagName === "INPUT" && ["button", "submit", "reset"].includes(el.type)) {
      return squash(el.value || (el.type === "submit" ? "Submit" : el.type === "reset" ? "Reset" : ""), MAX_NAME);
    }
    if (NAME_FROM_CONTENT.has(role)) {
      const text = textOf(el);
      if (text && text.trim()) return squash(text, MAX_NAME);
    }
    const title = el.getAttribute("title");
    if (title) return squash(title, MAX_NAME);
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return squash(placeholder, MAX_NAME);
    return "";
  }

  function hidden(el) {
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return true;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (style.display === "none") return true;
    if (style.visibility === "hidden" || style.visibility === "collapse") {
      // A hidden element can have visible children; only skip it when it has none.
      return !el.querySelector("*");
    }
    return false;
  }

  function hasBox(el) {
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (style.visibility === "hidden" || style.visibility === "collapse") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function refFor(el) {
    let ref = refOfElement.get(el);
    if (!ref) {
      ref = "e" + nextRef++;
      refOfElement.set(el, ref);
    }
    refs.set(ref, new WeakRef(el));
    return ref;
  }

  function stateOf(el, role) {
    const states = [];
    if (role === "heading") {
      const level = el.getAttribute("aria-level") || (/^H([1-6])$/.exec(el.tagName) || [])[1];
      if (level) states.push("level=" + level);
    }
    const checked = el.getAttribute("aria-checked");
    if (checked === "true" || (checked === null && (role === "checkbox" || role === "radio" || role === "switch") && el.checked)) {
      states.push("checked");
    } else if (checked === "mixed" || el.indeterminate) {
      states.push("mixed");
    }
    if (el.getAttribute("aria-selected") === "true" || (el.tagName === "OPTION" && el.selected)) states.push("selected");
    const expanded = el.getAttribute("aria-expanded");
    if (expanded === "true") states.push("expanded");
    if (expanded === "false") states.push("collapsed");
    if (el.disabled || el.getAttribute("aria-disabled") === "true") states.push("disabled");
    if (el.ownerDocument.activeElement === el) states.push("focused");
    return states;
  }

  function valueOf(el, role) {
    if (role === "textbox" || role === "searchbox" || role === "spinbutton" || role === "combobox" || role === "slider") {
      if (el.tagName === "SELECT") {
        return squash(Array.from(el.selectedOptions).map((o) => o.text).join(", "), MAX_TEXT);
      }
      if ("value" in el && el.tagName !== "BUTTON") {
        return el.type === "password" ? "•".repeat(Math.min(el.value.length, 16)) : squash(el.value, MAX_TEXT);
      }
      if (el.isContentEditable) return squash(textOf(el), MAX_TEXT);
    }
    return null;
  }

  // Walks the children of `parent` (an element or shadow root), writing lines at `depth`.
  // Text directly inside a label that names a control is left out: the control carries it.
  function walkChildren(parent, depth, out, skipText) {
    const host = parent.shadowRoot;
    const children = host ? host.childNodes : parent.childNodes;
    let text = "";
    const flush = () => {
      const value = squash(text, MAX_TEXT);
      if (value) out.push("  ".repeat(depth) + "- text: " + quote(value));
      text = "";
    };
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!skipText) text += child.textContent;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.tagName === "SLOT") {
        flush();
        for (const assigned of child.assignedNodes({ flatten: true })) {
          if (assigned.nodeType === Node.TEXT_NODE) text += assigned.textContent;
          else if (assigned.nodeType === Node.ELEMENT_NODE) walkElement(assigned, depth, out);
        }
        continue;
      }
      const display = child.ownerDocument.defaultView.getComputedStyle(child).display;
      if (display.startsWith("inline") && !roleOf(child) && !(child.tagName === "LABEL" && child.control) && !child.shadowRoot && !child.querySelector("a, button, input, select, textarea, img, [role], [tabindex], [contenteditable]")) {
        // Plain inline text (spans, emphasis) runs together with the text around it.
        if (!hidden(child) && !skipText) text += textOf(child);
        continue;
      }
      flush();
      walkElement(child, depth, out);
    }
    flush();
  }

  function walkElement(el, depth, out) {
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK"].includes(el.tagName)) return;
    if (hidden(el)) return;
    if (el.tagName === "LABEL" && el.control) {
      walkChildren(el, depth, out, true);
      return;
    }
    const role = roleOf(el);
    const focusable = el.tabIndex >= 0 && el.getAttribute("tabindex") !== null;
    const actionable = role && ACTIONABLE.has(role) || (!role && focusable);
    if (!role && !actionable) {
      walkChildren(el, depth, out);
      return;
    }
    const name = role ? nameOf(el, role) : squash(textOf(el), MAX_NAME);
    if (!actionable && !STRUCTURAL.has(role) && !name) {
      walkChildren(el, depth, out);
      return;
    }
    let line = "  ".repeat(depth) + "- " + (role || "generic");
    if (name) line += " " + quote(name);
    for (const state of stateOf(el, role)) line += " [" + state + "]";
    if (actionable && hasBox(el) && !el.disabled) line += " [ref=" + refFor(el) + "]";
    if (role === "link" && el.href) line += " [url=" + el.getAttribute("href") + "]";
    const value = valueOf(el, role);
    if (value !== null && value !== "") line += ": " + quote(value);
    if (role === "iframe") {
      let doc = null;
      try { doc = el.contentDocument; } catch (_) { doc = null; }
      if (!doc) {
        out.push(line + " [cross-origin] [url=" + (el.getAttribute("src") || "") + "]");
        return;
      }
      out.push(line);
      if (doc.body) walkChildren(doc.body, depth + 1, out);
      return;
    }
    out.push(line);
    if (role === "textbox" || role === "searchbox" || role === "combobox" || role === "listbox" && el.tagName === "SELECT") {
      if (el.tagName === "SELECT") {
        for (const option of el.options) {
          let item = "  ".repeat(depth + 1) + "- option " + quote(squash(option.text, MAX_NAME));
          if (option.selected) item += " [selected]";
          out.push(item);
        }
      }
      return;
    }
    if ((NAME_FROM_CONTENT.has(role) || !role) && name) return;
    if (role === "img") return;
    walkChildren(el, depth + 1, out);
  }

  // The element's offset from the top viewport: its own frame's offset plus each frame
  // element's position and border.
  function frameOffset(el) {
    let x = 0;
    let y = 0;
    let win = el.ownerDocument.defaultView;
    while (win && win !== window) {
      const frame = win.frameElement;
      if (!frame) break;
      const rect = frame.getBoundingClientRect();
      const style = frame.ownerDocument.defaultView.getComputedStyle(frame);
      x += rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      y += rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
      win = frame.ownerDocument.defaultView;
    }
    return { x, y };
  }

  // Positions go to Silk as JSON text; two decimals keep them free of exponents.
  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function element(ref) {
    const weak = refs.get(ref);
    const el = weak && weak.deref();
    if (!el || !el.isConnected) return null;
    return el;
  }

  function locate(ref) {
    const el = element(ref);
    if (!el) return { ok: false, error: "no element " + ref + "; take a new snapshot" };
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { ok: false, error: "element " + ref + " has no box" };
    const offset = frameOffset(el);
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    // Hit test in the element's own tree, so elements inside shadow roots are not covered by
    // their host.
    const root = el.getRootNode();
    const hit = (typeof root.elementFromPoint === "function" ? root : el.ownerDocument).elementFromPoint(x, y);
    const covered = !!hit && hit !== el && !el.contains(hit) && !hit.contains(el);
    return {
      ok: true,
      x: round(offset.x + x),
      y: round(offset.y + y),
      width: round(rect.width),
      height: round(rect.height),
      covered,
    };
  }

  function focusForFill(ref) {
    const place = locate(ref);
    if (!place.ok) return place;
    const el = element(ref);
    el.focus();
    if (typeof el.select === "function") {
      el.select();
    } else if (el.isContentEditable) {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      const selection = el.ownerDocument.defaultView.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      return { ok: false, error: "element " + ref + " does not take text" };
    }
    return place;
  }

  function snapshot() {
    refs.clear();
    const out = [];
    const header = "- document " + quote(squash(document.title, MAX_NAME)) + " [url=" + location.href + "]";
    out.push(header);
    if (document.body) walkChildren(document.body, 1, out);
    return out.join("\n") + "\n";
  }

  Object.defineProperty(window, "__silkAgent", {
    value: Object.freeze({ version: 1, snapshot, locate, focusForFill }),
    enumerable: false,
  });
})();
