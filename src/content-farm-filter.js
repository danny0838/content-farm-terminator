(function (root, factory) {
  // Browser globals
  root.ContentFarmFilter = factory(
    root.console,
  );
}(this, function (console) {

  'use strict';

  class ContentFarmFilter {
    constructor() {
      this._listUpdated = true;
      this._blacklist = {
        sources: [],
        rawRules: [],
        rules: new Map(),
      };
      this._whitelist = {
        sources: [],
        rawRules: [],
        rules: new Map(),
      };
      this._transformRules = [];
    }

    addBlockList(blockList, listText, url) {
      if (url) {
        blockList.sources.push(url);
      }
      utils.getLines(listText).forEach((ruleLine) => {
        const rule = this.parseRuleLine(ruleLine);
        if (url) {
          rule.src = url;
        }
        blockList.rawRules.push(rule);
        if (rule.rule && !blockList.rules.has(rule.rule)) {
          blockList.rules.set(rule.rule, rule);
        }
      });
      this._listUpdated = true;
    }

    addBlackList(listText, url) {
      this.addBlockList(this._blacklist, listText, url);
    }

    addWhiteList(listText, url) {
      this.addBlockList(this._whitelist, listText, url);
    }

    async addWebBlackLists(urlsText, cacheDuration) {
      const urls = this.urlsTextToLines(urlsText);
      const tasks = urls.map(u => {
        return this.getBlackListFromUrl(u, {cacheDuration}).catch(ex => {
          console.error(ex);
        });
      });
      const texts = await Promise.all(tasks);
      for (let i = 0, I = urls.length; i < I; i++) {
        const url = urls[i];
        const text = texts[i];
        this.addBlackList(this.validateRulesText(text, {validate: 'strict'}), url);
      }
    }

    /**
     * @param {string} url - a URL with hash stripped
     */
    async getBlackListFromUrl(url, {cacheDuration = 0, cacheOnly = false, doNotCache = false} = {}) {
      const data = await this.getWebListCache(url);
      const time = Date.now();

      // retrieve rules from cache
      let cacheRulesText, cacheTime;
      if (data) {
        ({time: cacheTime, rulesText: cacheRulesText} = data);
        // use cached version if not expired or cacheOnly
        if (time - cacheTime < cacheDuration || cacheOnly) {
          return cacheRulesText;
        }
      }

      // return anyway if cacheOnly
      if (cacheOnly) {
        return cacheRulesText;
      }

      // retrieve rules from web if no cache or cache has expired
      let text;
      try {
        const response = await fetch(url, {
          credentials: 'include',
          cache: 'no-cache',
        });
        if (!response.ok) { throw new Error("response not ok"); }
        text = await response.text();
      } catch (ex) {
        console.error(`Unable to get blocklist from: '${url}'`);

        // fallback to cached version if web version not accessible
        return cacheRulesText;
      }

      // store retrieved rules to cache
      if (!doNotCache) {
        await this.setWebListCache(url, time, text).catch(() => {});
      }
      return text;
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
     * @typedef {Object} Source
     * @property {string} url - source URL
     * @property {string} [urlRedirected] - redirected URL (or hostname only)
     */

    /**
     * @typedef {Object} Blocker
     * @property {Source} source
     * @property {?Rule} rule
     * @property {number} type - type of the block
     *      0: not blocked; 1: blocked by standard rule; 2: blocked by regex rule
     */

    /**
     * @param {Source} source
     * @returns {Blocker}
     */
    getBlocker(...args) {
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

        let domain = hostname;
        let pos;
        while (true) {
          const rule = blocklist.standardRulesDict.match(domain);
          if (rule) {
            return rule;
          }
          pos = domain.indexOf('.');
          if (pos === -1) { break; }
          domain = domain.slice(pos + 1);
        }
        return null;
      };

      const urlMatchBlockList = (url, blocklist) => {
        for (const [regex, rule] of blocklist.regexRulesDict) {
          regex.lastIndex = 0;
          if (regex.test(url)) {
            return rule;  // return first match
          }
        }
        return null;
      };

      const checkUrlOrHostname = (urlOrHostname) => {
        const result = {
          rule: null,
          type: 0,
        };

        let urlObj;
        try {
          urlObj = new URL((reSchemeChecker.test(urlOrHostname) ? '' : 'http://') + urlOrHostname);
        } catch (ex) {
          // bad URL
          return result;
        }

        // URL.hostname is not punycoded in some old browsers (e.g. Firefox 52)
        const h = punycode.toASCII(urlObj.hostname);

        let rule;

        // check whitelist
        rule = hostnameMatchBlockList(h, this._whitelist);
        if (rule) {
          result.rule = rule;
          return result;
        }

        const url = utils.getNormalizedUrl(urlObj);

        rule = urlMatchBlockList(url, this._whitelist);
        if (rule) {
          result.rule = rule;
          return result;
        }

        // check blacklist
        rule = hostnameMatchBlockList(h, this._blacklist);
        if (rule) {
          result.rule = rule;
          result.type = 1;
          return result;
        }

        rule = urlMatchBlockList(url, this._blacklist);
        if (rule) {
          result.rule = rule;
          result.type = 2;
          return result;
        }

        return result;
      };

      const fn = this.getBlocker = (source) => {
        const blocker = {
          source,
          rule: null,
          type: 0,
        };

        this.makeCachedRules();

        const {url: urlOrHostname, urlRedirected} = source;
        if (urlOrHostname) {
          let check = checkUrlOrHostname(urlOrHostname);

          // check redirected URL if source URL is not blocked
          if (!check.type && urlRedirected) {
            check = checkUrlOrHostname(urlRedirected);
          }

          Object.assign(blocker, check);
        }
        return blocker;
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
      const reSchemeChecker = /^[A-Za-z][0-9A-za-z.+-]*:/;
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
            // force using http to make sure hostname work
            t = new URL(t);
            t.protocol = 'https:';
            t = t.hostname;
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

    validateRulesText(rulesText, {validate = 'standard', transform, asString = true} = {}) {
      const parseOptions = {validate, transform, asString};
      return utils
        .getLines(rulesText)
        .map(ruleLine => this.parseRuleLine(ruleLine, parseOptions))
        .join("\n");
    }

    validateTransformRulesText(rulesText, {validate = 'standard', asString = true} = {}) {
      const parseOptions = {validate, asString};
      return utils
        .getLines(rulesText)
        .map(ruleLine => this.parseTransformRuleLine(ruleLine, parseOptions))
        .join("\n");
    }

    /**
     * @typedef {Object} Rule
     * @property {string} rule
     * @property {string} sep
     * @property {string} comment
     * @property {string} [src] - Source URL of the rule.
     */

    /**
     * @param {Object} options
     * @param {string} options.validate
     * @param {string} options.transform
     * @param {boolean} options.asString
     * @returns {(Rule|string)}
     */
    parseRuleLine(...args) {
      const reSpaceMatcher = /^(\S*)(\s*)(.*)$/;
      const reSchemeChecker = /^[A-Za-z][0-9A-za-z.+-]*:/;
      const reRegexRule = /^\/(.*)\/([a-z]*)$/;
      const fn = this.parseRuleLine = (ruleLine, options = {}) => {
        let [, rule, sep, comment] = (ruleLine || "").match(reSpaceMatcher);

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

        switch (options.validate) {
          case 'standard':
            rule = this.validateRule(rule);
            break;
          case 'strict':
            const rule0 = rule;
            rule = this.validateRule(rule);
            if (rule !== rule0) { rule = ''; }
            break;
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
     * @param {string} options.validate
     * @param {boolean} options.asString
     */
    parseTransformRuleLine(...args) {
      const reSpaceMatcher = /^(\S*)(\s*)(\S*)(\s*)(.*)$/;
      const fn = this.parseTransformRuleLine = (ruleLine, options = {}) => {
        let [, pattern, sep, replace, sep2, comment] = (ruleLine || "").match(reSpaceMatcher);

        switch (options.validate) {
          case 'standard':
            pattern = this.validateRule(pattern);
            break;
          case 'strict':
            const pattern0 = pattern;
            pattern = this.validateRule(pattern);
            if (pattern !== pattern0) { pattern = ''; }
            break;
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

      const cacheRules = (blockList) => {
        const standardRulesDict = new Trie();
        const regexRulesDict = new Map();
        for (const [, rule] of blockList.rules) {
          if (reRegexRule.test(rule.rule)) {
            // RegExp rule
            regexRulesDict.set(new RegExp(RegExp.$1, RegExp.$2), rule);
          } else {
            // standard rule
            let rewrittenRule = rule.rule;
            standardRulesDict.add(rewrittenRule, rule);
          }
        }
        blockList.standardRulesDict = standardRulesDict;
        blockList.regexRulesDict = regexRulesDict;
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

    getWebBlacklists() {
      return this._blacklist.sources;
    }

    getMergedBlacklist() {
      return this._blacklist.rawRules.reduce((rv, rule) => {
        if (rule.rule) {
          rv.push([rule.rule, rule.sep, rule.comment].join(''));
        }
        return rv;
      }, []).join('\n');
    }

    webListCacheKey(url) {
      return JSON.stringify({webBlocklistCache: url});
    }

    async getWebListCache(url) {
      const key = this.webListCacheKey(url);
      return (await browser.storage.local.get(key))[key];
    }

    async setWebListCache(url, time, rulesText) {
      const key = this.webListCacheKey(url);
      await browser.storage.local.set({[key]: {time, rulesText}});
    }

    async clearStaleWebListCache(webListChange) {
      const {newValue, oldValue} = webListChange;
      const urlSet = new Set(this.urlsTextToLines(newValue));
      const deletedUrls = this.urlsTextToLines(oldValue).filter(u => !urlSet.has(u));
      await browser.storage.local.remove(deletedUrls.map(this.webListCacheKey));
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
      next.set(value, true);
    }

    match(str) {
      const parts = Array.from(str);
      parts.push(TRIE_TOKEN_EOT);
      const queue = [[this._trie, 0]];
      while (queue.length) {
        const [trie, i] = queue.pop();
        const part = parts[i];
        const subqueue = [];
        let next;

        switch (trie.token) {
          case TRIE_TOKEN_EOT: {
            for (const [rule, _] of trie) {
              return rule; // return first match
            }
            break;
          }
          default: {
            if (next = trie.get(part)) {
              subqueue.push([next, i + 1]);
            }

            if (trie.token === TRIE_TOKEN_ANYCHARS) {
              if (part !== TRIE_TOKEN_EOT) {
                subqueue.push([trie, i + 1]);
              }
            }

            if (next = trie.get(TRIE_TOKEN_ANYCHARS)) {
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

      return null;
    }
  }

  return ContentFarmFilter;

}));
