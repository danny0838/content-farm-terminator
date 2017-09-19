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
    this.parseRulesText(listText).forEach((ruleText) => {
      let ruleRegex = this.parseRuleRegex(ruleText);
      this._blacklistSet.add(ruleRegex);
    });
    this._listUpdated = true;
  }

  addBlackListFromUrl(url) {
    return fetch(url, {credentials: 'include'}).then((response) => {
      return response.text();
    }).then((text) => {
      this.addBlackList(text);
    }).catch((ex) => {
      console.error(ex);
    });
  }

  addBuiltinBlackList() {
    let url = chrome.runtime.getURL('blacklist.txt');
    return this.addBlackListFromUrl(url);
  }

  addWhiteList(listText) {
    this.parseRulesText(listText).forEach((ruleText) => {
      let ruleRegex = this.parseRuleRegex(ruleText);
      this._whitelistSet.add(ruleRegex);
    });
    this._listUpdated = true;
  }

  /**
   * @param {string} url - url or hostname
   */
  isBlocked(url) {
    let hostname = (url.indexOf(":") !== -1) ? new URL(url).hostname : url;
    if (this._listUpdated) {
      this._blacklist = this.parseMergedRegex(this._blacklistSet);
      this._whitelist = this.parseMergedRegex(this._whitelistSet);
      this._listUpdated = false;
    }
    if (this._whitelist.test(hostname)) { return false; }
    if (this._blacklist.test(hostname)) { return true; }
    return false;
  }

  parseRulesText(rulesText) {
    return (rulesText || "").split(/\n|\r\n?/).filter(x => !!x.trim());
  }

  parseRuleRegex(ruleText) {
    return utils.escapeRegExp(ruleText).replace(/\\\*/g, "[^/]*");
  }

  parseMergedRegex(regexSet) {
    return new RegExp('^(?:www\.)?(?:' + Array.from(regexSet).join('|') + ')$');
  }
}
