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
    const reAsteriskReplacer = /\\\*/g;
    const fn = this.addTransformRules = (rulesText) => {
      utils.getLines(rulesText).forEach((ruleLine) => {
        let {pattern, replace} = this.parseTransformRuleLine(ruleLine);

        if (pattern && replace) {
          if (pattern.startsWith('/') && pattern.endsWith('/')) {
            // RegExp rule
            pattern = new RegExp(pattern.slice(1, -1));
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
      this.makeCachedRules();

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
    const rePlaceHolder = /\$([$&`']|\d+)/g;
    const fn = this.transformRule = (rule) => {
      this._transformRules.some((tRule) => {
        const match = tRule.pattern.exec(rule);
        if (match) {
          const leftContext = RegExp.leftContext;
          const rightContext = RegExp.rightContext;
          const useRegex = tRule.replace.startsWith('/') && tRule.replace.endsWith('/');
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

  makeCachedRules(...args) {
    const reReplacer = /\\\*/g;
    const cacheRules = (blockList) => {
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
