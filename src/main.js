const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");

let mainWindow;
let activeRun = null;
let runtimePatched = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: "PostMON",
    backgroundColor: "#071013",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function getReportsDir() {
  const reportsDir = path.join(app.getPath("userData"), "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  return reportsDir;
}

function stamp() {
  return new Date()
    .toISOString()
    .replace(/T/, "_")
    .replace(/:/g, "-")
    .replace(/\..+/, "");
}

function findCollections(folderPath) {
  const found = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", "dist", "reports"].includes(entry.name)) walk(fullPath);
        continue;
      }

      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".json") && lower.includes("collection")) {
        found.push(fullPath);
      }
    }
  }

  walk(folderPath);
  return found;
}

function listCollectionFolders(collectionPath) {
  const raw = fs.readFileSync(collectionPath, "utf8");
  const collection = JSON.parse(raw);
  const folders = [];

  function walk(items, parents = [], indexes = []) {
    if (!Array.isArray(items)) return;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item || !Array.isArray(item.item)) continue;

      const name = item.name || "Folder";
      const nextPath = [...parents, name];
      const nextIndexes = [...indexes, index];
      folders.push({
        name,
        path: nextPath.join(" / "),
        ref: nextIndexes.join(".")
      });
      walk(item.item, nextPath, nextIndexes);
    }
  }

  walk(collection.item || []);
  return folders;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function pickFolderBranch(collection, ref) {
  const indexes = String(ref).split(".").map((part) => Number(part));
  if (!indexes.length || indexes.some((index) => !Number.isInteger(index))) return null;

  const root = cloneJson(collection);
  let sourceItems = collection.item;
  let targetItems = root.item;

  for (let depth = 0; depth < indexes.length; depth += 1) {
    const index = indexes[depth];
    if (!Array.isArray(sourceItems) || !sourceItems[index]) return null;

    const picked = cloneJson(sourceItems[index]);
    targetItems.length = 0;
    targetItems.push(picked);

    sourceItems = sourceItems[index].item;
    targetItems = picked.item;
  }

  return root;
}

function buildScopedCollection(collectionPath, folderRefs) {
  if (!Array.isArray(folderRefs) || folderRefs.length === 0) return collectionPath;

  const collection = JSON.parse(fs.readFileSync(collectionPath, "utf8"));
  const scoped = cloneJson(collection);
  scoped.item = [];

  for (const ref of folderRefs) {
    const branch = pickFolderBranch(collection, ref);
    if (branch && Array.isArray(branch.item)) scoped.item.push(...branch.item);
  }

  if (scoped.item.length === 0) {
    throw new Error("Nessuna folder selezionata trovata nella collection.");
  }

  const tempDir = path.join(app.getPath("temp"), "postmon");
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `collection-${stamp()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(tempPath, JSON.stringify(scoped, null, 2), "utf8");
  return tempPath;
}

function quoteCli(value) {
  if (!value) return "";
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function buildNewmanCommand(payload, reportPath, collectionForRun) {
  const parts = ["newman", "run", quoteCli(collectionForRun || payload.collectionPath)];
  if (payload.environmentPath) parts.push("-e", quoteCli(payload.environmentPath));
  if (payload.globalsPath) parts.push("-g", quoteCli(payload.globalsPath));
  if (payload.insecure) parts.push("--insecure");
  if (payload.timeoutRequest && Number(payload.timeoutRequest) > 0) {
    parts.push("--timeout-request", String(Number(payload.timeoutRequest)));
  }
  if (payload.delayRequest && Number(payload.delayRequest) > 0) {
    parts.push("--delay-request", String(Number(payload.delayRequest)));
  }
  if (payload.proxy) parts.push("--proxy", quoteCli(payload.proxy));
  parts.push("-r", "cli,htmlextra", "--reporter-htmlextra-export", quoteCli(reportPath));
  return parts.join(" ");
}

const BODY_CAP = 200 * 1024;

function listHeaders(headers) {
  if (!headers) return [];
  if (typeof headers.all === "function") {
    try {
      return headers.all().map((header) => ({ key: header.key, value: header.value }));
    } catch (err) {
      return [];
    }
  }
  if (typeof headers.members !== "undefined" && Array.isArray(headers.members)) {
    return headers.members.map((header) => ({ key: header.key, value: header.value }));
  }
  if (Array.isArray(headers)) return headers.map((header) => ({ key: header.key, value: header.value }));
  return [];
}

function decodeResponseBody(stream) {
  if (!stream) return { text: "", truncated: false, size: 0 };
  let buf = stream;
  if (!Buffer.isBuffer(buf)) {
    try {
      buf = Buffer.from(stream.data || stream);
    } catch (err) {
      return { text: "", truncated: false, size: 0 };
    }
  }
  const size = buf.length;
  const truncated = size > BODY_CAP;
  const slice = truncated ? buf.slice(0, BODY_CAP) : buf;
  return { text: slice.toString("utf8"), truncated, size };
}

function extractRequestBody(body) {
  if (!body) return "";
  let raw = "";
  try {
    if (body.mode === "raw" && typeof body.raw === "string") raw = body.raw;
    else if (typeof body.toString === "function") raw = body.toString();
  } catch (err) {
    raw = "";
  }
  if (!raw) return "";
  return raw.length > BODY_CAP ? `${raw.slice(0, BODY_CAP)}` : raw;
}

function safeResponseSize(response) {
  if (!response) return null;
  if (typeof response.size === "function") {
    try {
      const info = response.size();
      if (info && Number.isFinite(info.body)) return info.body;
    } catch (err) {
      // fall through
    }
  }
  if (response.stream && Number.isFinite(response.stream.length)) return response.stream.length;
  return null;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatBodyText(text) {
  if (!text) return "";
  const trimmed = text.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch (err) {
      return text;
    }
  }
  return text;
}

function renderHeadersBlock(headers) {
  if (!headers || headers.length === 0) return '<div class="empty-block">Nessun header.</div>';
  const rows = headers
    .map((header) => `<tr><th>${escapeHtml(header.key)}</th><td>${escapeHtml(header.value)}</td></tr>`)
    .join("");
  return `<table class="kv"><tbody>${rows}</tbody></table>`;
}

function renderBodyBlock(text, truncated, size) {
  if (!text) return '<div class="empty-block">Body vuoto.</div>';
  const note = truncated ? `<div class="trunc">Body troncato: ${size} byte totali, mostrati ${BODY_CAP}.</div>` : "";
  return `${note}<pre class="body"><code>${escapeHtml(formatBodyText(text))}</code></pre>`;
}

function formatBytes(size) {
  if (size == null) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function writePostmonReport(reportPath, runData) {
  const failedRequests = runData.requests.filter((request) => request.error || runData.tests.some((test) => test.id === request.id && !test.passed));
  const failedTests = runData.tests.filter((test) => !test.passed);

  const cards = runData.requests
    .map((request, idx) => {
      const tests = runData.tests.filter((test) => test.id === request.id);
      const failed = Boolean(request.error || tests.some((test) => !test.passed));
      const statusText = request.code ? `${request.code} ${request.status || ""}`.trim() : "-";
      const timeText = request.responseTime == null ? "-" : `${request.responseTime} ms`;
      const sizeText = formatBytes(request.respBodySize != null ? request.respBodySize : request.size);
      const testsHtml = tests.length
        ? `<ul class="tests">${tests
            .map(
              (test) =>
                `<li class="${test.passed ? "ok" : "ko"}"><span class="tag">${test.passed ? "OK" : "KO"}</span>${escapeHtml(test.assertion || "Test")}${test.error ? `<em>${escapeHtml(test.error)}</em>` : ""}</li>`
            )
            .join("")}</ul>`
        : '<div class="empty-block">Nessun test registrato.</div>';

      return `<article class="req ${failed ? "failed" : "passed"}" id="req-${idx + 1}">
  <header>
    <span class="pill">${failed ? "KO" : "OK"}</span>
    <span class="method">${escapeHtml(request.method || "-")}</span>
    <div class="title">
      <strong>${escapeHtml(request.name || "Request")}</strong>
      <small>${escapeHtml(request.url || "")}</small>
    </div>
    <div class="kpis">
      <span><label>Status</label>${escapeHtml(statusText)}</span>
      <span><label>Tempo</label>${escapeHtml(timeText)}</span>
      <span><label>Size</label>${escapeHtml(sizeText)}</span>
    </div>
  </header>
  ${request.error ? `<div class="err">Errore tecnico: ${escapeHtml(request.error)}</div>` : ""}
  <section class="tests-section">
    <h4>Test</h4>
    ${testsHtml}
  </section>
  <details ${failed ? "open" : ""}>
    <summary>Request</summary>
    <h5>Headers</h5>
    ${renderHeadersBlock(request.reqHeaders)}
    <h5>Body</h5>
    ${renderBodyBlock(request.reqBody, false, request.reqBody ? request.reqBody.length : 0)}
  </details>
  <details ${failed ? "open" : ""}>
    <summary>Response</summary>
    <h5>Headers</h5>
    ${renderHeadersBlock(request.respHeaders)}
    <h5>Body</h5>
    ${renderBodyBlock(request.respBody, request.respBodyTruncated, request.respBodySize)}
  </details>
</article>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>PostMON Report</title>
<style>
body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#04110a;color:#d6f5e3}
main{max-width:1200px;margin:0 auto;padding:24px}
h1{color:#3dd68c;font-family:Consolas,monospace;margin:0 0 16px}
.meta,.cards{border:1px solid #163d28;background:#07180f;box-shadow:0 3px 0 #000;margin-bottom:16px}
.meta{padding:12px 14px;color:#8ab59c}
.cards{display:grid;grid-template-columns:repeat(4,1fr)}
.card{padding:14px;border-right:1px solid #163d28}.card:last-child{border-right:0}
.card strong{display:block;font-size:26px;color:#7af0b3}.card span{color:#8ab59c;text-transform:uppercase;font-size:12px}
.req{border:1px solid #163d28;background:#07180f;box-shadow:0 3px 0 #000;margin-bottom:14px;padding:14px}
.req.failed{border-color:#5a1b27;background:#1b0a10}
.req header{display:grid;grid-template-columns:auto auto 1fr auto;gap:12px;align-items:center;border-bottom:1px solid #163d28;padding-bottom:10px;margin-bottom:10px}
.pill{display:inline-block;padding:3px 8px;border-radius:3px;background:#0b2418;color:#7af0b3;font-family:Consolas,monospace;font-size:12px;letter-spacing:1px}
.req.failed .pill{background:#330b15;color:#ff8fa0}
.method{font-family:Consolas,monospace;color:#3da8e0;font-weight:bold;font-size:14px}
.title strong{display:block;color:#d6f5e3;font-size:15px}
.title small{display:block;color:#8ab59c;font-family:Consolas,monospace;overflow-wrap:anywhere;font-size:12px;margin-top:2px}
.kpis{display:flex;gap:14px;font-size:12px}
.kpis label{display:block;color:#8ab59c;text-transform:uppercase;font-size:10px;letter-spacing:1px}
.kpis span{color:#7af0b3;font-family:Consolas,monospace}
.err{color:#ff8fa0;font-family:Consolas,monospace;font-size:12px;background:#330b15;padding:8px 10px;border-radius:3px;margin-bottom:10px}
.tests-section{margin-bottom:10px}
.tests-section h4{margin:0 0 6px;color:#3da8e0;font-size:11px;text-transform:uppercase;letter-spacing:1px}
.tests{list-style:none;margin:0;padding:0}
.tests li{padding:4px 0;font-size:13px;border-bottom:1px dashed #163d28}
.tests li:last-child{border-bottom:0}
.tests .tag{display:inline-block;width:28px;font-family:Consolas,monospace;font-size:11px;margin-right:6px}
.tests li.ok{color:#7af0b3}.tests li.ko{color:#ff8fa0}
.tests em{display:block;color:#ff8fa0;font-style:normal;margin:3px 0 0 34px;font-size:12px}
details{border-top:1px solid #163d28;padding:8px 0}
details summary{cursor:pointer;color:#3da8e0;text-transform:uppercase;font-size:12px;letter-spacing:1px;padding:4px 0;list-style:none}
details summary::-webkit-details-marker{display:none}
details summary::before{content:"> ";font-family:Consolas,monospace}
details[open] summary::before{content:"v "}
details h5{margin:10px 0 4px;color:#8ab59c;font-size:11px;text-transform:uppercase;letter-spacing:1px}
table.kv{width:100%;border-collapse:collapse;font-size:12px;font-family:Consolas,monospace}
table.kv th,table.kv td{padding:4px 8px;border-bottom:1px solid #163d28;text-align:left;vertical-align:top;overflow-wrap:anywhere}
table.kv th{color:#3da8e0;width:30%;font-weight:normal}
table.kv td{color:#d6f5e3}
pre.body{margin:0;padding:10px;background:#04110a;border:1px solid #163d28;border-radius:3px;color:#d6f5e3;font-family:Consolas,monospace;font-size:12px;max-height:420px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.empty-block{color:#8ab59c;font-size:12px;padding:6px 0;font-style:italic}
.trunc{color:#ffcf66;font-size:11px;margin-bottom:4px}
.toolbar{display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px}
.toolbar button{background:#0b2418;border:1px solid #163d28;color:#7af0b3;padding:6px 10px;font-family:Consolas,monospace;font-size:11px;cursor:pointer}
.toolbar button:hover{background:#163d28}
.empty-list{padding:24px;text-align:center;color:#8ab59c;border:1px dashed #163d28}
@media(max-width:800px){.cards{grid-template-columns:1fr 1fr}.req header{grid-template-columns:auto 1fr;}.req header .kpis{grid-column:1 / -1}}
</style>
</head>
<body>
<main>
<h1>PostMON Report</h1>
<div class="meta">
  <div>Collection: ${escapeHtml(runData.collectionPath)}</div>
  <div>Environment: ${escapeHtml(runData.environmentPath || "-")}</div>
  <div>Folders: ${escapeHtml((runData.folders || []).join(", ") || "Run All")}</div>
  <div>Generated: ${escapeHtml(new Date().toLocaleString())}</div>
</div>
<section class="cards">
  <div class="card"><strong>${runData.requests.length}</strong><span>Request</span></div>
  <div class="card"><strong>${failedRequests.length}</strong><span>Request KO</span></div>
  <div class="card"><strong>${runData.tests.length}</strong><span>Test</span></div>
  <div class="card"><strong>${failedTests.length}</strong><span>Test KO</span></div>
</section>
<div class="toolbar">
  <button type="button" onclick="document.querySelectorAll('details').forEach(d=>d.open=true)">Espandi tutto</button>
  <button type="button" onclick="document.querySelectorAll('details').forEach(d=>d.open=false)">Comprimi tutto</button>
</div>
${cards || '<div class="empty-list">Nessuna request registrata.</div>'}
</main>
</body>
</html>`;

  fs.writeFileSync(reportPath, html, "utf8");
}

function send(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function cursorId(cursor) {
  if (!cursor) return `${Date.now()}`;
  return `${cursor.iteration || 0}-${cursor.position || 0}`;
}

function patchRuntimeForStop() {
  if (runtimePatched) return;

  const runtime = require("postman-runtime");
  const originalRun = runtime.Runner.prototype.run;

  runtime.Runner.prototype.run = function patchedRun(collection, options, callback) {
    return originalRun.call(this, collection, options, (error, run) => {
      if (activeRun) {
        activeRun.runtimeRun = run;
        if (activeRun.stopRequested && run && typeof run.abort === "function") {
          run.abort(true);
        }
      }
      callback(error, run);
    });
  };

  runtimePatched = true;
}

ipcMain.handle("dialog:collection", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Scegli collection Postman",
    properties: ["openFile"],
    filters: [{ name: "Postman collection", extensions: ["json"] }]
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("dialog:environment", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Scegli environment Postman",
    properties: ["openFile"],
    filters: [{ name: "Postman environment", extensions: ["json"] }]
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("dialog:globals", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Scegli globals Postman",
    properties: ["openFile"],
    filters: [{ name: "Postman globals", extensions: ["json"] }]
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("dialog:folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Scegli cartella progetto/collection",
    properties: ["openDirectory"]
  });

  if (result.canceled) return null;
  const folderPath = result.filePaths[0];
  return {
    folderPath,
    collections: findCollections(folderPath)
  };
});

ipcMain.handle("dialog:reportFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Scegli cartella report",
    properties: ["openDirectory", "createDirectory"]
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("collection:folders", async (_event, collectionPath) => {
  if (!collectionPath || !fs.existsSync(collectionPath)) return { ok: false, error: "Collection non trovata." };

  try {
    return { ok: true, folders: listCollectionFolders(collectionPath) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("report:open", async (_event, reportPath) => {
  if (!reportPath || !fs.existsSync(reportPath)) return { ok: false, error: "Report non trovato." };
  const error = await shell.openPath(reportPath);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle("report:saveCopy", async (_event, reportPath) => {
  if (!reportPath || !fs.existsSync(reportPath)) return { ok: false, error: "Report non trovato." };

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Salva copia report",
    defaultPath: path.basename(reportPath),
    filters: [{ name: "HTML", extensions: ["html"] }]
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.copyFileSync(reportPath, result.filePath);
  return { ok: true, path: result.filePath };
});

ipcMain.handle("run:stop", async () => {
  if (!activeRun) return { ok: false, error: "Nessuna run attiva." };

  activeRun.stopRequested = true;
  if (activeRun.runtimeRun && typeof activeRun.runtimeRun.abort === "function") {
    activeRun.runtimeRun.abort(true);
    return { ok: true };
  }

  return { ok: true, waiting: true };
});

ipcMain.handle("run:newman", async (_event, payload) => {
  if (activeRun) return { ok: false, error: "Una run e gia in corso." };
  if (!payload || !payload.collectionPath) return { ok: false, error: "Scegli prima una collection." };

  let newman;
  try {
    patchRuntimeForStop();
    newman = require("newman");
  } catch (error) {
    return {
      ok: false,
      error: "Newman non e installato. Esegui npm install nella cartella dell'app."
    };
  }

  const reportsDir = payload.reportDir || getReportsDir();
  fs.mkdirSync(reportsDir, { recursive: true });
  const baseName = `${path.basename(payload.collectionPath, ".json")}-${stamp()}`;
  const htmlReportPath = path.join(reportsDir, `${baseName}-postmon.html`);
  const htmlExtraReportPath = path.join(reportsDir, `${baseName}-htmlextra.html`);
  const jsonReportPath = path.join(reportsDir, `${baseName}.json`);
  let collectionForRun;
  try {
    collectionForRun = buildScopedCollection(payload.collectionPath, payload.folderRefs);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const options = {
    collection: collectionForRun,
    reporters: ["json", "htmlextra"],
    reporter: {
      json: { export: jsonReportPath },
      htmlextra: {
        export: htmlExtraReportPath,
        title: "PostMON Newman Report",
        browserTitle: "PostMON Report",
        testPaging: true,
        showEnvironmentData: true,
        showGlobalData: true,
        showMarkdownLinks: true,
        omitHeaders: false,
        omitRequestBodies: false,
        omitResponseBodies: false,
        skipSensitiveData: false
      }
    },
    insecure: Boolean(payload.insecure)
  };

  const timeoutRequest = Number(payload.timeoutRequest);
  if (Number.isFinite(timeoutRequest) && timeoutRequest > 0) {
    options.timeoutRequest = timeoutRequest;
  }

  const delayRequest = Number(payload.delayRequest);
  if (Number.isFinite(delayRequest) && delayRequest > 0) {
    options.delayRequest = delayRequest;
  }

  if (payload.proxy) {
    options.proxy = payload.proxy;
  }

  if (payload.environmentPath) options.environment = payload.environmentPath;
  if (payload.globalsPath) options.globals = payload.globalsPath;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const runData = {
      collectionPath: payload.collectionPath,
      environmentPath: payload.environmentPath || "",
      folders: payload.folders || [],
      requests: [],
      tests: []
    };
    const emitter = newman.run(options);
    activeRun = emitter;
    activeRun.stopRequested = false;

    resolve({ ok: true, reportPath: htmlReportPath, jsonReportPath, htmlExtraReportPath });
    send("run:started", {
      collectionPath: payload.collectionPath,
      collectionForRun,
      environmentPath: payload.environmentPath || null,
      globalsPath: payload.globalsPath || null,
      folders: payload.folders || [],
      reportPath: htmlReportPath,
      htmlExtraReportPath,
      jsonReportPath,
      command: buildNewmanCommand(payload, htmlExtraReportPath, collectionForRun)
    });

    emitter.on("request", (error, args) => {
      const response = args.response;
      const requestObj = args.request;
      const respBody = decodeResponseBody(response && response.stream);
      const slim = {
        id: cursorId(args.cursor),
        name: args.item ? args.item.name : "Request",
        method: requestObj ? requestObj.method : "",
        url: requestObj && requestObj.url ? requestObj.url.toString() : "",
        status: response ? response.status : "",
        code: response ? response.code : null,
        responseTime: response ? response.responseTime : null,
        size: safeResponseSize(response),
        error: error ? error.message : null
      };
      const full = {
        ...slim,
        reqHeaders: listHeaders(requestObj && requestObj.headers),
        reqBody: extractRequestBody(requestObj && requestObj.body),
        respHeaders: listHeaders(response && response.headers),
        respBody: respBody.text,
        respBodyTruncated: respBody.truncated,
        respBodySize: respBody.size
      };
      runData.requests.push(full);
      send("run:request", slim);
    });

    emitter.on("assertion", (error, args) => {
      const testData = {
        id: cursorId(args.cursor),
        name: args.item ? args.item.name : "Request",
        assertion: args.assertion,
        passed: !error,
        error: error ? error.message : null
      };
      runData.tests.push(testData);
      send("run:assertion", testData);
    });

    emitter.on("exception", (cursor, error) => {
      send("run:exception", {
        position: cursor ? cursor.position : null,
        error: error ? error.message : "Errore sconosciuto"
      });
    });

    emitter.on("done", (error, summary) => {
      const wasStopped = Boolean(activeRun && activeRun.stopRequested);
      activeRun = null;
      const stats = summary && summary.run ? summary.run.stats : null;
      const failures = summary && summary.run ? summary.run.failures : [];
      writePostmonReport(htmlReportPath, runData);
      const reportReady = fs.existsSync(htmlReportPath) && fs.statSync(htmlReportPath).size > 0;

      send("run:done", {
        ok: !error && failures.length === 0 && reportReady,
        stopped: wasStopped,
        error: error ? error.message : reportReady ? null : "Report HTML non finalizzato.",
        reportPath: htmlReportPath,
        htmlExtraReportPath,
        jsonReportPath,
        reportReady,
        durationMs: Date.now() - startedAt,
        stats,
        failures: failures.map((failure) => ({
          source: failure.source && failure.source.name ? failure.source.name : "Run",
          error: failure.error && failure.error.message ? failure.error.message : String(failure.error || "")
        }))
      });
    });
  });
});
