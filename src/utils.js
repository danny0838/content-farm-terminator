var utils = {};

utils.lang = function (key, args) {
  return chrome.i18n.getMessage(key, args) || "__MSG_" + key + "__";
};

utils.loadLanguages = function (rootNode = document) {
  Array.prototype.forEach.call(rootNode.getElementsByTagName("*"), (elem) => {
    if (elem.childNodes.length === 1) {
      let child = elem.firstChild;
      if (child.nodeType === 3) {
        child.nodeValue = child.nodeValue.replace(/__MSG_(.*?)__/, (m, k) => utils.lang(k));
      }
    }
    Array.prototype.forEach.call(elem.attributes, (attr) => {
      attr.nodeValue = attr.nodeValue.replace(/__MSG_(.*?)__/, (m, k) => utils.lang(k));
    }, this);
  }, this);
};

utils.getOptions = function (options) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(options, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result);
      }
    });
  }).catch((ex) => {
    // fallback to storage.local if storage.sync is not available
    return new Promise((resolve, reject) => {
      return chrome.storage.local.get(options, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });
  });
};

utils.setOptions = function (options) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(options, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  }).catch((ex) => {
    // fallback to storage.local if storage.sync is not available
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
};

utils.escapeHtml = function (str, noDoubleQuotes, singleQuotes, spaces) {
  var list = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': (noDoubleQuotes ? '"' : "&quot;"),
    "'": (singleQuotes ? "&#39;" : "'"),
    " ": (spaces ? "&nbsp;" : " ")
  };
  return str.replace(/[&<>"']| (?= )/g, m => list[m]);
};

utils.escapeRegExp = function (str) {
  return str.replace(/([\*\+\?\.\^\/\$\\\|\[\]\{\}\(\)])/g, "\\$1");
};

utils.splitUrlByAnchor = function (url) {
  var pos = url.indexOf("#");
  if (pos !== -1) { return [url.slice(0, pos), url.slice(pos)]; }
  return [url, ""];
};

utils.doctypeToString = function (doctype) {
  if (!doctype) { return ""; }
  var ret = "<!DOCTYPE " + doctype.name;
  if (doctype.publicId) { ret += ' PUBLIC "' + doctype.publicId + '"'; }
  if (doctype.systemId) { ret += ' "'        + doctype.systemId + '"'; }
  ret += ">\n";
  return ret;
};

utils.readFileAsDocument = function (blob) {
  return new Promise((resolve, reject) => {
    var xhr = new XMLHttpRequest();
    xhr.responseType = "document";
    xhr.onload = () => { resolve(xhr.response); }
    xhr.onerror = () => { reject(new Error("Network request failed.")); }
    xhr.open("GET", URL.createObjectURL(blob), true);
    xhr.send();
  });
};

class ContentFarmFilter {
  constructor() {
    this._listUpdated = true;
    this._blacklist;
    this._whitelist;
    this._blacklistSet = new Set();
    this._whitelistSet = new Set();
  }

  addBlackList(listText) {
    this.rulesTextToLines(listText).forEach((ruleText) => {
      let ruleRegex = this.ruleTextToRegex(ruleText);
      this._blacklistSet.add(ruleRegex);
    });
    this._listUpdated = true;
  }

  /**
   * @param {string} url - a URL with hash stripped
   */
  addBlackListFromUrl(url, noCache = false) {
    return this.getWebListCache(url).then((text) => {
      if (typeof text !== "undefined") { return text; }
      var time = Date.now();
      return fetch(url, {credentials: 'include'}).then((response) => {
        return response.text();
      }).then((text) => {
        if (noCache) { return text; }
        return this.setWebListCache(url, time, text).then(() => {
          return text;
        });
      }).catch((ex) => {
        return "";
      });
    }).then((text) => {
      this.addBlackList(this.validateRulesText(text));
    }).catch((ex) => {
      console.error(ex);
    });
  }

  addBuiltinBlackList() {
    let url = chrome.runtime.getURL('blacklist.txt');
    return this.addBlackListFromUrl(url, true);
  }

  addWhiteList(listText) {
    this.rulesTextToLines(listText).forEach((ruleText) => {
      let ruleRegex = this.ruleTextToRegex(ruleText);
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
    return (urlsText || "").split(/\n|\r\n?/).map(x => utils.splitUrlByAnchor(x)[0]).filter(x => !!x.trim());
  }

  rulesTextToLines(rulesText) {
    return (rulesText || "").split(/\n|\r\n?/).filter(x => !!x.trim());
  }

  validateRulesText(rulesText) {
    return (rulesText || "").split(/\n|\r\n?/).map((ruleText) => {
      if (!ruleText) { return ""; }
      try {
        // escape "*" to make a valid URL
        var t = ruleText.replace(/x/g, "xx").replace(/\*/g, "xa");
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
    }).join("\n");
  }

  ruleTextToRegex(ruleText) {
    return utils.escapeRegExp(ruleText).replace(/\\\*/g, "[^/]*");
  }

  getMergedRegex(regexSet) {
    return new RegExp('^(?:www\.)?(?:' + Array.from(regexSet).join('|') + ')$');
  }

  webListCacheKey(url) {
    return JSON.stringify({webBlocklistCache:url});
  }

  getWebListCache(url) {
    return new Promise((resolve, reject) => {
      var key = this.webListCacheKey(url);
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result[key]);
        }
      });
    }).then((data) => {
      if (data) {
        var {time, rulesText} = data;
        // cache expires in 1 day
        if (Date.now() - time < 1 * 24 * 60 * 60 * 1000) {
          return rulesText;
        }
      }
    }).catch((ex) => {
      console.error(ex);
    });
  }

  setWebListCache(url, time, rulesText) {
    return new Promise((resolve, reject) => {
      var items = {};
      items[this.webListCacheKey(url)] = {time, rulesText};
      chrome.storage.local.set(items, () => {
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
      var {newValue, oldValue} = webListChange;
      var urlSet = new Set(filter.urlsTextToLines(newValue));
      var deletedUrls = filter.urlsTextToLines(oldValue).filter(u => !urlSet.has(u));
      chrome.storage.local.remove(deletedUrls.map(u => this.webListCacheKey(u)), () => {
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
