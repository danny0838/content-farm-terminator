class ContentFarmFilter {
  constructor() {
    this._listUpdated = true;
    this._blacklist = {
      lines: new Set(),
      rules: new Map(),
    };
    this._whitelist = {
      lines: new Set(),
      rules: new Map(),
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
    const reRegexRule = /^\/(.*)\/([a-z]*)$/;
    const reAsteriskReplacer = /\\\*/g;
    const fn = this.addTransformRules = (rulesText) => {
      utils.getLines(rulesText).forEach((ruleLine) => {
        let {pattern, replace} = this.parseTransformRuleLine(ruleLine);

        if (pattern && replace) {
          if (reRegexRule.test(pattern)) {
            // RegExp rule
            pattern = new RegExp(RegExp.$1, RegExp.$2);
          } else {
            // standard rule
            pattern = new RegExp(utils.escapeRegExp(pattern).replace(reAsteriskReplacer, "[^:/?#]*"));
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
    const reIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
    const hostnameMatchBlockList = (hostname, blocklist) => {
      if ((hostname.startsWith('[') && hostname.endsWith(']')) || reIpv4.test(hostname)) {
        // IP hostname
        return blocklist.standardRulesDict.match(hostname);
      }

      // domain name hostname
      if (hostname.startsWith('www.')) {
        hostname = hostname.slice(4);
      }

      const rv = new Map();
      let domain = hostname;
      let pos;
      while (true) {
        const m = blocklist.standardRulesDict.match(domain);
        for (const [k, v] of m) {
          rv.set(k, v);
          return rv; // return first match
        }
        pos = domain.indexOf('.');
        if (pos === -1) { break; }
        domain = domain.slice(pos + 1);
      }
      return rv;
    };
    const urlMatchBlockList = (url, blocklist) => {
      const rv = new Map();
      for (const regex of blocklist.regexes) {
        regex.lastIndex = 0;
        if (regex.test(url)) {
          // @TODO: reference the matched rule
          rv.set(true, true);
        }
      }
      return rv;
    };
    const fn = this.isBlocked = (urlOrHostname) => {
      let urlObj;
      try {
        urlObj = new URL(reSchemeChecker.test(urlOrHostname) ? urlOrHostname : 'http://' + urlOrHostname);
      } catch (ex) {
        // bad URL
        return 0;
      }

      this.makeCachedRules();
 
      // URL.hostname is not punycoded in some old browsers (e.g. Firefox 52)
      const h = punycode.toASCII(urlObj.hostname);

      let rules;
      let blocklist;

      blocklist = this._whitelist;

      rules = hostnameMatchBlockList(h, blocklist);
      if (rules.size) {
        return 0;
      }

      const url = utils.getNormalizedUrl(urlObj);

      rules = urlMatchBlockList(url, blocklist);
      if (rules.size) {
        return 0;
      }

      blocklist = this._blacklist;

      rules = hostnameMatchBlockList(h, blocklist);
      if (rules.size) {
        return 1;
      }

      rules = urlMatchBlockList(url, blocklist);
      if (rules.size) {
        return 2;
      }

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
    const reRegexRule = /^\/(.*)\/([a-z]*)$/;
    const rePlaceHolder = /\$([$&`']|\d+)/g;
    const fn = this.transformRule = (rule) => {
      this._transformRules.some((tRule) => {
        const match = tRule.pattern.exec(rule);
        if (match) {
          const leftContext = RegExp.leftContext;
          const rightContext = RegExp.rightContext;
          const useRegex = reRegexRule.test(tRule.replace);
          rule = tRule.replace.replace(rePlaceHolder, (_, m) => {
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
    const reRegexRule = /^\/(.*)\/([a-z]*)$/;
    const reHostEscaper = /[xX*]/g;
    const reHostUnescaper = /x[xa]/g;
    const mapHostEscaper = {"x": "xx", "X": "xX", "*": "xa"};
    const mapHostUnescaper = {xx: "x", xX: "X", xa: "*"};
    const fnHostEscaper = m => mapHostEscaper[m];
    const fnHostUnescaper = m => mapHostUnescaper[m];
    const reSchemeChecker = /^[A-Za-z][0-9A-za-z.+-]*:\/\//;
    const reWwwRemover = /^www\./;
    const reAsteriskFixer = /\*+(?=\*)/g;
    const fn = this.validateRule = (rule) => {
      if (!rule) { return ""; }

      if (reRegexRule.test(rule)) {
        // RegExp rule
        try {
          // test if the RegExp is valid
          new RegExp(RegExp.$1, RegExp.$2);
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
          // unescape "*"
          t = t.replace(reHostUnescaper, fnHostUnescaper);
          // replace "**..." with "*"
          t = t.replace(reAsteriskFixer, '');
          // remove "www."
          t = t.replace(reWwwRemover, "");
          // convert IDN to punycode
          t = punycode.toASCII(t);
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
    const reRegexRule = /^\/(.*)\/([a-z]*)$/;
    const fn = this.parseRuleLine = (ruleLine, options = {}) => {
      let [, rule, sep, comment] = (ruleLine || "").match(reSpaceMatcher);

      if (options.transform) {
        switch (options.transform) {
          case 'standard':
            if (!reRegexRule.test(rule)) {
              rule = this.transformRule(rule);
            }
            break;
          case 'url':
            if (!reRegexRule.test(rule)) {
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

  makeCachedRules(...args) {
    const reRegexRule = /^\/(.*)\/([a-z]*)$/;
    const reAdvancedRegex = new RegExp([
      // capture group 1: \n or \k<name>
      // @TODO: prevent false positive for something like \k<\b>
      '(' + '\\\\(?:[1-9]|k<[^>]+>)' + ')',
      '\\\\.',
      '\\[(?:[^\\\\\\]]*(?:\\\\.[^\\\\\\]]*)*)\\]',
      // capture group 2: (foo) or (?<name>foo)
      '(' + '\\((?:(?!\\?)|\\?<(?![!=])[^>]+>)' + ')',
    ].join('|'), 'g');
    const reMaxGroups = 16384;
    const reMaxLength = 8192 * 256;

    // An "advanced" RegExp is one that contains a backreference like \1 or
    // \k<name>, and cannot be merged.
    const isAdvancedRegex = (regexText) => {
      let rv = false;
      isAdvancedRegex.regexText = regexText.replace(reAdvancedRegex, (m, m1, m2) => {
        if (m1) {
          rv = true;
          return m;
        }
        if (m2) {
          return '(?:';
        }
        return m;
      });
      return rv;
    };

    const cacheRules = (blockList) => {
      const standardRulesDict = new Trie();
      const mapFlagRules = new Map();
      const mapAdvancedRegexRules = new Map();
      for (const [rule] of blockList.rules) {
        if (reRegexRule.test(rule)) {
          // RegExp rule
          const regexText = RegExp.$1;
          const regexFlags = [...new Set(RegExp.$2)].sort().join('');
          if (isAdvancedRegex(regexText)) {
            const regex = new RegExp(regexText, regexFlags);
            mapAdvancedRegexRules.set(regex, rule);
          } else {
            let rules = mapFlagRules.get(regexFlags);
            if (!rules) {
              rules = new Map();
              mapFlagRules.set(regexFlags, rules);
            }
            rules.set(isAdvancedRegex.regexText, rule);
          }
        } else {
          // standard rule
          let rewrittenRule = rule;
          standardRulesDict.add(rewrittenRule, rule);
        }
      }

      const regexes = [];
      let regexTexts = [];
      let len = 0;
      const mergeRegexes = (regexFlags) => {
        const regex = new RegExp(regexTexts.join('|'), regexFlags);
        regexes.push(regex);
        regexTexts = [];
        len = 0;
      };
      for (const [regexFlags, rules] of mapFlagRules) {
        for (const [regexText, rule] of rules) {
          if (regexTexts.length + 1 > reMaxGroups) {
            mergeRegexes(regexFlags);
          }

          const newLen = (len ? len + 3 : 2) + regexText.length;
          if (newLen > reMaxLength && regexTexts.length) {
            mergeRegexes(regexFlags);
          }

          regexTexts.push(regexText);
          len = newLen;
        }
        if (regexTexts.length) {
          mergeRegexes(regexFlags);
        }
      }
      for (const [regex, rule] of mapAdvancedRegexRules) {
        regexes.push(regex);
      }

      blockList.standardRulesDict = standardRulesDict;
      blockList.regexes = regexes;
    };

    const fn = this.makeCachedRules = () => {
      if (this._listUpdated) {
        this._listUpdated = false;
        cacheRules(this._blacklist);
        cacheRules(this._whitelist);
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

const TRIE_TOKEN_EOT = Symbol('EOT');
const TRIE_TOKEN_ANYCHARS = Symbol('*');
const TRIE_TOKEN_MAP = new Map([
  ['*', TRIE_TOKEN_ANYCHARS],
]);

class Trie {
  constructor() {
    this._trie = new Map();
  }

  add(key, value = key) {
    let trie = this._trie;
    for (const s of Array.from(key)) {
      const token = TRIE_TOKEN_MAP.get(s) || s;
      let next = trie.get(token);
      if (!next) {
        next = new Map();
        next.token = token;
        trie.set(token, next);
      }
      trie = next;
    }
    const token = TRIE_TOKEN_EOT;
    let next = trie.get(token);
    if (!next) {
      next = new Map();
      next.token = token;
      trie.set(token, next);
    }
    next.set(value, key);
  }

  match(str) {
    const parts = Array.from(str);
    parts.push(TRIE_TOKEN_EOT);
    return this._match(parts, this._trie, 0);
  }

  _match(parts, trie, i) {
    const queue = [[trie, i]];
    const rv = new Map();

    while (queue.length) {
      const [trie, i] = queue.pop();
      const part = parts[i];
      const subqueue = [];
      let next;

      switch (trie.token) {
        case TRIE_TOKEN_EOT: {
          for (const [k, v] of trie) {
            rv.set(k, v);
            return rv; // return first match
          }
          break;
        }
        case TRIE_TOKEN_ANYCHARS: {
          next = trie.get(part);
          if (typeof next !== 'undefined') {
            subqueue.push([next, i + 1]);
          }

          if (part !== TRIE_TOKEN_EOT) {
            subqueue.push([trie, i + 1]);
          }

          next = trie.get(TRIE_TOKEN_ANYCHARS);
          if (typeof next !== 'undefined') {
            subqueue.push([next, i]);
          }
          break;
        }
        default: {
          next = trie.get(part);
          if (typeof next !== 'undefined') {
            subqueue.push([next, i + 1]);
          }

          next = trie.get(TRIE_TOKEN_ANYCHARS);
          if (typeof next !== 'undefined') {
            subqueue.push([next, i]);
          }
          break;
        }
      }

      // add to queue using reversed order
      while (subqueue.length) {
        queue.push(subqueue.pop());
      }
    }

    return rv;
  }
}
