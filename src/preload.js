const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("postmqn", {
  chooseCollection: () => ipcRenderer.invoke("dialog:collection"),
  chooseEnvironment: () => ipcRenderer.invoke("dialog:environment"),
  chooseGlobals: () => ipcRenderer.invoke("dialog:globals"),
  chooseFolder: () => ipcRenderer.invoke("dialog:folder"),
  chooseReportFolder: () => ipcRenderer.invoke("dialog:reportFolder"),
  getCollectionFolders: (collectionPath) => ipcRenderer.invoke("collection:folders", collectionPath),
  runNewman: (payload) => ipcRenderer.invoke("run:newman", payload),
  stopRun: () => ipcRenderer.invoke("run:stop"),
  openReport: (reportPath) => ipcRenderer.invoke("report:open", reportPath),
  saveReportCopy: (reportPath) => ipcRenderer.invoke("report:saveCopy", reportPath),
  onRunStarted: (callback) => ipcRenderer.on("run:started", (_event, payload) => callback(payload)),
  onRunRequest: (callback) => ipcRenderer.on("run:request", (_event, payload) => callback(payload)),
  onRunAssertion: (callback) => ipcRenderer.on("run:assertion", (_event, payload) => callback(payload)),
  onRunException: (callback) => ipcRenderer.on("run:exception", (_event, payload) => callback(payload)),
  onRunDone: (callback) => ipcRenderer.on("run:done", (_event, payload) => callback(payload))
});
