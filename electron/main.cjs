const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, Menu, Notification, shell, Tray } = require("electron");

let mainWindow = null;
let runtime = null;
let shutdownStarted = false;
let quitRequested = false;
let tray = null;
let backgroundNoticeShown = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.setAppUserModelId("com.tianjige.marketintel");

function startupPreferencePath() {
  return path.join(app.getPath("userData"), "startup-preference.json");
}

function readStartupPreference() {
  if (!app.isPackaged) return false;
  const preferencePath = startupPreferencePath();
  if (!fs.existsSync(preferencePath)) {
    fs.writeFileSync(preferencePath, JSON.stringify({ enabled: false }), "utf8");
    return false;
  }
  try {
    return Boolean(JSON.parse(fs.readFileSync(preferencePath, "utf8")).enabled);
  } catch {
    return true;
  }
}

function applyStartupPreference(enabled) {
  if (!app.isPackaged) return;
  const launchPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin: enabled, path: launchPath });
  fs.writeFileSync(startupPreferencePath(), JSON.stringify({ enabled }), "utf8");
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showMajorNews(payload) {
  if (!Notification.isSupported() || !payload?.items?.length) return;
  const first = payload.items[0];
  const notification = new Notification({
    title: payload.count > 1 ? `天机阁 · ${payload.count} 条重大情报` : "天机阁 · 重大情报",
    body: `${first.sourceName}｜${first.title}`,
    icon: path.join(__dirname, "..", "build", "icon.png"),
    urgency: first.importance === "critical" ? "critical" : "normal",
  });
  notification.on("click", showMainWindow);
  notification.show();
}

function buildTray() {
  tray = new Tray(path.join(__dirname, "..", "build", "icon.ico"));
  tray.setToolTip("天机阁 · 后台情报更新中");
  const rebuildMenu = () => {
    const autoStart = readStartupPreference();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开天机阁", click: showMainWindow },
      { label: "立即同步", click: () => runtime?.aggregator.refresh().catch(console.error) },
      { type: "separator" },
      {
        label: "随 Windows 启动",
        type: "checkbox",
        checked: autoStart,
        click: (menuItem) => {
          applyStartupPreference(menuItem.checked);
          rebuildMenu();
        },
      },
      { type: "separator" },
      {
        label: "退出天机阁",
        click: () => {
          quitRequested = true;
          app.quit();
        },
      },
    ]));
  };
  rebuildMenu();
  tray.on("double-click", showMainWindow);
}

async function createWindow() {
  const serverModuleUrl = pathToFileURL(path.join(__dirname, "..", "src", "server.js")).href;
  const { startServer } = await import(serverModuleUrl);
  runtime = await startServer({
    port: 0,
    host: "127.0.0.1",
    dataDir: app.getPath("userData"),
    onMajorNews: showMajorNews,
  });

  const autoStart = readStartupPreference();
  applyStartupPreference(autoStart);
  if (!tray) buildTray();

  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: "天机阁",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    backgroundColor: "#f7f7f8",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#f7f7f8",
      symbolColor: "#4b4b50",
      height: 52,
    },
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(runtime.url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.on("close", (event) => {
    if (quitRequested) return;
    event.preventDefault();
    mainWindow.hide();
    if (!backgroundNoticeShown && Notification.isSupported()) {
      backgroundNoticeShown = true;
      new Notification({
        title: "天机阁仍在后台运行",
        body: "新闻会自动更新，重大情报将直接提醒。可从系统托盘重新打开。",
        icon: path.join(__dirname, "..", "build", "icon.png"),
      }).show();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(runtime.url);
}

if (gotLock) {
  app.whenReady().then(createWindow).catch((error) => {
    console.error(error);
    app.quit();
  });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(console.error);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  quitRequested = true;
  if (!runtime || shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  runtime.close().finally(() => {
    runtime = null;
    app.quit();
  });
});
