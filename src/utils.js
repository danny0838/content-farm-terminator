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
    webBlacklistsCacheDuration: 24 * 60 * 60 * 1000,
    webBlacklistsUpdateInterval: 30 * 60 * 60 * 1000,
    transformRules: "",
    showContextMenuCommands: true,
    showUnblockButton: true,
    tempUnblockDuration: 8000,
    tempUnblockCountdownBase: 15000,
    tempUnblockCountdownIncrement: 10000,
    tempUnblockCountdownReset: 24 * 60 * 60 * 1000,
    tempUnblockCountdown: -1,
    tempUnblockLastAccess: -1,
  },

  getDefaultOptions() {
    return this.getOptions(this.defaultOptions);
  },

  // Use storage.local > storage.sync > passed values
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
        return Object.assign({}, options, syncResult, result);
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

  escapeRegExp(str, simple) {
    if (simple) {
      // Do not escape "-" and "/"
      return str.replace(/[\\^$*+?.|()[\]{}]/g, "\\$&");
    }
    // Escaping "-" allows the result to be inserted into a character class.
    // Escaping "/" allow the result to be used in a JS regex literal.
    return str.replace(/[-\/\\^$*+?.|()[\]{}]/g, "\\$&");
  },

  getNormalizedUrl(urlObj) {
    const u = urlObj.username;
    const p = urlObj.password;
    const h = punycode.toUnicode(urlObj.hostname); // URL.hostname is punycoded in Chrome
    const t = urlObj.port;
    return urlObj.protocol + '//' + 
        (u ? u + (p ? ':' + p : '') + '@' : '') + 
        h + 
        (t ? ':' + t : '') + 
        urlObj.pathname + urlObj.search + urlObj.hash;
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

  getBlockedPageUrl(url, blockType = 1, inFrame = false) {
    const redirectUrl = `${chrome.runtime.getURL('blocked.html')}?to=${encodeURIComponent(url)}&type=${blockType}`;

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
    this._blacklist = {
      rawSet: new Set(),
      standardReTextSet: new Set(),
      regexReTextSet: new Set(),
      mergedRe: null,
    };
    this._whitelist = {
      rawSet: new Set(),
      standardReTextSet: new Set(),
      regexReTextSet: new Set(),
      mergedRe: null,
    };
    this._transformRules = [];
  }

  addBlockList(listText, blockList) {
    this.rulesTextToLines(listText).forEach((ruleLine) => {
      blockList.rawSet.add(ruleLine);
      const {type, ruleReText} = this.parseRuleLine(ruleLine);
      switch (type) {
        case "regex":
          blockList.regexReTextSet.add(ruleReText);
          break;
        default:
          blockList.standardReTextSet.add(ruleReText);
          break;
      }
    });
    this._listUpdated = true;
  }

  addBlackList(listText) {
    this.addBlockList(listText, this._blacklist);
  }

  addWhiteList(listText) {
    this.addBlockList(listText, this._whitelist);
  }

  /**
   * @param {string} url - a URL with hash stripped
   */
  addBlackListFromUrl(url, cacheDuration = 0, doNotCache = false) {
    return this.getWebListCache(url).then((data) => {
      const time = Date.now();

      // retrieve rules from cache
      let cacheRulesText, cacheTime;
      if (data) {
        ({time: cacheTime, rulesText: cacheRulesText} = data);
        // use cached version if not expired
        if (time - cacheTime < cacheDuration) {
          return cacheRulesText;
        }
      }

      // retrieve rules from web
      // if no cache or cache has expired
      return fetch(url, {
        credentials: 'include',
        cache: 'no-cache',
      }).then((response) => {
        if (!response.ok) { throw new Error("response not ok"); }
        return response.text();
      }).catch((ex) => {
        console.error(`Unable to get blocklist from: '${url}'`);
        // fallback to cached version if web version not accessible
        return cacheRulesText;
      }).then((text) => {
        if (doNotCache) { return text; }
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

  addTransformRules(rulesText) {
    (rulesText || "").split(/\n|\r\n?/).forEach((ruleLine) => {
      const parts = (ruleLine || "").split(" ");
      let pattern = parts[0];
      let replace = parts[1];

      if (pattern && replace) {
        if (pattern.startsWith('/') && pattern.endsWith('/')) {
          // RegExp rule
          pattern = new RegExp(pattern.slice(1, -1));
        } else {
          // standard rule
          pattern = new RegExp(utils.escapeRegExp(pattern).replace(/\\\*/g, "[^:/?#]*"));
        }

        this._transformRules.push({pattern, replace});
      }
    });
  }

  /**
   * @param {string} url - url or hostname
   * @return {number} 0: not blocked; 1: blocked by standard rule; 2: blocked by regex rule
   */
  isBlocked(url) {
    let u;
    try {
      u = new URL((url.indexOf(":") !== -1) ? url : 'http://' + url);
      u = utils.getNormalizedUrl(u);
    } catch (ex) {
      // bad URL
      return 0;
    }

    // update the regex if the rules have been changed
    this.makeMergedRegex();

    if (this._whitelist.mergedRe.test(u)) { return 0; }
    if (this._blacklist.mergedRe.test(u)) { return RegExp.$1 ? 1 : 2; }
    return 0;
  }

  isInBlacklist(ruleLine) {
    const {type, ruleReText} = this.parseRuleLine(ruleLine);
    switch (type) {
      case "regex":
        return this._blacklist.regexReTextSet.has(ruleReText);
        break;
      default:
        return this._blacklist.standardReTextSet.has(ruleReText);
        break;
    }
  }

  urlsTextToLines(urlsText) {
    return (urlsText || "").split(/\n|\r\n?/).map(
      u => utils.splitUrlByAnchor(u.split(" ", 1)[0])[0]
    ).filter(x => !!x.trim());
  }

  transformRule(rule) {
    this._transformRules.some((tRule) => {
      const match = tRule.pattern.exec(rule);
      if (match) {
        const useRegex = tRule.replace.startsWith('/') && tRule.replace.endsWith('/');
        rule = tRule.replace.replace(/\$([$&\d])/g, (_, m) => {
          let result;
          if (m === '$') {
            result = '$';
          } else if (m === '&') {
            result = match[0];
          } else {
            result = match[parseInt(m, 10)];
          }
          if (useRegex) {
            result = utils.escapeRegExp(result, true);
          }
          return result;
        });
        return true;
      }
      return false;
    });
    return rule;
  }

  validateRule(rule) {
    if (!rule) { return ""; }

    if (rule.startsWith('/') && rule.endsWith('/')) {
      // RegExp rule
      try {
        // test if the RegExp is valid
        new RegExp(rule.slice(1, -1));
        return rule;
      } catch (ex) {
        // invalid RegExp syntax
        console.error(ex);
      }
    } else {
      // standard rule
      try {
        // escape "*" to make a valid URL
        let t = rule.replace(/x/g, "xx").replace(/\*/g, "xa");
        // add a scheme if none to make a valid URL
        if (!/^[A-Za-z][0-9A-za-z+\-.]*:\/\//.test(t)) { t = "http://" + t; }
        // get hostname
        t = new URL(t).hostname;
        // remove "www."
        t = t.replace(/^www\./, "");
        // convert punycode to unicode
        t = punycode.toUnicode(t);
        // unescape "*"
        t = t.replace(/x[xa]/g, m => ({xx: "x", xa: "*"})[m]);
        return t;
      } catch (ex) {
        // invalid URL hostname
        console.error(ex);
      }
    }
    return "";
  }

  validateRuleLine(ruleLine) {
    const parts = (ruleLine || "").split(" ");
    parts[0] = this.validateRule(parts[0]);
    return parts.join(" ");
  }

  validateRulesText(rulesText) {
    return (rulesText || "").split(/\n|\r\n?/).map(this.validateRuleLine, this).join("\n");
  }

  validateTransformRulesText(rulesText) {
    return (rulesText || "").split(/\n|\r\n?/).map((ruleLine) => {
      const parts = (ruleLine || "").split(" ");
      parts[0] = this.validateRule(parts[0]);
      return parts.join(" ");
    }, this).join("\n");
  }

  parseRuleLine(ruleLine) {
    let result = {};
    let rule = ruleLine.replace(/\s.*$/, "");

    if (rule.startsWith('/') && rule.endsWith('/')) {
      // RegExp rule
      result.type = "regex";
      result.ruleText = rule;
      result.ruleReText = rule.slice(1, -1);
    } else {
      // standard rule
      result.type = "standard";
      result.ruleText = rule;
      result.ruleReText = utils.escapeRegExp(rule).replace(/\\\*/g, "[^:/?#]*");
    }

    return result;
  }

  rulesTextToLines(rulesText) {
    return (rulesText || "").split(/\n|\r\n?/).filter(x => !!x.trim());
  }

  makeMergedRegex(blockList) {
    if (!this.makeMergedRegex.mergeFunc) {
      this.makeMergedRegex.mergeFunc = function getMergedRegex(blockList) {
        const extRegex = [...blockList.regexReTextSet].join('|');
        const re = '^https?://' + 
            '(?:[\\w.+-]+(?::[\\w.+-]+)?@)?' + 
            '(?:[^:/?#]+\\.)?' + 
            '(' + [...blockList.standardReTextSet].join('|') + ')' + // capture standard rule
            '(?=$|[:/?#])' + 
            (extRegex ? '|' + extRegex : '');
        blockList.mergedRe = new RegExp(re);
      };
    }

    if (this._listUpdated) {
      this.makeMergedRegex.mergeFunc(this._blacklist);
      this.makeMergedRegex.mergeFunc(this._whitelist);
      this._listUpdated = false;
    }
  }

  getMergedBlacklist() {
    return [...this._blacklist.rawSet].join("\n");
  }

  webListCacheKey(url) {
    return JSON.stringify({webBlocklistCache: url});
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
