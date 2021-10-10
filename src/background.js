let filter = new ContentFarmFilter();
let updateFilterPromise;
let autoUpdateFilterTimer;
let tempUnblockTabs = new Set();

const contextMenuController = {
  quickMode: false,

  create() {
    return Promise.resolve().then(() => {
      if (!browser.contextMenus) { return; }

      return Promise.resolve().then(() => {
        // Available only in Firefox >= 53.
        if (browser.contextMenus.ContextType.TAB) {
          return browser.contextMenus.create({
            title: utils.lang("blockTab"),
            contexts: ["tab"],
            documentUrlPatterns: ["http://*/*", "https://*/*"],
            onclick: (info, tab) => {
              return blockSite(info.pageUrl, tab.id, 0, this.quickMode);
            },
          });
        }
      }).then(() => {
        return browser.contextMenus.create({
          title: utils.lang("blockPage"),
          contexts: ["page"],
          documentUrlPatterns: ["http://*/*", "https://*/*"],
          onclick: (info, tab) => {
            return blockSite(info.pageUrl, tab.id, info.frameId, this.quickMode);
          },
        });
      }).then(() => {
        return browser.contextMenus.create({
          title: utils.lang("blockLink"),
          contexts: ["link"],
          documentUrlPatterns: ["http://*/*", "https://*/*"],
          onclick: (info, tab) => {
            return browser.tabs.sendMessage(tab.id, {
              cmd: 'getRedirectedLinkUrl'
            }, {frameId: info.frameId}).then((redirectedUrl) => {
              const rule = redirectedUrl || info.linkUrl;
              return blockSite(rule, tab.id, info.frameId, this.quickMode);
            });
          },
        });
      }).then(() => {
        return browser.contextMenus.create({
          title: utils.lang("blockSelection"),
          contexts: ["selection"],
          documentUrlPatterns: ["http://*/*", "https://*/*"],
          onclick: (info, tab) => {
            return blockSite(info.selectionText, tab.id, info.frameId, this.quickMode);
          },
        });
      }).then(() => {
        return browser.contextMenus.create({
          title: utils.lang("blockSelectedLinks"),
          contexts: ["selection"],
          documentUrlPatterns: ["http://*/*", "https://*/*"],
          onclick: (info, tab) => {
            return blockSelectedLinks(tab.id, info.frameId, this.quickMode);
          },
        });
      });
    });
  },

  refresh(options = [
    "showContextMenuCommands",
    "quickContextMenuCommands",
  ]) {
    return Promise.resolve().then(() => {
      if (!browser.contextMenus) { return; }

      return utils.getOptions(options)
        .then(({showContextMenuCommands, quickContextMenuCommands}) => {
          if (typeof quickContextMenuCommands !== 'undefined') {
            this.quickMode = !!quickContextMenuCommands;
          }

          if (typeof showContextMenuCommands !== 'undefined') {
            return browser.contextMenus.removeAll()
              .then(() => {
                if (showContextMenuCommands) {
                  return this.create();
                }
              });
          }
        });
    });
  },
};

const historyController = {
  onVisited(result) {
    // suppress extension pages from generating a history entry
    if (result.url.startsWith(browser.runtime.getURL(""))) {
      browser.history.deleteUrl({url: result.url});
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

  refresh() {
    return utils.getOptions([
      "suppressHistory",
    ]).then(({suppressHistory}) => {
      this.listen(suppressHistory);
    });
  },
};

function updateFilter() {
  return updateFilterPromise = utils.getOptions().then((options) => {
    const newFilter = new ContentFarmFilter();
    newFilter.addTransformRules(options.transformRules);
    newFilter.addBlackList(options.userBlacklist);
    newFilter.addWhiteList(options.userWhitelist);
    const tasks = newFilter
      .urlsTextToLines(options.webBlacklists)
      .map(u => newFilter.addBlackListFromUrl(u, options.webBlacklistsCacheDuration));
    return Promise.all(tasks).then(() => {
      newFilter.makeCachedRules();
      filter = newFilter;
    });
  }).then(() => {
    // async update tabs to prevent block
    browser.tabs.query({})
      .then((tabs) => {
        return Promise.all(tabs.map((tab) => {
          return browser.tabs.sendMessage(tab.id, {
            cmd: 'updateContent',
          }).catch((ex) => {
            return false;
          });
        }));
      });

    return true;
  }).catch((ex) => {
    console.error(ex);
  });
}

function blockSite(rule, tabId, frameId, quickMode) {
  return Promise.resolve().then(() => {
    rule = (rule || "").trim();
    rule = filter.parseRuleLine(rule, {validate: true, transform: 'standard', asString: true});

    if (quickMode) {
      return rule;
    }

    return browser.tabs.sendMessage(tabId, {
      cmd: 'blockSite',
      args: {rule},
    }, {frameId}).then((rule) => {
      // cancled
      if (!rule) { return rule; }

      // validate the user-modified rule
      return filter.parseRuleLine(rule, {validate: true, asString: true});
    });
  }).then((rule) => {
    // canceled
    if (!rule) { return; }

    if (rule && filter.isInBlacklist(rule)) {
      if (quickMode) {
        return;
      }

      return browser.tabs.sendMessage(tabId, {
        cmd: 'alert',
        args: {msg: utils.lang("blockSiteDuplicated", rule)},
      }, {frameId});
    }

    return utils.getOptions({
      userBlacklist: ""
    }).then((options) => {
      let text = options.userBlacklist;
      if (text) { text += "\n"; }
      text = text + rule;
      return utils.setOptions({
        userBlacklist: text
      });
    }).then(() => {
      if (quickMode) {
        return;
      }

      return browser.tabs.sendMessage(tabId, {
        cmd: 'alert',
        args: {msg: utils.lang("blockSiteSuccess", rule)},
      }, {frameId});
    });
  });
}

function blockSelectedLinks(tabId, frameId, quickMode) {
  return browser.tabs.sendMessage(tabId, {
    cmd: 'blockSelectedLinks',
  }, {frameId}).then((list) => {
    let rules = list.map((rule) => {
      rule = (rule || "").trim();
      rule = filter.parseRuleLine(rule, {validate: true, transform: 'standard', asString: true});
      return rule;
    }).filter(rule => !filter.isInBlacklist(rule));

    if (!rules.length) {
      return browser.tabs.sendMessage(tabId, {
        cmd: 'alert',
        args: {msg: utils.lang("blockSitesNoValidRules")},
      }, {frameId});
    }

    // de-duplicate
    rules = Array.from(new Set(rules));

    if (quickMode) {
      return rules;
    }

    return browser.tabs.sendMessage(tabId, {
      cmd: 'blockSites',
      args: {rules},
    }, {frameId}).then((confirmed) => {
      return confirmed ? rules : undefined;
    });
  }).then((rules) => {
    // canceled
    if (!rules) { return; }
    
    return utils.getOptions({
      userBlacklist: ""
    }).then((options) => {
      let text = options.userBlacklist;
      if (text) { text += "\n"; }
      text = text + rules.join('\n');
      return utils.setOptions({
        userBlacklist: text
      });
    }).then(() => {
      if (quickMode) {
        return;
      }

      return browser.tabs.sendMessage(tabId, {
        cmd: 'alert',
        args: {msg: utils.lang("blockSitesSuccess", rules.join('\n'))},
      }, {frameId});
    });
  });
}

function onBeforeRequestBlocker(details) {
  // check if this tab is temporarily unblocked
  if (tempUnblockTabs.has(details.tabId)) {
    return;
  }

  const url = details.url;
  const blockType = filter.isBlocked(url);
  if (!blockType) { return; }

  if (details.type === "main_frame") {
    const redirectUrl = utils.getBlockedPageUrl(url, blockType, false);

    // Firefox < 56 does not allow redirecting to an extension page
    // even if it is listed in web_accessible_resources.
    // Using data URI with meta or script refresh works but generates
    // an extra history entry.
    if (utils.userAgent.soup.has('firefox') && utils.userAgent.major < 56) {
      browser.tabs.update(details.tabId, {url: redirectUrl});
      return {cancel: true};
    }

    return {redirectUrl: redirectUrl};
  } else {
    const redirectUrl = utils.getBlockedPageUrl(url, blockType, true);
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
function onBeforeRequestCallback(details) {
  return updateFilterPromise.then(() => {
    return onBeforeRequestBlocker(details);
  });
};

function autoUpdateFilter() {
  if (autoUpdateFilterTimer) {
    clearInterval(autoUpdateFilterTimer);
    autoUpdateFilterTimer = null;
  }

  return utils.getOptions([
    "webBlacklistsUpdateInterval",
  ]).then(({webBlacklistsUpdateInterval}) => {
    autoUpdateFilterTimer = setInterval(updateFilter, webBlacklistsUpdateInterval);
  });
}

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
      case 'isUrlBlocked': {
        return updateFilterPromise.then(() => {
          return filter.isBlocked(args.url);
        });
      }
      case 'isTempUnblocked': {
        return Promise.resolve(tempUnblockTabs.has(sender.tab.id));
      }
      case 'tempUnblock': {
        const tabId = sender.tab.id;
        return utils.getOptions([
          "tempUnblockDuration",
          "tempUnblockCountdownBase",
          "tempUnblockCountdownIncrement",
          "tempUnblockCountdownReset",
          "tempUnblockCountdown",
          "tempUnblockLastAccess",
        ]).then((options) => {
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

          return utils.setOptions({
            tempUnblockCountdown: options.tempUnblockCountdown,
            tempUnblockLastAccess: options.tempUnblockLastAccess,
          });
        }).then(() => {
          return true;
        });
      }
      case 'getMergedBlacklist': {
        return updateFilterPromise.then(() => {
          return filter.getMergedBlacklist();
        });
      }
      case 'updateOptions': {
        const validator = new ContentFarmFilter();
        args.transformRules = validator.validateTransformRulesText(args.transformRules);
        validator.addTransformRules(args.transformRules);
        args.userBlacklist = validator.validateRulesText(args.userBlacklist, 'url');
        args.userWhitelist = validator.validateRulesText(args.userWhitelist, 'url');
        return utils.setOptions(args).then(() => {
          return true;
        });
      }
      case 'closeTab': {
        Promise.resolve().then(() => {
          if (args.tabId) { return [args.tabId]; }
          return browser.tabs.query({
            active: true,
            currentWindow: true
          }).then((tabs) => {
            return tabs.map(x => x.id);
          });
        }).then((tabIds) => {
          return browser.tabs.remove(tabIds);
        });
        return Promise.resolve(true);
      }
    }
  });
}

function initStorageChangeListener() {
  browser.storage.onChanged.addListener((changes, areaName) => {
    // Config keys are stored in storage.sync and fallbacks to storage.local;
    // cache keys are stored in storage.local and are valid JSON format.
    // We only take action when at least one config key is changed.
    if (areaName !== "sync") {
      // skip if it's a storage.local.remove() rather than a real user modification
      for (let key in changes) {
        if (!("newValue" in changes[key])) { return; }
        break;
      }

      // skip if no config key is changed
      try {
        for (let key in changes) { JSON.parse(key); }
        return;
      } catch(ex) {}
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
      historyController.refresh();
    }

    if ("webBlacklistsUpdateInterval" in changes) {
      autoUpdateFilter();
    }

    {
      const listOptions = [
        "webBlacklists",
        "userBlacklist",
        "userWhitelist",
        "transformRules",
      ].filter(x => x in changes);
      if (listOptions.length) {
        updateFilter().then(() => {
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
        });
      }
    }
  });
}

function initInstallListener() {
  browser.runtime.onInstalled.addListener((details) => {
    const {reason, previousVersion} = details;

    if (reason === "update" && utils.versionCompare(previousVersion, "2.1.2") === -1) {
      return Promise.resolve().then(() => {
        console.warn("Migrating options from < 2.1.2");
        return utils.getOptions({
          "webBlacklist": undefined,
          "webBlacklists": undefined,
        }).then((options) => {
          if (options.webBlacklist && (typeof options.webBlacklists === "undefined")) {
            let newWebBlacklists = utils.defaultOptions.webBlacklists + "\n" + options.webBlacklist;
            return utils.setOptions({webBlacklists: newWebBlacklists}).then(() => {
              updateFilter();
            });
          }
        });
      }).then(() => {
        console.warn("Migrated successfully.");
      });
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
    let url;
    try {
      const refUrlObj = new URL(tab.url);
      if (!(refUrlObj.protocol === 'http:' || refUrlObj.protocol === 'https:')) {
        throw new Error('URL not under http(s) protocol.');
      }
      const refUrl = utils.getNormalizedUrl(refUrlObj);
      url = browser.runtime.getURL("options.html") + `?from=${encodeURIComponent(refUrl)}`;
    } catch (ex) {
      url = browser.runtime.getURL("options.html");
    }
    browser.tabs.create({url: url, active: true});
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
      return autoUpdateFilter();
    });
}

init();
