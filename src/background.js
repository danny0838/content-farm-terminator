const REQUEST_RECORDS_LIMIT = 20;

let filter = new ContentFarmFilter();
let updateFilterPromise;
let requestRecorder = new Map();
let tempUnblockTabs = new Set();

const contextMenuController = {
  quickMode: false,

  create() {
    if (!browser.contextMenus) { return; }

    // Available only in Firefox >= 53.
    if (browser.contextMenus.ContextType.TAB) {
      browser.contextMenus.create({
        id: "blockTab",
        title: utils.lang("blockTab"),
        contexts: ["tab"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
      });
    }

    browser.contextMenus.create({
      id: "blockPage",
      title: utils.lang("blockPage"),
      contexts: ["page"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    browser.contextMenus.create({
      id: "blockLink",
      title: utils.lang("blockLink"),
      contexts: ["link"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    browser.contextMenus.create({
      id: "blockSelection",
      title: utils.lang("blockSelection"),
      contexts: ["selection"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });

    browser.contextMenus.create({
      id: "blockSelectedLinks",
      title: utils.lang("blockSelectedLinks"),
      contexts: ["selection"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
  },

  async refresh(showContextMenuCommands, quickContextMenuCommands) {
    if (!browser.contextMenus) { return; }

    if (typeof showContextMenuCommands === 'undefined' && typeof quickContextMenuCommands === 'undefined') {
      ({showContextMenuCommands, quickContextMenuCommands} = await utils.getOptions([
        "showContextMenuCommands", "quickContextMenuCommands",
      ]));
    }

    if (typeof quickContextMenuCommands !== 'undefined') {
      this.quickMode = !!quickContextMenuCommands;
    }

    if (typeof showContextMenuCommands !== 'undefined') {
      browser.contextMenus.onClicked.removeListener(this.onClicked);
      browser.contextMenus.removeAll();
      if (showContextMenuCommands) {
        this.create();
        browser.contextMenus.onClicked.addListener(this.onClicked);
      }
    }
  },

  get onClicked() {
    // bind this to the object
    const value = async (info, tab) => {
      switch (info.menuItemId) {
        case "blockTab": {
          return await blockTabs(info.pageUrl, tab.id, this.quickMode);
        }
        case "blockPage": {
          return await blockSite(info.pageUrl, tab.id, info.frameId, this.quickMode);
        }
        case "blockLink": {
          const redirectedUrl = await browser.tabs.sendMessage(tab.id, {
            cmd: 'getRedirectedLinkUrl',
          }, {frameId: info.frameId});
          const rule = redirectedUrl || info.linkUrl;
          return await blockSite(rule, tab.id, info.frameId, this.quickMode);
        }
        case "blockSelection": {
          return await blockSite(info.selectionText, tab.id, info.frameId, this.quickMode);
        }
        case "blockSelectedLinks": {
          return await blockSelectedLinks(tab.id, info.frameId, this.quickMode);
        }
      }
    };
    Object.defineProperty(this, 'onClicked', {value});
    return value;
  },
};

const historyController = {
  async onVisited(result) {
    // suppress extension pages from generating a history entry
    if (result.url.startsWith(browser.runtime.getURL(""))) {
      await browser.history.deleteUrl({url: result.url});
    }
  },

  listen(willListen) {
    if (!browser.history) { return; }

    if (willListen) {
      browser.history.onVisited.addListener(this.onVisited);
    } else {
      browser.history.onVisited.removeListener(this.onVisited);
    }
  },

  async refresh(suppressHistory) {
    if (typeof suppressHistory === 'undefined') {
      ({suppressHistory} = await utils.getOptions(["suppressHistory"]));
    }
    this.listen(suppressHistory);
  },
};

async function refreshTabs() {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((tab) => {
    return browser.tabs.sendMessage(tab.id, {
      cmd: 'updateContent',
    }).catch((ex) => {
      return false;
    });
  }));
}

async function updateFilter(optChanges) {
  return updateFilterPromise = (async () => {
    try {
      const options = await utils.getOptions();
      const newFilter = new ContentFarmFilter();
      await newFilter.init(options, optChanges);
      filter = newFilter;

      // async refresh tabs to prevent block
      refreshTabs();

      return true;
    } catch (ex) {
      console.error(ex);
    }
  })();
}

async function updateAssets() {
  const options = await utils.getOptions();
  const urls = filter.urlsTextToLines(options.webBlacklists);
  const states = await Promise.all(urls.map(
    async (url) => {
      const {time, uptodate} = await filter.getCachedWebBlackList(
        url, options.webBlacklistsCacheDuration,
      );
      return {time, uptodate};
    }
  ));

  const outdateIdxs = states.reduce((rv, state, i) => {
    if (!state.uptodate) { rv.push(i); }
    return rv;
  }, []).sort((a, b) => {
    const ta = states[a].time;
    const tb = states[b].time;
    return ta - tb;
  });

  if (!outdateIdxs.length) {
    await autoUpdateAssets();
    return;
  }

  // Update one list. Try next one if it fails.
  let updated = false;
  while (outdateIdxs.length) {
    const idx = outdateIdxs.shift();
    const url = urls[idx];
    try {
      await filter.fetchWebBlackList(url);
      updated = true;
      break;
    } catch (ex) {
      console.error(`Failed to cache blacklist from "${url}": ${ex.message}`);
    }
  }

  // Update the filter if all updatable lists are updated.
  if (updated && !outdateIdxs.length) {
    await updateFilter();
  }

  await autoUpdateAssets();
}

async function autoUpdateAssets(webBlacklistsUpdateInterval) {
  browser.alarms.clear("autoUpdateAssets");

  if (typeof webBlacklistsUpdateInterval === 'undefined') {
    ({webBlacklistsUpdateInterval} = await utils.getOptions(["webBlacklistsUpdateInterval"]));
  }
  browser.alarms.create("autoUpdateAssets", {
    delayInMinutes: webBlacklistsUpdateInterval / (60 * 1000),
  });
}

async function blockSite(urlOrHostname, tabId, frameId, quickMode) {
  let rule = filter.transform(filter.parseRuleLine(urlOrHostname)).validate().toString();

  if (!quickMode) {
    let newRule = await browser.tabs.sendMessage(tabId, {
      cmd: 'blockSite',
      args: {rule},
    }, {frameId});

    if (newRule) {
      // validate the user-modified rule
      newRule = filter.parseRuleLine(newRule).validate().toString();
    }

    rule = newRule;
  }

  // canceled
  if (!rule) { return; }

  if (rule && filter.isInBlacklist(rule)) {
    if (quickMode) {
      return;
    }

    return await browser.tabs.sendMessage(tabId, {
      cmd: 'alert',
      args: {msg: utils.lang("blockSiteDuplicated", rule)},
    }, {frameId});
  }

  updateOptions: {
    const options = await utils.getOptions({
      userBlacklist: ""
    });
    let text = options.userBlacklist;
    if (text) { text += "\n"; }
    text = text + rule;
    await utils.setOptions({
      userBlacklist: text
    });
  }

  if (quickMode) {
    return;
  }

  return await browser.tabs.sendMessage(tabId, {
    cmd: 'alert',
    args: {msg: utils.lang("blockSiteSuccess", rule)},
  }, {frameId});
}

async function blockSites(urlOrHostnames, tabId, frameId, quickMode) {
  let rules = urlOrHostnames
    .map(urlOrHostname => filter.transform(filter.parseRuleLine(urlOrHostname)).validate().toString())
    .filter(rule => !filter.isInBlacklist(rule));

  if (!rules.length) {
    return browser.tabs.sendMessage(tabId, {
      cmd: 'alert',
      args: {msg: utils.lang("blockSitesNoValidRules")},
    }, {frameId});
  }

  // de-duplicate
  rules = Array.from(new Set(rules));

  if (!quickMode) {
    const comment = await browser.tabs.sendMessage(tabId, {
      cmd: 'blockSites',
      args: {rules},
    }, {frameId});

    // canceled
    if (comment === null) {
      return;
    }

    if (comment) {
      rules = rules.map(rule => `${rule} ${comment}`);
    }
  }

  updateOptions: {
    const options = await utils.getOptions({
      userBlacklist: "",
    });
    let text = options.userBlacklist;
    if (text) { text += "\n"; }
    text = text + rules.join('\n');
    await utils.setOptions({
      userBlacklist: text,
    });
  }

  if (quickMode) {
    return;
  }

  return browser.tabs.sendMessage(tabId, {
    cmd: 'alert',
    args: {msg: utils.lang("blockSitesSuccess", rules.join('\n'))},
  }, {frameId});
}

async function blockTabs(urlOrHostname, tabId, quickMode) {
  const tabs = await browser.tabs.query({currentWindow: true, highlighted: true});
  if (tabs.length > 1) {
    const urlOrHostnames = tabs
      .map(tab => tab.url)
      .filter(url => url.startsWith('https:') || url.startsWith('http:'));
    return await blockSites(urlOrHostnames, tabId, 0, quickMode);
  }
  return await blockSite(urlOrHostname, tabId, 0, quickMode);
}

async function blockSelectedLinks(tabId, frameId, quickMode) {
  const urlOrHostnames = await browser.tabs.sendMessage(tabId, {
    cmd: 'blockSelectedLinks',
  }, {frameId});
  return await blockSites(urlOrHostnames, tabId, frameId, quickMode);
}

function onRequestRecorder(details) {
  const tabId = details.tabId;
  if (tabId < 0) { return; }

  let tabRecorder = requestRecorder.get(tabId);
  if (!tabRecorder) {
    tabRecorder = new Map();
    requestRecorder.set(tabId, tabRecorder);
  }

  // truncate first N records if it grows too much
  while (tabRecorder.size >= REQUEST_RECORDS_LIMIT) {
    tabRecorder.delete(tabRecorder.keys().next().value);
  }

  const requestId = details.requestId; // as string
  let requestRecord = tabRecorder.get(requestId);
  if (!requestRecord) {
    requestRecord = {};
    tabRecorder.set(requestId, requestRecord);
  }

  requestRecord.initialUrl = requestRecord.initialUrl || details.url;
  requestRecord.url = details.url;
  requestRecord.timestamp = requestRecord.timestamp || details.timeStamp;

  // Chromium uses .initiator, Firefox uses .originUrl
  const referrer = details.initiator || details.originUrl;
  requestRecord.referrer = requestRecord.referrer || referrer;

  const redirectUrl = details.redirectUrl;
  if (redirectUrl) {
    let redirects = requestRecord.redirects;
    if (!redirects) {
      redirects = requestRecord.redirects = [];
    }
    if (details.redirectUrl.startsWith('http:') || details.redirectUrl.startsWith('https:')) {
      redirects.push([details.url, details.redirectUrl]);
    }
  }
}

function onBeforeRequestBlocker(details) {
  const tabId = details.tabId;
  const requestId = details.requestId;

  // check if this tab is temporarily unblocked
  if (tempUnblockTabs.has(tabId)) {
    return;
  }

  const url = details.url;

  const blocker = filter.getBlocker({url});
  if (!(blocker.rule && blocker.rule.action === filter.RULE_ACTION_BLOCK)) {
    return;
  }

  const blockType = blocker.type;
  if (details.type === "main_frame") {
    const redirectUrl = utils.getBlockedPageUrl(url, {blockType, inFrame: false, tabId, requestId});
    return {redirectUrl};
  } else {
    const redirectUrl = utils.getBlockedPageUrl(url, {blockType, inFrame: true, tabId, requestId});
    return {redirectUrl};
  }
}

/**
 * Return a Promise to defer web requests until updateFilter is done so that
 * they are filtered properly for supported browsers.
 * (Firefox >= 52, but not Firefox Android <= 64.* (and upper?))
 *
 * This will be replaced by onBeforeRequestBlocker as long as updateFilter
 * is done.
 */
async function onBeforeRequestCallback(details) {
  await updateFilterPromise;
  return onBeforeRequestBlocker(details);
}

function onTabRemovedCallback(tabId, removeInfo) {
  requestRecorder.delete(tabId);
}

function initRequestListener() {
  browser.webRequest.onBeforeRequest.addListener(
    onRequestRecorder,
    {urls: ["*://*/*"], types: ["main_frame"]});
  browser.webRequest.onBeforeRedirect.addListener(
    onRequestRecorder,
    {urls: ["*://*/*"], types: ["main_frame"]});
  browser.tabs.onRemoved.addListener(onTabRemovedCallback);

  browser.webRequest.onBeforeRequest.addListener((details) => {
    return onBeforeRequestCallback(details);
  }, {urls: ["*://*/*"], types: ["main_frame", "sub_frame"]}, ["blocking"]);
}

function initMessageListener() {
  browser.runtime.onMessage.addListener((message, sender) => {
    // console.warn("omMessage", message, sender);
    const {cmd, args} = message;
    switch (cmd) {
      case 'getBlockType': {
        return (async () => {
          await updateFilterPromise;
          return (await filter.getBlocker(args)).type;
        })();
      }
      case 'getBlocker': {
        return (async () => {
          await updateFilterPromise;
          return await filter.getBlocker(args);
        })();
      }
      case 'isTempUnblocked': {
        return (async () => {
          const tabId = sender.tab.id;
          return {
            tabId,
            tempUnblocked: tempUnblockTabs.has(tabId),
          };
        })();
      }
      case 'tempUnblock': {
        return (async () => {
          const tabId = sender.tab.id;
          const options = await utils.getOptions([
            "tempUnblockDuration",
            "tempUnblockCountdownBase",
            "tempUnblockCountdownIncrement",
            "tempUnblockCountdownReset",
            "tempUnblockCountdown",
            "tempUnblockLastAccess",
          ]);

          const now = Date.now();

          // validate that countdown has expired,
          // to prevent requesting from multiple tabs simulteneously
          if (options.tempUnblockLastAccess > 0 &&
              options.tempUnblockLastAccess + options.tempUnblockCountdownReset > now &&
              options.tempUnblockLastAccess + options.tempUnblockCountdown > now
              ) {
            return {
              tabId,
              tempUnblocked: false,
            };
          }

          // temporarily unblock the tab
          tempUnblockTabs.add(tabId);
          setTimeout(() => {
            tempUnblockTabs.delete(tabId);
          }, options.tempUnblockDuration);

          // update countdown and last access
          if (options.tempUnblockLastAccess < 0 ||
              options.tempUnblockLastAccess + options.tempUnblockCountdownReset <= now) {
            options.tempUnblockCountdown = options.tempUnblockCountdownBase;
          } else {
            options.tempUnblockCountdown += options.tempUnblockCountdownIncrement;
          }
          options.tempUnblockLastAccess = now;

          await utils.setOptions({
            tempUnblockCountdown: options.tempUnblockCountdown,
            tempUnblockLastAccess: options.tempUnblockLastAccess,
          });

          return {
            tabId,
            tempUnblocked: true,
          };
        })();
      }
      case 'updateOptions': {
        return (async () => {
          const validator = new ContentFarmFilter();
          args.transformRules = utils.getLines(args.transformRules)
            .map(line => validator.parseTransformRuleLine(line).validate().toString())
            .join('\n');
          validator.addTransformRulesFromText(args.transformRules);
          args.userBlacklist = utils.getLines(args.userBlacklist)
            .map(line => validator.transform(validator.parseRuleLine(line), 'url').validate().toString())
            .join('\n');
          args.userWhitelist = utils.getLines(args.userWhitelist)
            .map(line => validator.transform(validator.parseRuleLine(line), 'url').validate().toString())
            .join('\n');
          args.userGraylist = utils.getLines(args.userGraylist)
            .map(line => validator.transform(validator.parseRuleLine(line), 'url').validate().toString())
            .join('\n');
          await utils.setOptions(args);
          return true;
        })();
      }
      case 'getRequestSummary': {
        return (async () => {
          // {tabId, requestId} for options.html redirected from blocked.html
          // {tabId} for options.html opened from a tab
          const {tabId, requestId} = args;
          const rv = {};

          const record = requestRecorder.get(tabId);
          if (!record) { return rv; }

          let requestRecord;
          if (requestId) {
            requestRecord = record.get(requestId);
          } else {
            // take the last matched record
            for (const value of record.values()) {
              requestRecord = value;
            }
          }
          if (!requestRecord) { return rv; }

          Object.assign(rv, requestRecord);
          return rv;
        })();
      }
      case 'getRequestRecords': {
        return (async () => {
          const {tabId} = args;
          const records = requestRecorder.get(tabId);
          return records ? [...records.entries()] : [];
        })();
      }
      case 'closeTab': {
        return (async () => {
          const tabIds = args.tabId ? [args.tabId] : await browser.tabs.query({
            active: true,
            currentWindow: true
          }).then(tabs => tabs.map(x => x.id));
          await browser.tabs.remove(tabIds);
          return true;
        })();
      }
    }
  });
}

function initStorageChangeListener() {
  browser.storage.onChanged.addListener(async (changes, areaName) => {
    // Config keys are stored in storage.sync and fallbacks to storage.local;
    // cache keys are stored in storage.local.
    if (areaName !== "sync") {
      // skip if it's a storage.local.remove() rather than a real user modification
      for (let key in changes) {
        if (!("newValue" in changes[key])) { return; }
        break;
      }
    }

    const {
      showContextMenuCommands,
      quickContextMenuCommands,
      suppressHistory,
      webBlacklistsUpdateInterval,
      webBlacklists,
      userBlacklist,
      userWhitelist,
      userGraylist,
      transformRules,
      showLinkMarkers,
    } = changes;

    if (showContextMenuCommands || quickContextMenuCommands) {
      contextMenuController.refresh(
        showContextMenuCommands ? showContextMenuCommands.newValue : undefined,
        quickContextMenuCommands ? quickContextMenuCommands.newValue : undefined,
      );
    }

    if (suppressHistory) {
      historyController.refresh(suppressHistory.newValue); // async
    }

    if (webBlacklistsUpdateInterval) {
      autoUpdateAssets(webBlacklistsUpdateInterval.newValue); // async
    }

    if (userBlacklist || userWhitelist || userGraylist || webBlacklists || transformRules) {
      await updateFilter(changes);

      // @TODO:
      // Say we have a shift from local to sync:
      //
      //     local {webBlacklists: "list1\nlist2"} => sync {webBlacklists: "list1"}
      //     sync  {webBlacklists: ""}
      //
      // We get a change of sync: "" => "list1" and a change of local: "list1\nlist2" => undefined,
      // and the cache of list2 is not cleared, while it should be, leaving staled cache not cleared.
      if (webBlacklists) {
        filter.clearStaleWebListCache(webBlacklists);
      }
    }
    // skip this check for above cases as updateFilter() calls refreshTabs() at last
    else if (showLinkMarkers) {
      refreshTabs();  // async
    }
  });
}

function initInstallListener() {
  browser.runtime.onInstalled.addListener(async (details) => {
    const {reason, previousVersion} = details;

    // Show startup page if required configuration not done when installed or
    // updated to a new version.
    // ("update" is also triggered when reinstalling a temporary extension)
    if (reason === "install" ||
        (reason === "update" && browser.runtime.getManifest().version !== previousVersion)) {
      if (!await browser.permissions.contains({
        origins : ["http://*/", "https://*/"],
        permissions: ["webRequestBlocking"],
      })) {
        const url = browser.runtime.getURL("startup.html");
        await browser.tabs.create({url, active: true});
      }
    }

    if (reason === "update" && utils.versionCompare(previousVersion, "2.1.2") === -1) {
      console.warn("Migrating options from < 2.1.2");
      const options = await utils.getOptions({
        "webBlacklist": undefined,
        "webBlacklists": undefined,
      });
      if (options.webBlacklist && (typeof options.webBlacklists === "undefined")) {
        const newWebBlacklists = utils.defaultOptions.webBlacklists + "\n" + options.webBlacklist;
        await utils.setOptions({webBlacklists: newWebBlacklists});
      }
      console.warn("Migrated successfully.");
    }

    if (reason === "update" && utils.versionCompare(previousVersion, "5.7.0") === -1) {
      console.warn("Migrating options from < 5.7.0");
      const {webBlacklists} = await utils.getOptions('webBlacklists');
      if (webBlacklists) {
        // force re-fetch web blacklists
        const changes = {
          webBlacklists: {
            oldValue: '',
            newValue: webBlacklists,
          },
        };
        await updateFilter(changes);

        // delete old cache
        const oldKeys = filter.urlsTextToLines(webBlacklists).map(url => JSON.stringify({webBlocklistCache: url}));
        await browser.storage.local.remove(oldKeys);
      }
      console.warn("Migrated successfully.");
    }

    if (reason === "install") {
      console.warn("Fetching web blacklists on installation...");
      const {webBlacklists} = await utils.getOptions('webBlacklists');
      if (webBlacklists) {
        // force fetch web blacklists
        const changes = {
          webBlacklists: {
            oldValue: '',
            newValue: webBlacklists,
          },
        };
        await updateFilter(changes);
      }
      console.warn("Fetched successfully.");
    }
  });
}

function initAlarmsListener() {
  browser.alarms.onAlarm.addListener((alarm) => {
    switch (alarm.name) {
      case "autoUpdateAssets": {
        updateAssets();
        break;
      }
    }
  });
}

function initBrowserAction() {
  browser.action.onClicked.addListener((tab) => {
    const u = new URL(browser.runtime.getURL("options.html"));
    u.searchParams.set('t', tab.id);
    u.searchParams.set('url', tab.url);
    browser.tabs.create({url: u.href, active: true});
  });
}

function init() {
  initRequestListener();
  initMessageListener();
  initStorageChangeListener();
  initInstallListener();
  initAlarmsListener();
  initBrowserAction();

  contextMenuController.refresh(); // async
  historyController.refresh(); // async

  updateFilter() // async
    .then(() => {
      onBeforeRequestCallback = onBeforeRequestBlocker;
      autoUpdateAssets();
    });
}

init();
