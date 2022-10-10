let filter = new ContentFarmFilter();
let updateFilterPromise;
let autoUpdateAssetsTimer;
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

  async refresh(options = [
    "showContextMenuCommands",
    "quickContextMenuCommands",
  ]) {
    if (!browser.contextMenus) { return; }

    const {showContextMenuCommands, quickContextMenuCommands} = await utils.getOptions(options);

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

  async onClicked(info, tab) {
    switch (info.menuItemId) {
      case "blockTab": {
        return await blockSite(info.pageUrl, tab.id, 0, this.quickMode);
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

  async refresh() {
    const {suppressHistory} = await utils.getOptions([
      "suppressHistory",
    ]);
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

async function autoUpdateAssets() {
  if (autoUpdateAssetsTimer) {
    clearTimeout(autoUpdateAssetsTimer);
    autoUpdateAssetsTimer = null;
  }

  const {webBlacklistsUpdateInterval} = await utils.getOptions([
    "webBlacklistsUpdateInterval",
  ]);
  autoUpdateAssetsTimer = setTimeout(updateAssets, webBlacklistsUpdateInterval);
}

async function blockSite(rule, tabId, frameId, quickMode) {
  rule = filter.transform(filter.parseRuleLine(rule)).validate().toString();

  if (!quickMode) {
    let newRule = await browser.tabs.sendMessage(tabId, {
      cmd: 'blockSite',
      args: {rule: rule.toString()},
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

async function blockSelectedLinks(tabId, frameId, quickMode) {
  let rules = (await browser.tabs.sendMessage(tabId, {
      cmd: 'blockSelectedLinks',
    }, {frameId}))
    .map(rule => filter.transform(filter.parseRuleLine(rule)).validate().toString())
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
    const confirmed = await browser.tabs.sendMessage(tabId, {
      cmd: 'blockSites',
      args: {rules},
    }, {frameId});
    rules = confirmed ? rules : undefined;
  }

  // canceled
  if (!rules) { return; }

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

function onBeforeRequestBlocker(details) {
  // check if this tab is temporarily unblocked
  if (tempUnblockTabs.has(details.tabId)) {
    return;
  }

  const url = details.url;

  // Chromium uses .initiator, Firefox uses .originUrl
  const referrer = details.initiator || details.originUrl;

  const blockType = filter.getBlocker({url}).type;
  if (!blockType) { return; }

  if (details.type === "main_frame") {
    const redirectUrl = utils.getBlockedPageUrl(url, {blockType, inFrame: false, referrer});

    // Firefox < 56 does not allow redirecting to an extension page
    // even if it is listed in web_accessible_resources.
    // Using data URI with meta or script refresh works but generates
    // an extra history entry.
    if (utils.userAgent.soup.has('firefox') && utils.userAgent.major < 56) {
      browser.tabs.update(details.tabId, {url: redirectUrl}); // async
      return {cancel: true};
    }

    return {redirectUrl: redirectUrl};
  } else {
    const redirectUrl = utils.getBlockedPageUrl(url, {blockType, inFrame: true, referrer});
    return {redirectUrl: redirectUrl};
  }
};

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
};

function initBeforeRequestListener() {
  browser.webRequest.onBeforeRequest.addListener((details) => {
    return onBeforeRequestCallback(details);
  }, {urls: ["*://*/*"], types: ["main_frame", "sub_frame"]}, ["blocking"]);
}

function initMessageListener() {
  browser.runtime.onMessage.addListener((message, sender) => {
    // console.warn("omMessage", message);
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
          return tempUnblockTabs.has(sender.tab.id);
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

          // temporarily unblock the tab
          tempUnblockTabs.add(tabId);
          setTimeout(() => {
            tempUnblockTabs.delete(tabId);
          }, options.tempUnblockDuration);

          // update countdown
          if (options.tempUnblockLastAccess < 0 ||
              Date.now() - options.tempUnblockLastAccess > options.tempUnblockCountdownReset) {
            options.tempUnblockCountdown = -1;
          }

          if (options.tempUnblockCountdown === -1) {
            options.tempUnblockCountdown = options.tempUnblockCountdownBase;
          }

          options.tempUnblockCountdown += options.tempUnblockCountdownIncrement;
          options.tempUnblockLastAccess = Date.now();

          await utils.setOptions({
            tempUnblockCountdown: options.tempUnblockCountdown,
            tempUnblockLastAccess: options.tempUnblockLastAccess,
          });

          return true;
        })();
      }
      case 'updateOptions': {
        return (async () => {
          const validator = new ContentFarmFilter();
          args.transformRules = utils.getLines(args.transformRules)
            .map(rule => validator.parseTransformRuleLine(rule).validate().toString())
            .join('\n');
          validator.addTransformRulesFromText(args.transformRules);
          args.userBlacklist = utils.getLines(args.userBlacklist)
            .map(rule => validator.transform(validator.parseRuleLine(rule), 'url').validate().toString())
            .join('\n');
          args.userWhitelist = utils.getLines(args.userWhitelist)
            .map(rule => validator.transform(validator.parseRuleLine(rule),'url').validate().toString())
            .join('\n');
          await utils.setOptions(args);
          return true;
        })();
      }
      case 'getTabInfo': {
        return (async () => {
          const tab = await browser.tabs.get(args.tabId);

          let referrer;
          try {
            referrer = await browser.tabs.sendMessage(tab.id, {
              cmd: 'getReferrer',
            });
          } catch (ex) {}

          return {
            title: tab.title,
            url: tab.url,
            referrer,
          };
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
    // cache keys are stored in storage.local and are valid JSON format.
    // We only take action when at least one config key is changed.
    if (areaName !== "sync") {
      // skip if it's a storage.local.remove() rather than a real user modification
      for (let key in changes) {
        if (!("newValue" in changes[key])) { return; }
        break;
      }
    }

    {
      const contextMenuOptions = [
        "showContextMenuCommands",
        "quickContextMenuCommands",
      ].filter(x => x in changes);
      if (contextMenuOptions.length) {
        contextMenuController.refresh(contextMenuOptions);
      }
    }

    if ("suppressHistory" in changes) {
      historyController.refresh(); // async
    }

    if ("webBlacklistsUpdateInterval" in changes) {
      autoUpdateAssets(); // async
    }

    {
      const listOptions = [
        "webBlacklists",
        "userBlacklist",
        "userWhitelist",
        "transformRules",
      ].filter(x => x in changes);
      if (listOptions.length) {
        await updateFilter(changes);

        // @TODO:
        // Say we have a shift from local to sync:
        //
        //     local {webBlacklists: "list1\nlist2"} => sync {webBlacklists: "list1"}
        //     sync  {webBlacklists: ""}
        //
        // We get a change of sync: "" => "list1" and a change of local: "list1\nlist2" => undefined,
        // and the cache of list2 is not cleared, while it should be, leaving staled cache not cleared.
        if (changes.webBlacklists) {
          filter.clearStaleWebListCache(changes.webBlacklists);
        }
      } else if ("showLinkMarkers" in changes) {
        refreshTabs();  // async
      }
    }
  });
}

function initInstallListener() {
  browser.runtime.onInstalled.addListener(async (details) => {
    const {reason, previousVersion} = details;

    if (reason === "update" && utils.versionCompare(previousVersion, "2.1.2") === -1) {
      console.warn("Migrating options from < 2.1.2");
      const options = await utils.getOptions({
        "webBlacklist": undefined,
        "webBlacklists": undefined,
      });
      if (options.webBlacklist && (typeof options.webBlacklists === "undefined")) {
        const newWebBlacklists = utils.defaultOptions.webBlacklists + "\n" + options.webBlacklist;
        await utils.setOptions({webBlacklists: newWebBlacklists});
        await updateFilter(true);
      }
      console.warn("Migrated successfully.");
    }
  });
}

function initBrowserAction() {
  if (!browser.browserAction) {
    // Firefox Android < 55: no browserAction
    // Fallback to pageAction.
    // Firefox Android ignores the tabId parameter and
    // shows the pageAction for all tabs
    browser.pageAction.onClicked.addListener((tab) => {
      const url = browser.runtime.getURL("options.html");
      browser.tabs.create({url: url, active: true});
    });
    browser.pageAction.show(0);
  }

  browser.browserAction.onClicked.addListener((tab) => {
    const u = new URL(browser.runtime.getURL("options.html"));
    u.searchParams.set('t', tab.id);
    browser.tabs.create({url: u.href, active: true});
  });
}

function init() {
  initBeforeRequestListener();
  initMessageListener();
  initStorageChangeListener();
  initInstallListener();
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
