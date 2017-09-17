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

class ContentFarmFilter {
  constructor() {
    this._blacklist = new Set();
    this._whitelist = new Set();
    this._whitelistTemp = new Set();
  }

  addBlackList(listText) {
    this.parseRulesText(listText).forEach((ruleText) => {
      let ruleRegex = this.parseRuleRegex(ruleText);
      this._blacklist.add(ruleRegex);
    });
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
      this._whitelist.add(ruleRegex);
    });
  }

  isBlocked(url) {
    let hostname = new URL(url).hostname;
    for (let regex of this._whitelistTemp.values()) {
      if (regex.test(hostname)) { return false; }
    }
    for (let regex of this._whitelist.values()) {
      if (regex.test(hostname)) { return false; }
    }
    for (let regex of this._blacklist.values()) {
      if (regex.test(hostname)) { return true; }
    }
    return false;
  }

  unblockTemp(url, time = 15000) {
    let regex = this.parseRuleRegex(url);
    this._whitelistTemp.add(regex);
    setTimeout(() => {
      this._whitelistTemp.delete(regex);
    }, time);
  }

  parseRulesText(rulesText) {
    return (rulesText || "").split(/\n|\r\n?/).filter(x => !!x.trim());
  }

  parseRuleRegex(ruleText) {
    return new RegExp('^(?:www\.)?' + utils.escapeRegExp(ruleText).replace(/\\\*/g, "[^/]*") + '$');
  }
}
