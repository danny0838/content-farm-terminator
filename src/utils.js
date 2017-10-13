const utils = {
  /**
   * Options
   *
   * Use sync storage as viable, fallback to local storage.
   *
   * - get: load priority as local > sync > default
   *
   * - set: store to sync, if succeeds, remove corresponding keys from local
   *   (so that new data synced from other terminals will be used); and store
   *   to local if failed.
   *
   *   A set could fail due to:
   *   - storage.sync not available: storage.sync is undefined in Firefox < 52;
   *     storage.sync methods fail if Firefox config
   *     webextensions.storage.sync.enabled is not set to true.
   *   - the data to be stored exceeds quota or other limit
   *   - other unclear reason (during data syncing?)
   *
   * - clear: clear sync and local
   */
  defaultOptions: {
    userBlacklist: "",
    userWhitelist: "",
    webBlacklists: "https://danny0838.github.io/content-farm-terminator/files/blocklist/content-farms.txt",
    displayContextMenuCommands: true,
  },

  getDefaultOptions(options) {
    return this.getOptions(this.defaultOptions);
  },

  // Use storage.local > storage.sync > default
  getOptions(options) {
    let keys = Object.keys(options);
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    }).catch((ex) => {}).then((syncResult) => {
      // merge options from storage.local to options from storage.sync
      return new Promise((resolve, reject) => {
        return chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(result);
          }
        });
      }).then((result) => {
        return Object.assign(options, syncResult, result);
      });
    });
  },

  setOptions(options) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(options, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    }).then(() => {
      return new Promise((resolve, reject) => {
        chrome.storage.local.remove(Object.keys(options), () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    }, (ex) => {
      console.warn(ex.message);
      return new Promise((resolve, reject) => {
        chrome.storage.local.set(options, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    });
  },

  clearOptions() {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.clear(() => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    }).catch((ex) => {}).then(() => {
      return new Promise((resolve, reject) => {
        chrome.storage.local.clear(() => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    });
  },

  lang(key, args) {
    return chrome.i18n.getMessage(key, args) || "__MSG_" + key + "__";
  },

  loadLanguages(rootNode = document) {
    Array.prototype.forEach.call(rootNode.getElementsByTagName("*"), (elem) => {
      if (elem.childNodes.length === 1) {
        const child = elem.firstChild;
        if (child.nodeType === 3) {
          child.nodeValue = child.nodeValue.replace(/__MSG_(.*?)__/, (m, k) => utils.lang(k));
        }
      }
      Array.prototype.forEach.call(elem.attributes, (attr) => {
        attr.nodeValue = attr.nodeValue.replace(/__MSG_(.*?)__/, (m, k) => utils.lang(k));
      }, this);
    }, this);
  },

  escapeHtml(str, noDoubleQuotes = false, singleQuotes = false, spaces = false) {
    const list = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': (noDoubleQuotes ? '"' : "&quot;"),
      "'": (singleQuotes ? "&#39;" : "'"),
      " ": (spaces ? "&nbsp;" : " ")
    };
    return str.replace(/[&<>"']| (?= )/g, m => list[m]);
  },

  escapeRegExp(str) {
    return str.replace(/([\*\+\?\.\^\/\$\\\|\[\]\{\}\(\)])/g, "\\$1");
  },

  splitUrlByAnchor(url) {
    const pos = url.indexOf("#");
    if (pos !== -1) { return [url.slice(0, pos), url.slice(pos)]; }
    return [url, ""];
  },

  versionCompare(v1, v2) {
    let v1parts = v1.split('.');
    let v2parts = v2.split('.');

    for (let i = 0; i < v1parts.length; ++i) {
      if (typeof v2parts[i] === "undefined") {
        return 1;
      }

      let n1 = parseInt(v1parts[i], 10);
      let n2 = parseInt(v2parts[i], 10);

      if (n1 > n2) {
        return 1;
      } else if (n1 < n2) {
        return -1;
      }
    }

    if (v1parts.length < v2parts.length) {
      return -1;
    }

    return 0;
  },

  doctypeToString(doctype) {
    if (!doctype) { return ""; }
    let ret = "<!DOCTYPE " + doctype.name;
    if (doctype.publicId) { ret += ' PUBLIC "' + doctype.publicId + '"'; }
    if (doctype.systemId) { ret += ' "'        + doctype.systemId + '"'; }
    ret += ">\n";
    return ret;
  },

  readFileAsDocument(blob) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.responseType = "document";
      xhr.onload = () => { resolve(xhr.response); }
      xhr.onerror = () => { reject(new Error("Network request failed.")); }
      xhr.open("GET", URL.createObjectURL(blob), true);
      xhr.send();
    });
  },

  getBlockedPageUrl(url, inFrame = false) {
    const redirectUrl = `${chrome.runtime.getURL('blocked.html')}?to=${encodeURIComponent(url)}`;

    // A frame may be too small to show full description about blocking.
    // Display a link for opening in a new tab instead.
    if (inFrame) {
      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body>
<img src="${utils.escapeHtml(chrome.runtime.getURL("img/content-farm-marker.svg"))}" alt="" style="width: 1em;"><a href="${utils.escapeHtml(redirectUrl, false)}" target="_blank">${utils.lang("viewBlockedFrame")}</a>
</body>
</html>
`;
      const dataUrl = 'data:text/html;charset=UTF-8,' + encodeURIComponent(html);
      return dataUrl;
    }

    return redirectUrl;
  },
};

class ContentFarmFilter {
  constructor() {
    this._listUpdated = true;
    this._blacklist;
    this._whitelist;
    this._blacklistRawSet = new Set();
    this._blacklistSet = new Set();
    this._whitelistSet = new Set();
  }

  addBlackList(listText) {
    this.rulesTextToLines(listText).forEach((ruleText) => {
      const ruleRegex = this.ruleTextToRegex(ruleText);
      this._blacklistSet.add(ruleRegex);
      this._blacklistRawSet.add(ruleText);
    });
    this._listUpdated = true;
  }

  /**
   * @param {string} url - a URL with hash stripped
   */
  addBlackListFromUrl(url, noCache = false) {
    return this.getWebListCache(url).then((data) => {
      const time = Date.now();

      // retrieve rules from cache
      let cacheRulesText, cacheTime;
      if (data) {
        ({time: cacheTime, rulesText: cacheRulesText} = data);
        // use cached version if not expired
        if (time - cacheTime < 1 * 24 * 60 * 60 * 1000) { // 1 day
          return cacheRulesText;
        }
      }

      // retrieve rules from web
      // if no cache or cache has expired
      return fetch(url, {credentials: 'include'}).then((response) => {
        if (!response.ok) { throw new Error("response not ok"); }
        return response.text();
      }).catch((ex) => {
        console.error(`Unable to get blocklist from: '${url}'`);
        // fallback to cached version if web version not accessible
        return cacheRulesText;
      }).then((text) => {
        if (noCache) { return text; }
        // store retrieved rules to cache
        return this.setWebListCache(url, time, text).then(() => {
          return text;
        });
      });
    }).then((text) => {
      this.addBlackList(this.validateRulesText(text));
    }).catch((ex) => {
      console.error(ex);
    });
  }

  addWhiteList(listText) {
    this.rulesTextToLines(listText).forEach((ruleText) => {
      const ruleRegex = this.ruleTextToRegex(ruleText);
      this._whitelistSet.add(ruleRegex);
    });
    this._listUpdated = true;
  }

  /**
   * @param {string} url - url or hostname
   */
  isBlocked(url) {
    let hostname = (url.indexOf(":") !== -1) ? new URL(url).hostname : url;
    hostname = punycode.toUnicode(hostname);
    hostname = hostname.replace(/^www\./, "");
    if (this._listUpdated) {
      this._blacklist = this.getMergedRegex(this._blacklistSet);
      this._whitelist = this.getMergedRegex(this._whitelistSet);
      this._listUpdated = false;
    }
    if (this._whitelist.test(hostname)) { return false; }
    if (this._blacklist.test(hostname)) { return true; }
    return false;
  }

  urlsTextToLines(urlsText) {
    return (urlsText || "").split(/\n|\r\n?/).map(
      u => utils.splitUrlByAnchor(u.split(" ", 1)[0])[0]
    ).filter(x => !!x.trim());
  }

  validateRuleLine(ruleLine) {
    const parts = (ruleLine || "").split(" ");
    parts[0] = ((ruleText) => {
      if (!ruleText) { return ""; }
      try {
        // escape "*" to make a valid URL
        let t = ruleText.replace(/x/g, "xx").replace(/\*/g, "xa");
        // add a scheme if none to make a valid URL
        if (!/^[A-Za-z][0-9A-za-z+\-.]*:\/\//.test(t)) { t = "http://" + t; }
        // get hostname
        t = new URL(t).hostname;
        // unescape and remove "www."
        t = t.replace(/x[xa]/g, m => ({xx: "x", xa: "*"})[m]).replace(/^www\./, "");
        t = punycode.toUnicode(t);
        return t;
      } catch (ex) {}
      return "";
    })(parts[0]);
    return parts.join(" ");
  }

  validateRulesText(rulesText) {
    return (rulesText || "").split(/\n|\r\n?/).map(this.validateRuleLine).join("\n");
  }

  rulesTextToLines(rulesText) {
    return (rulesText || "").split(/\n|\r\n?/).filter(x => !!x.trim());
  }

  ruleTextToRegex(ruleText) {
    return utils.escapeRegExp(ruleText).replace(/\\\*/g, "[^/]*").replace(/ .*$/, "");
  }

  getMergedRegex(regexSet) {
    return new RegExp('^(?:.+\\.)?(?:' + [...regexSet].join('|') + ')$');
  }

  getMergedBlacklist() {
    return [...this._blacklistRawSet].join("\n");
  }

  webListCacheKey(url) {
    return JSON.stringify({webBlocklistCache:url});
  }

  getWebListCache(url) {
    return new Promise((resolve, reject) => {
      const key = this.webListCacheKey(url);
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result[key]);
        }
      });
    }).catch((ex) => {
      console.error(ex);
    });
  }

  setWebListCache(url, time, rulesText) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({
        [this.webListCacheKey(url)]: {time, rulesText}
      }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    }).catch((ex) => {
      console.error(ex);
    });
  }

  clearStaleWebListCache(webListChange) {
    return new Promise((resolve, reject) => {
      const {newValue, oldValue} = webListChange;
      const urlSet = new Set(filter.urlsTextToLines(newValue));
      const deletedUrls = filter.urlsTextToLines(oldValue).filter(u => !urlSet.has(u));
      chrome.storage.local.remove(deletedUrls.map(this.webListCacheKey), () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    }).catch((ex) => {
      console.error(ex);
    });
  }
}
