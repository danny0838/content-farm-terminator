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
    suppressHistory: false,
    showLinkMarkers: true,
    showContextMenuCommands: true,
    quickContextMenuCommands: false,
    showUnblockButton: true,
    tempUnblockDuration: 8000,
    tempUnblockCountdownBase: 10000,
    tempUnblockCountdownIncrement: 5000,
    tempUnblockCountdownReset: 24 * 60 * 60 * 1000,
    tempUnblockCountdown: -1,
    tempUnblockLastAccess: -1,
  },

  getDefaultOptions() {
    return this.getOptions(this.defaultOptions);
  },

  /**
   * Use storage.local > storage.sync > passed values
   *
   * @param options - A string, array of strings, or an object.
   *     Use defaultOptions as fallback value for string and array.
   */
  getOptions(options) {
    if (typeof options === "string") {
      options = { [options]: this.defaultOptions[options] };
    } else if (Array.isArray(options)) {
      const newOptions = {};
      options.forEach((option) => { newOptions[option] = this.defaultOptions[option]; })
      options = newOptions;
    }
    const keys = Object.keys(options);
    return browser.storage.sync.get(keys)
      .catch((ex) => {})
      .then((syncResult) => {
        // merge options from storage.local to options from storage.sync
        return browser.storage.local.get(keys)
          .then((result) => {
            return Object.assign({}, options, syncResult, result);
          });
      });
  },

  setOptions(options) {
    return browser.storage.sync.set(options)
      .then(() => {
        return browser.storage.local.remove(Object.keys(options));
      }, (ex) => {
        return browser.storage.local.set(options);
      });
  },

  clearOptions() {
    return browser.storage.sync.clear()
      .catch((ex) => {})
      .then(() => {
        return browser.storage.local.clear();
      });
  },

  /**
   * ref: source code of vAPI.webextFlavor of uBlock Origin
   */
  get userAgent() {
    const ua = navigator.userAgent;
    const soup = new Set(['webext']);
    const flavor = {
      major: 0,
      soup: soup,
    };

    const dispatch = () => {
      window.dispatchEvent(new CustomEvent('browserInfoLoaded'));
    };

    // Whether this is a dev build.
    if (/^\d+\.\d+\.\d+\D/.test(browser.runtime.getManifest().version)) {
      soup.add('devbuild');
    }

    if (/\bMobile\b/.test(ua)) {
      soup.add('mobile');
    }

    // Asynchronous
    Promise.resolve().then(() => {
      return browser.runtime.getBrowserInfo();
    }).then((info) => {
      flavor.major = parseInt(info.version, 10) || 0;
      soup.add(info.vendor.toLowerCase());
      soup.add(info.name.toLowerCase());
      soup.delete('user_stylesheet');
      if (flavor.major >= 53) { soup.add('user_stylesheet'); }
      soup.delete('html_filtering');
      if (flavor.major >= 57) { soup.add('html_filtering'); }
      dispatch();
    }, (ex) => {
      // dummy event for potential listeners
      dispatch();
    }).catch((ex) => {
      console.error(ex);
    });

    // Synchronous -- order of tests is important
    var match;
    if ((match = /\bFirefox\/(\d+)/.exec(ua)) !== null) {
      flavor.major = parseInt(match[1], 10) || 0;
      soup.add('mozilla').add('firefox');
      if (flavor.major >= 53) { soup.add('user_stylesheet'); }
      if (flavor.major >= 57) { soup.add('html_filtering'); }
    } else if ((match = /\bEdge\/(\d+)/.exec(ua)) !== null) {
      flavor.major = parseInt(match[1], 10) || 0;
      soup.add('microsoft').add('edge');
    } else if ((match = /\bOPR\/(\d+)/.exec(ua)) !== null) {
      const reEx = /\bChrom(?:e|ium)\/([\d.]+)/;
      if (reEx.test(ua)) { match = reEx.exec(ua); }
      flavor.major = parseInt(match[1], 10) || 0;
      soup.add('opera').add('chromium');
    } else if ((match = /\bChromium\/(\d+)/.exec(ua)) !== null) {
      flavor.major = parseInt(match[1], 10) || 0;
      soup.add('chromium');
    } else if ((match = /\bChrome\/(\d+)/.exec(ua)) !== null) {
      flavor.major = parseInt(match[1], 10) || 0;
      soup.add('google').add('chromium');
    } else if ((match = /\bSafari\/(\d+)/.exec(ua)) !== null) {
      flavor.major = parseInt(match[1], 10) || 0;
      soup.add('apple').add('safari');
    }

    // https://github.com/gorhill/uBlock/issues/3588
    if (soup.has('chromium') && flavor.major >= 66) {
      soup.add('user_stylesheet');
    }

    Object.defineProperty(this, 'userAgent', { value: flavor });
    return flavor;
  },

  lang(key, args) {
    return browser.i18n.getMessage(key, args) || "__MSG_" + key + "__";
  },

  loadLanguages(...args) {
    const reReplacer = /__MSG_(.*?)__/;
    const fnReplacer = (m, k) => utils.lang(k);
    const fn = this.loadLanguages = (rootNode = document) => {
      Array.prototype.forEach.call(rootNode.getElementsByTagName("*"), (elem) => {
        if (elem.childNodes.length === 1) {
          const child = elem.firstChild;
          if (child.nodeType === 3) {
            child.nodeValue = child.nodeValue.replace(reReplacer, fnReplacer);
          }
        }
        Array.prototype.forEach.call(elem.attributes, (attr) => {
          attr.nodeValue = attr.nodeValue.replace(reReplacer, fnReplacer);
        }, this);
      }, this);
    };
    return fn(...args);
  },

  escapeHtml(...args) {
    const reEscaper = /[&<>"']| (?= )/g;
    const mapEscaper = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
      " ": "&nbsp;"
    };
    const fnEscaper = m => mapEscaper[m];
    const fn = this.escapeHtml = (str, noDoubleQuotes = false, singleQuotes = false, spaces = false) => {
      mapEscaper['"'] = noDoubleQuotes ? '"' : "&quot;";
      mapEscaper["'"] = singleQuotes ? "&#39;" : "'";
      mapEscaper[" "] = spaces ? "&nbsp;" : " ";
      return str.replace(reEscaper, fnEscaper);
    };
    return fn(...args);
  },

  escapeRegExp(...args) {
    const reStandard = /[-\/\\^$*+?.|()[\]{}]/g;
    const reSimple = /[\\^$*+?.|()[\]{}]/g;
    const fn = this.escapeRegExp = (str, simple) => {
      if (simple) {
        // Do not escape "-" and "/"
        return str.replace(reSimple, "\\$&");
      }
      // Escaping "-" allows the result to be inserted into a character class.
      // Escaping "/" allow the result to be used in a JS regex literal.
      return str.replace(reStandard, "\\$&");
    };
    return fn(...args);
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

  getLines(...args) {
    const reSplitter = /\n|\r\n?/;
    const fn = this.getLines = (str) => {
      return (str || "").split(reSplitter);
    };
    return fn(...args);
  },

  versionCompare(v1, v2) {
    const v1parts = v1.split('.');
    const v2parts = v2.split('.');

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
    const redirectUrl = `${browser.runtime.getURL('blocked.html')}?to=${encodeURIComponent(url)}&type=${blockType}`;

    // A frame may be too small to show full description about blocking.
    // Display a link for opening in a new tab instead.
    if (inFrame) {
      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body>
<img src="${utils.escapeHtml(browser.runtime.getURL("img/content-farm-marker.svg"))}" alt="" style="width: 1em;"><a href="${utils.escapeHtml(redirectUrl, false)}" target="_blank">${utils.lang("viewBlockedFrame")}</a>
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
      lines: new Set(),
      rules: new Map(),
      mergedRe: null,
    };
    this._whitelist = {
      lines: new Set(),
      rules: new Map(),
      mergedRe: null,
    };
    this._transformRules = [];
  }

  addBlockList(listText, blockList) {
    utils.getLines(listText).forEach((ruleLine) => {
      if (!ruleLine.trim()) { return; }
      blockList.lines.add(ruleLine);
      const parsed = this.parseRuleLine(ruleLine);
      blockList.rules.set(parsed.rule, parsed);
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

  addTransformRules(...args) {
    const reReplacer = /\\\*/g;
    const fn = this.addTransformRules = (rulesText) => {
      utils.getLines(rulesText).forEach((ruleLine) => {
        let {pattern, replace} = this.parseTransformRuleLine(ruleLine);

        if (pattern && replace) {
          if (pattern.startsWith('/') && pattern.endsWith('/')) {
            // RegExp rule
            pattern = new RegExp(pattern.slice(1, -1));
          } else {
            // standard rule
            pattern = new RegExp(utils.escapeRegExp(pattern).replace(reReplacer, "[^:/?#]*"));
          }

          this._transformRules.push({pattern, replace});
        }
      });
    };
    return fn(...args);
  }

  /**
   * @param {string} urlOrHostname - url or hostname
   * @return {number} 0: not blocked; 1: blocked by standard rule; 2: blocked by regex rule
   */
  isBlocked(...args) {
    const reSchemeChecker = /^[A-Za-z][0-9A-za-z.+-]*:\/\//;
    const fn = this.isBlocked = (urlOrHostname) => {
      let u;
      try {
        u = new URL(reSchemeChecker.test(urlOrHostname) ? urlOrHostname : 'http://' + urlOrHostname);
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
    };
    return fn(...args);
  }

  isInBlacklist(ruleLine) {
    const {rule} = this.parseRuleLine(ruleLine);
    return this._blacklist.rules.has(rule);
  }

  urlsTextToLines(...args) {
    const reTidy = /[\s#].*$/g;
    const fn = this.urlsTextToLines = (urlsText) => {
      return utils
        .getLines(urlsText)
        .map(u => u.replace(reTidy, ''))
        .filter(x => !!x.trim());
    };
    return fn(...args);
  }

  transformRule(...args) {
    const regex = /\$([$&`']|\d+)/g;
    const fn = this.transformRule = (rule) => {
      this._transformRules.some((tRule) => {
        const match = tRule.pattern.exec(rule);
        if (match) {
          const leftContext = RegExp.leftContext;
          const rightContext = RegExp.rightContext;
          const useRegex = tRule.replace.startsWith('/') && tRule.replace.endsWith('/');
          rule = tRule.replace.replace(regex, (_, m) => {
            let result;
            if (m === '$') {
              return '$';
            } else if (m === '&') {
              result = match[0];
            } else if (m === '`') {
              result = leftContext;
            } else if (m === "'") {
              result = rightContext;
            } else {
              let matchIdx = m, matchIdxInt, plainNum = '';
              while (matchIdx.length) {
                matchIdxInt = parseInt(matchIdx, 10);
                if (matchIdxInt < match.length && matchIdxInt > 0) {
                  result = match[matchIdxInt] + plainNum;
                  break;
                }
                plainNum = matchIdx.slice(-1) + plainNum;
                matchIdx = matchIdx.slice(0, -1);
              }
              if (typeof result === 'undefined') {
                return '$' + plainNum;
              }
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
    };
    return fn(...args);
  }

  validateRule(...args) {
    const reHostEscaper = /[xX*]/g;
    const reHostUnescaper = /x[xa]/g;
    const mapHostEscaper = {"x": "xx", "X": "xX", "*": "xa"};
    const mapHostUnescaper = {xx: "x", xX: "X", xa: "*"};
    const fnHostEscaper = m => mapHostEscaper[m];
    const fnHostUnescaper = m => mapHostUnescaper[m];
    const reSchemeChecker = /^[A-Za-z][0-9A-za-z.+-]*:\/\//;
    const reWwwRemover = /^www\./;
    const fn = this.validateRule = (rule) => {
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
          let t = rule.replace(reHostEscaper, fnHostEscaper);
          // add a scheme if none to make a valid URL
          if (!reSchemeChecker.test(t)) { t = "http://" + t; }
          // get hostname
          t = new URL(t).hostname;
          // remove "www."
          t = t.replace(reWwwRemover, "");
          // convert punycode to unicode
          t = punycode.toUnicode(t);
          // unescape "*"
          t = t.replace(reHostUnescaper, fnHostUnescaper);
          return t;
        } catch (ex) {
          // invalid URL hostname
          console.error(ex);
        }
      }
      return "";
    };
    return fn(...args);
  }

  validateRulesText(rulesText, transform = false) {
    const parseOptions = {validate: true, transform: transform, asString: true};
    return utils
      .getLines(rulesText)
      .map(ruleLine => this.parseRuleLine(ruleLine, parseOptions))
      .join("\n");
  }

  validateTransformRulesText(rulesText) {
    const parseOptions = {validate: true, asString: true};
    return utils
      .getLines(rulesText)
      .map(ruleLine => this.parseTransformRuleLine(ruleLine, parseOptions))
      .join("\n");
  }

  /**
   * @param {Object} options
   *     - {boolean} validate
   *     - {boolean} transform
   *     - {boolean} asString
   */
  parseRuleLine(...args) {
    const reSpaceMatcher = /^(\S*)(\s*)(.*)$/;
    const reSchemeChecker = /^[A-Za-z][0-9A-za-z.+-]*:/;
    const fn = this.parseRuleLine = (ruleLine, options = {}) => {
      let [, rule, sep, comment] = (ruleLine || "").match(reSpaceMatcher);

      if (options.transform) {
        switch (options.transform) {
          case 'standard':
            if (!(rule.startsWith('/') && rule.endsWith('/'))) {
              rule = this.transformRule(rule);
            }
            break;
          case 'url':
            if (!(rule.startsWith('/') && rule.endsWith('/'))) {
              if (reSchemeChecker.test(rule)) {
                rule = this.transformRule(rule);
              }
            }
            break;
          default:
            rule = this.transformRule(rule);
            break;
        }
      }

      if (options.validate) {
        rule = this.validateRule(rule);
      }

      if (options.asString) {
        return [rule, sep, comment].join("");
      }

      return {rule, sep, comment};
    };
    return fn(...args);
  }

  /**
   * @param {Object} options
   *     - {boolean} validate
   *     - {boolean} asString
   */
  parseTransformRuleLine(...args) {
    const reSpaceMatcher = /^(\S*)(\s*)(\S*)(\s*)(.*)$/;
    const fn = this.parseTransformRuleLine = (ruleLine, options = {}) => {
      let [, pattern, sep, replace, sep2, comment] = (ruleLine || "").match(reSpaceMatcher);

      if (options.validate) {
        pattern = this.validateRule(pattern);
      }

      if (options.asString) {
        return [pattern, sep, replace, sep2, comment].join("");
      }

      return {pattern, sep, replace, sep2, comment};
    };
    return fn(...args);
  }

  makeMergedRegex(...args) {
    const reReplacer = /\\\*/g;
    const mergeFunc = (blockList) => {
      let standardRules = [];
      let regexRules = [];
      blockList.rules.forEach(({rule}) => {
        if (rule.startsWith('/') && rule.endsWith('/')) {
          // RegExp rule
          regexRules.push(rule.slice(1, -1));
        } else {
          // standard rule
          standardRules.push(utils.escapeRegExp(rule).replace(reReplacer, "[^:/?#]*"));
        }
      });
      standardRules = standardRules.join('|');
      regexRules = regexRules.join('|');
      // ref: https://tools.ietf.org/html/rfc3986#appendix-A
      const re = "^https?://" + 
          "(?:[-._~0-9A-Za-z%!$&'()*+,;=:]+@)?" + 
          "(?:[^@:/?#]+\\.)?" + 
          "(" + standardRules + ")" + // capture standard rule
          "(?=[:/?#]|$)" + 
          (regexRules ? "|" + regexRules : "");
      blockList.mergedRe = new RegExp(re);
    };
    const fn = this.makeMergedRegex = (blockList) => {
      if (this._listUpdated) {
        this._listUpdated = false;
        mergeFunc(this._blacklist);
        mergeFunc(this._whitelist);
      }
    };
    return fn(...args);
  }

  getMergedBlacklist() {
    return [...this._blacklist.lines].join("\n");
  }

  webListCacheKey(url) {
    return JSON.stringify({webBlocklistCache: url});
  }

  getWebListCache(url) {
    const key = this.webListCacheKey(url);
    return browser.storage.local.get(key)
      .catch((ex) => {
        console.error(ex);
      });
  }

  setWebListCache(url, time, rulesText) {
    return browser.storage.local.set({
      [this.webListCacheKey(url)]: {time, rulesText}
    })
      .catch((ex) => {
        console.error(ex);
      });
  }

  clearStaleWebListCache(webListChange) {
    const {newValue, oldValue} = webListChange;
    const urlSet = new Set(filter.urlsTextToLines(newValue));
    const deletedUrls = filter.urlsTextToLines(oldValue).filter(u => !urlSet.has(u));
    return browser.storage.local.remove(deletedUrls.map(this.webListCacheKey))
      .catch((ex) => {
        console.error(ex);
      });
  }
}
