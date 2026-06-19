const state = {
  collectionPath: "",
  environmentPath: "",
  globalsPath: "",
  reportDir: "",
  reportPath: "",
  folders: [],
  selectedFolderRefs: new Set(),
  collapsedFolderRefs: new Set(),
  requests: [],
  assertionErrors: new Map(),
  tests: new Map(),
  running: false,
  status: "Ready"
};

const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

const el = {
  langSelect: document.getElementById("langSelect"),
  flavourSelect: document.getElementById("flavourSelect"),
  collectionPath: document.getElementById("collectionPath"),
  environmentPath: document.getElementById("environmentPath"),
  globalsPath: document.getElementById("globalsPath"),
  collectionSelect: document.getElementById("collectionSelect"),
  folderTree: document.getElementById("folderTree"),
  selectedFolders: document.getElementById("selectedFolders"),
  expandFolders: document.getElementById("expandFolders"),
  clearSelectedFolders: document.getElementById("clearSelectedFolders"),
  browseCollection: document.getElementById("browseCollection"),
  browseFolder: document.getElementById("browseFolder"),
  browseEnvironment: document.getElementById("browseEnvironment"),
  clearEnvironment: document.getElementById("clearEnvironment"),
  browseGlobals: document.getElementById("browseGlobals"),
  clearGlobals: document.getElementById("clearGlobals"),
  reportDir: document.getElementById("reportDir"),
  browseReportDir: document.getElementById("browseReportDir"),
  clearReportDir: document.getElementById("clearReportDir"),
  timeoutRequest: document.getElementById("timeoutRequest"),
  delayRequest: document.getElementById("delayRequest"),
  proxy: document.getElementById("proxy"),
  insecure: document.getElementById("insecure"),
  runAllButton: document.getElementById("runAllButton"),
  runSelectedButton: document.getElementById("runSelectedButton"),
  stopButton: document.getElementById("stopButton"),
  resetButton: document.getElementById("resetButton"),
  totalCount: document.getElementById("totalCount"),
  passCount: document.getElementById("passCount"),
  failCount: document.getElementById("failCount"),
  testCount: document.getElementById("testCount"),
  testFailCount: document.getElementById("testFailCount"),
  duration: document.getElementById("duration"),
  statusText: document.getElementById("statusText"),
  openReport: document.getElementById("openReport"),
  saveReport: document.getElementById("saveReport"),
  reportPath: document.getElementById("reportPath"),
  commandPreview: document.getElementById("commandPreview"),
  resultRows: document.getElementById("resultRows")
};

function shortPath(filePath) {
  if (!filePath) return "";
  const parts = filePath.split(/[\\/]/);
  return parts.length > 3 ? `...\\${parts.slice(-3).join("\\")}` : filePath;
}

function setStatus(text, type = "") {
  el.statusText.textContent = text;
  el.statusText.className = `status ${type}`.trim();
}

const STATUS_KEYS = {
  Ready: "status.ready",
  Running: "status.running",
  Stopped: "status.stopped",
  Waiting: "status.waiting"
};

function setAppState(status, detail = "") {
  state.status = status;
  const type = status === "Ready" ? "" : status === "Stopped" ? "warn" : status === "Running" ? "running" : "warn";
  const label = STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : status;
  setStatus(detail ? `${label}: ${detail}` : label, type);
}

function resetRun() {
  state.requests = [];
  state.assertionErrors = new Map();
  state.tests = new Map();
  state.reportPath = "";
  el.resultRows.innerHTML = "";
  el.totalCount.textContent = "0";
  el.passCount.textContent = "0";
  el.failCount.textContent = "0";
  el.testCount.textContent = "0";
  el.testFailCount.textContent = "0";
  el.duration.textContent = "-";
  el.reportPath.textContent = "";
  el.commandPreview.value = "";
  el.openReport.disabled = true;
  el.saveReport.disabled = true;
}

async function loadCollectionFolders(collectionPath) {
  state.folders = [];
  state.selectedFolderRefs = new Set();
  state.collapsedFolderRefs = new Set();
  el.folderTree.innerHTML = "";
  el.selectedFolders.innerHTML = "";

  const result = await window.postmqn.getCollectionFolders(collectionPath);
  if (!result.ok || result.folders.length === 0) {
    el.folderTree.textContent = result.ok ? t("msg.noFolderUseAll") : result.error;
    el.folderTree.classList.add("empty");
    renderSelectedFolders();
    updateControls();
    return;
  }

  state.folders = result.folders;
  renderFolderTree();
  renderSelectedFolders();
  updateControls();
}

function selectedFolders() {
  return state.folders.filter((folder) => state.selectedFolderRefs.has(folder.ref));
}

function folderDepth(folder) {
  return folder.ref ? folder.ref.split(".").length - 1 : 0;
}

function isFolderHidden(folder) {
  const parts = folder.ref.split(".");
  for (let index = 1; index < parts.length; index += 1) {
    if (state.collapsedFolderRefs.has(parts.slice(0, index).join("."))) return true;
  }
  return false;
}

function hasChildren(folder) {
  return state.folders.some((candidate) => candidate.ref.startsWith(`${folder.ref}.`));
}

function renderFolderTree() {
  if (state.folders.length === 0) {
    el.folderTree.textContent = t("msg.chooseCollection");
    el.folderTree.classList.add("empty");
    return;
  }

  el.folderTree.classList.remove("empty");
  el.folderTree.innerHTML = state.folders
    .map((folder) => {
      const selected = state.selectedFolderRefs.has(folder.ref);
      const depth = folderDepth(folder);
      const children = hasChildren(folder);
      const collapsed = state.collapsedFolderRefs.has(folder.ref);
      const hidden = isFolderHidden(folder);
      return `
        <div class="folder-row ${hidden ? "hidden" : ""}" style="--depth:${depth}">
          <button class="folder-caret" data-action="toggle-folder" data-ref="${escapeHtml(folder.ref)}" type="button" ${
        children ? "" : "disabled"
      }>${children ? (collapsed ? ">" : "v") : ""}</button>
          <button class="folder-name" data-action="toggle-folder" data-ref="${escapeHtml(folder.ref)}" type="button">
            ${escapeHtml(folder.name)}
          </button>
          <button class="folder-move" data-action="add-folder" data-ref="${escapeHtml(folder.ref)}" type="button" ${
        selected ? "disabled" : ""
      }>></button>
          <small>${escapeHtml(folder.path)}</small>
        </div>
      `;
    })
    .join("");
}

function renderSelectedFolders() {
  const folders = selectedFolders();
  el.selectedFolders.classList.toggle("empty", folders.length === 0);
  el.selectedFolders.innerHTML =
    folders.length === 0
      ? t("msg.noFolderSelected")
      : folders
          .map(
            (folder) => `
              <div class="selected-folder">
                <span>${escapeHtml(folder.path)}</span>
                <button data-action="remove-folder" data-ref="${escapeHtml(folder.ref)}" type="button">x</button>
              </div>
            `
          )
          .join("");
  updateControls();
}

function requestFailed(row) {
  const assertion = state.assertionErrors.get(row.id);
  return Boolean(row.error || assertion);
}

function counts() {
  const total = state.requests.length;
  const failed = state.requests.filter(requestFailed).length;
  return { total, failed, passed: Math.max(total - failed, 0) };
}

function renderSummary() {
  const current = counts();
  const tests = Array.from(state.tests.values()).flat();
  const failedTests = tests.filter((test) => !test.passed);
  el.totalCount.textContent = String(current.total);
  el.passCount.textContent = String(current.passed);
  el.failCount.textContent = String(current.failed);
  el.testCount.textContent = String(tests.length);
  el.testFailCount.textContent = String(failedTests.length);
}

function renderRows() {
  if (state.requests.length === 0) {
    el.resultRows.innerHTML = `<tr class="empty"><td colspan="6">${escapeHtml(t("msg.noCalls"))}</td></tr>`;
    renderSummary();
    return;
  }

  el.resultRows.innerHTML = state.requests
    .map((row) => {
      const assertion = state.assertionErrors.get(row.name);
      const assertionById = state.assertionErrors.get(row.id);
      const error = row.error || assertionById || assertion || "";
      const failed = requestFailed(row);
      const statusText = row.code ? `${row.code} ${row.status || ""}`.trim() : "-";
      const timeText = row.responseTime == null ? "-" : `${row.responseTime} ms`;
      const tests = state.tests.get(row.id) || [];
      const testsHtml =
        tests.length === 0
          ? `<small class="tests-empty">${escapeHtml(t("msg.noTestRecorded"))}</small>`
          : `<ul class="tests-list">${tests
              .map(
                (test) =>
                  `<li class="${test.passed ? "test-ok" : "test-ko"}"><span>${test.passed ? "OK" : "KO"}</span>${escapeHtml(
                    test.name || "Test"
                  )}${test.error ? `<em>${escapeHtml(test.error)}</em>` : ""}</li>`
              )
              .join("")}</ul>`;

      return `
        <tr class="${failed ? "failed" : "passed"}">
          <td><span class="pill">${failed ? "KO" : "OK"}</span></td>
          <td class="method">${row.method || "-"}</td>
          <td>
            <strong>${escapeHtml(row.name || "Request")}</strong>
            <small>${escapeHtml(row.url || "")}</small>
            ${testsHtml}
          </td>
          <td>${escapeHtml(statusText)}</td>
          <td>${escapeHtml(timeText)}</td>
          <td>${escapeHtml(error)}</td>
        </tr>
      `;
    })
    .join("");

  renderSummary();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setRunning(running, status = running ? "Running" : "Ready") {
  state.running = running;
  state.status = status;
  updateControls();
}

function updateControls() {
  const running = state.running;
  const hasCollection = Boolean(state.collectionPath);
  const hasFolders = state.folders.length > 0;
  const hasSelected = selectedFolders().length > 0;

  el.runAllButton.disabled = running || !hasCollection;
  el.runSelectedButton.disabled = running || !hasCollection || !hasSelected;
  el.stopButton.disabled = !running;
  el.resetButton.disabled = running && state.status !== "Waiting";
  el.browseCollection.disabled = running;
  el.browseFolder.disabled = running;
  el.browseEnvironment.disabled = running;
  el.browseGlobals.disabled = running;
  el.clearGlobals.disabled = running;
  el.browseReportDir.disabled = running;
  el.clearReportDir.disabled = running;
  el.collectionSelect.disabled = running || el.collectionSelect.options.length === 0;
  el.expandFolders.disabled = running || !hasFolders;
  el.clearSelectedFolders.disabled = running || !hasSelected;
}

el.browseCollection.addEventListener("click", async () => {
  const selected = await window.postmqn.chooseCollection();
  if (!selected) return;
  state.collectionPath = selected;
  el.collectionPath.value = selected;
  await loadCollectionFolders(selected);
});

el.browseFolder.addEventListener("click", async () => {
  const selected = await window.postmqn.chooseFolder();
  if (!selected) return;

  el.collectionSelect.innerHTML = "";
  if (selected.collections.length === 0) {
    const option = document.createElement("option");
    option.textContent = t("msg.noCollections");
    el.collectionSelect.appendChild(option);
    el.collectionSelect.disabled = true;
    setStatus(t("msg.noCollectionsInFolder"), "warn");
    return;
  }

  for (const collection of selected.collections) {
    const option = document.createElement("option");
    option.value = collection;
    option.textContent = shortPath(collection);
    el.collectionSelect.appendChild(option);
  }

  el.collectionSelect.disabled = false;
  state.collectionPath = selected.collections[0];
  el.collectionPath.value = state.collectionPath;
  await loadCollectionFolders(state.collectionPath);
  setStatus(t("msg.collectionsFound", { n: selected.collections.length }), "ok");
});

el.collectionSelect.addEventListener("change", async () => {
  state.collectionPath = el.collectionSelect.value;
  el.collectionPath.value = state.collectionPath;
  await loadCollectionFolders(state.collectionPath);
});

el.folderTree.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || state.running) return;

  const ref = button.dataset.ref;
  if (button.dataset.action === "add-folder") {
    state.selectedFolderRefs.add(ref);
    renderFolderTree();
    renderSelectedFolders();
    return;
  }

  if (button.dataset.action === "toggle-folder") {
    if (!state.folders.some((folder) => folder.ref.startsWith(`${ref}.`))) return;
    if (state.collapsedFolderRefs.has(ref)) state.collapsedFolderRefs.delete(ref);
    else state.collapsedFolderRefs.add(ref);
    renderFolderTree();
  }
});

el.selectedFolders.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='remove-folder']");
  if (!button || state.running) return;
  state.selectedFolderRefs.delete(button.dataset.ref);
  renderFolderTree();
  renderSelectedFolders();
});

el.clearSelectedFolders.addEventListener("click", () => {
  if (state.running) return;
  state.selectedFolderRefs = new Set();
  renderFolderTree();
  renderSelectedFolders();
});

el.expandFolders.addEventListener("click", () => {
  if (state.collapsedFolderRefs.size > 0) {
    state.collapsedFolderRefs = new Set();
    el.expandFolders.textContent = "Collapse";
  } else {
    state.collapsedFolderRefs = new Set(state.folders.filter(hasChildren).map((folder) => folder.ref));
    el.expandFolders.textContent = "Expand";
  }
  renderFolderTree();
});

el.browseEnvironment.addEventListener("click", async () => {
  const selected = await window.postmqn.chooseEnvironment();
  if (!selected) return;
  state.environmentPath = selected;
  el.environmentPath.value = selected;
});

el.clearEnvironment.addEventListener("click", () => {
  state.environmentPath = "";
  el.environmentPath.value = "";
});

el.browseGlobals.addEventListener("click", async () => {
  const selected = await window.postmqn.chooseGlobals();
  if (!selected) return;
  state.globalsPath = selected;
  el.globalsPath.value = selected;
});

el.clearGlobals.addEventListener("click", () => {
  state.globalsPath = "";
  el.globalsPath.value = "";
});

el.browseReportDir.addEventListener("click", async () => {
  const selected = await window.postmqn.chooseReportFolder();
  if (!selected) return;
  state.reportDir = selected;
  el.reportDir.value = selected;
});

el.clearReportDir.addEventListener("click", () => {
  state.reportDir = "";
  el.reportDir.value = "";
});

async function startRun(mode) {
  if (!state.collectionPath) {
    setStatus(t("msg.chooseFirst"), "warn");
    return;
  }

  const folders = mode === "selected" ? selectedFolders() : [];
  if (mode === "selected" && folders.length === 0) {
    setStatus(t("msg.selectFolder"), "warn");
    return;
  }

  resetRun();
  setRunning(true, "Running");
  setAppState("Running", mode === "selected" ? t("msg.foldersSelected", { n: folders.length }) : t("msg.fullCollection"));

  const result = await window.postmqn.runNewman({
    collectionPath: state.collectionPath,
    environmentPath: state.environmentPath,
    globalsPath: state.globalsPath,
    folders: folders.map((folder) => folder.path),
    folderRefs: folders.map((folder) => folder.ref),
    reportDir: state.reportDir,
    timeoutRequest: el.timeoutRequest.value,
    delayRequest: el.delayRequest.value,
    proxy: el.proxy.value.trim(),
    insecure: el.insecure.checked
  });

  if (!result.ok) {
    setRunning(false);
    setAppState("Ready", result.error || t("msg.runNotStarted"));
  }
}

el.runAllButton.addEventListener("click", () => startRun("all"));
el.runSelectedButton.addEventListener("click", () => startRun("selected"));

el.stopButton.addEventListener("click", async () => {
  if (!state.running) return;
  setRunning(true, "Waiting");
  setAppState("Waiting", t("msg.stopRequested"));
  const result = await window.postmqn.stopRun();
  if (!result.ok) setAppState("Running", result.error || t("msg.stopFailed"));
});

el.resetButton.addEventListener("click", () => {
  if (state.running) return;
  resetRun();
  setRunning(false, "Ready");
  setAppState("Ready");
});

el.openReport.addEventListener("click", async () => {
  if (!state.reportPath) return;
  const result = await window.postmqn.openReport(state.reportPath);
  if (!result.ok) setStatus(result.error || t("msg.cantOpen"), "error");
});

el.saveReport.addEventListener("click", async () => {
  if (!state.reportPath) return;
  const result = await window.postmqn.saveReportCopy(state.reportPath);
  if (result.ok) setStatus(t("msg.copySaved"), "ok");
});

window.postmqn.onRunStarted((payload) => {
  state.reportPath = payload.reportPath;
  el.reportPath.textContent = shortPath(payload.reportPath);
  el.commandPreview.value = payload.command || "";
  setAppState(
    "Running",
    payload.folders && payload.folders.length
      ? t("msg.foldersSelected", { n: payload.folders.length })
      : t("msg.fullCollection")
  );
});

window.postmqn.onRunRequest((payload) => {
  state.requests.push(payload);
  renderRows();
});

window.postmqn.onRunAssertion((payload) => {
  const test = {
    name: payload.assertion,
    passed: Boolean(payload.passed),
    error: payload.error || ""
  };
  const tests = state.tests.get(payload.id) || [];
  tests.push(test);
  state.tests.set(payload.id, tests);

  if (!payload.passed) {
    state.assertionErrors.set(payload.id, `${payload.assertion}: ${payload.error}`);
  }
  renderRows();
});

window.postmqn.onRunException((payload) => {
  setAppState("Running", payload.error);
});

window.postmqn.onRunDone((payload) => {
  setRunning(false);
  state.reportPath = payload.reportPath;
  el.reportPath.textContent = shortPath(payload.reportPath);
  el.openReport.disabled = !payload.reportReady;
  el.saveReport.disabled = !payload.reportReady;
  el.duration.textContent = `${Math.round(payload.durationMs / 100) / 10}s`;

  if (payload.stopped) {
    setAppState("Stopped");
    return;
  }

  if (payload.error) {
    setStatus(payload.error, "error");
    return;
  }

  if (payload.failures && payload.failures.length > 0) {
    setStatus(t("msg.failures", { n: payload.failures.length }), "error");
    return;
  }

  setAppState("Ready", t("msg.runDoneNoErr"));
});

function initLangPicker() {
  if (!el.langSelect || !window.i18n) return;
  const langs = window.i18n.listLangs();
  el.langSelect.innerHTML = langs
    .map((lang) => `<option value="${lang.code}">${lang.name}</option>`)
    .join("");
  el.langSelect.value = window.i18n.getLang();
  el.langSelect.addEventListener("change", () => {
    window.i18n.setLang(el.langSelect.value);
  });
}

function initFlavourPicker() {
  if (!el.flavourSelect || !window.theme) return;
  const flavours = window.theme.listFlavours();
  el.flavourSelect.innerHTML = flavours
    .map((flavour) => `<option value="${flavour.id}">${flavour.name}</option>`)
    .join("");
  el.flavourSelect.value = window.theme.getFlavour();
  el.flavourSelect.addEventListener("change", () => {
    window.theme.setFlavour(el.flavourSelect.value);
  });
}

window.addEventListener("i18n:change", () => {
  setAppState(state.status);
  renderFolderTree();
  renderSelectedFolders();
  renderRows();
});

window.i18n && window.i18n.applyTranslations();
initLangPicker();
initFlavourPicker();
updateControls();
setAppState("Ready");
