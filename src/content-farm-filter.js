(function (root, factory) {
  // Browser globals
  root.ContentFarmFilter = factory(
    root.console,
  );
}(this, function (console) {

  'use strict';

  const RE_RULE = (() => {
    const r = String.raw;
    const pattern = r`([^\\\s]*(?:\\[^\s][^\\\s]*)*)`;  // 3: pattern; exclude spaces
    const flags = r`([a-z]*)`;  // 4: flags
    const regex = r`(/${pattern}/${flags})`;  // 2: regex
    const ipv6 = r`\[([0-9A-Fa-f:]+)\]`;  // 5: ipv6; lazy matching
    const ipv4 = r`(\d{1,3}(?:\.\d{1,3}){0,3})`;  // 6: ipv4; lazy matching
    const label = r`(?:[0-9A-Za-z*](?:[-0-9A-Za-z*]*[0-9A-Za-z*])?)`;
    const domain = r`(${label}(?:\.${label})*)`;  // 7: domain
    const invalid = r`(\S*)`;  // 8: invalid
    const rule = r`(${regex}|${ipv6}|${ipv4}|${domain}|${invalid})`;  // 1: rule
    const comment = r`(\s+)(.*)`;  // 9: sep, 10: comment
    const re = r`^${rule}(?:${comment})?$`;
    return new RegExp(re);
  })();
  const RE_HOST_ESCAPER = /[xX*]/g;
  const MAP_HOST_ESCAPER = {"x": "xx", "X": "xX", "*": "xa"};
  const FN_HOST_ESCAPER = m => MAP_HOST_ESCAPER[m];
  const RE_HOST_UNESCAPER = /x[xa]/g;
  const MAP_HOST_UNESCAPER = {xx: "x", xX: "X", xa: "*"};
  const FN_HOST_UNESCAPER = m => MAP_HOST_UNESCAPER[m];
  const RE_SCHEME = /^([A-Za-z][0-9A-za-z.+-]*):/;
  const RE_ASTERISK_FIXER = /\*+(?=\*)/g;
  const RE_IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

  const RE_TRANSFORM_RULE = (() => {
    const r = String.raw;
    const pattern = r`([^\\\s]*(?:\\[^\s][^\\\s]*)*)`;  // 3: pattern; exclude spaces
    const flags = r`([a-z]*)`;  // 4: flags
    const regex = r`(/${pattern}/${flags})`;  // 2: regex
    const text = r`(\S*)`;  // 5: text
    const rule = r`(${regex}|${text})`;  // 1: rule
    const replacement = r`(\s+)(\S*)`;  // 6: sep, 7: replacement
    const comment = r`(\s+)(.*)`;  // 8: sep2, 9: comment
    const re = r`^${rule}(?:${replacement})?(?:${comment})?$`;
    return new RegExp(re);
  })();
  const RE_REGEX_RULE = /^\/(.*)\/([a-z]*)$/;
  const RE_TRANSFORM_PLACEHOLDER = /\$([$&`']|\d+)/g;

  class Rule {
    constructor(text) {
      this.raw = '';
      this.rule = '';
      this.sep = '';
      this.comment = '';
      this.type = null;
      this.error = null;
      this.set(text);
    }

    /**
     * Don't validate the input here, for performance e.g. when loading from
     * the cache. Should run validate additionally when loading from a user
     * input.
     */
    set(text, {ruleOnly = false, error = null} = {}) {
      this.raw = text;
      this.type = null;
      this.error = error;

      const m = RE_RULE.exec(text);
      if (m[2]) {
        this.type = 'regex';
        this.pattern = m[3];
        this.flags = m[4];
      } else if (m[5]) {
        this.type = 'ipv6';
        this.ip = m[5];
      } else if (m[6]) {
        this.type = 'ipv4';
        this.ip = m[6];
      } else if (m[7]) {
        this.type = 'domain';
        this.domain = m[7];
      }
      this.rule = m[1];
      if (!ruleOnly) {
        this.sep = m[9] || '';
        this.comment = m[10] || '';
      }
      return this;
    }

    /**
     * Canonicalize the representation.
     *
     * @param {boolean} [strict=false] - True to empty an unknown rule, false
     *     to attempt to fix it.
     */
    validate(strict = false) {
      const ruleOld = this.rule;
      switch (this.type) {
        case 'regex': {
          try {
            new RegExp(this.pattern, this.flags);
          } catch (ex) {
            this.set('', {ruleOnly: true, error: ex});
          }
          break;
        }
        case 'ipv4': {
          try {
            let hn = new URL(`http://${this.rule}`).hostname;
            if (!hn.split('.').every(x => (x = parseInt(x, 10), 0 <= x && x <= 255))) {
              throw new SyntaxError(`All parts must be 0–255 for IPv4.`);
            }
            if (hn !== ruleOld) {
              this.set(hn, {ruleOnly: true});
            }
          } catch (ex) {
            this.set('', {ruleOnly: true, error: new SyntaxError(`Invalid IPv4: ${ruleOld}`)});
          }
          break;
        }
        case 'ipv6': {
          try {
            let hn = new URL(`http://${this.rule}`).hostname;
            if (hn !== ruleOld) {
              this.set(hn, {ruleOnly: true});
            }
          } catch (ex) {
            this.set('', {ruleOnly: true, error: new SyntaxError(`Invalid IPv6: ${ruleOld}`)});
          }
          break;
        }
        case 'domain':
        default: {
          let t = this.rule;
          if (!t) { break; }
          try {
            // escape "*" to make a valid URL
            t = t.replace(RE_HOST_ESCAPER, FN_HOST_ESCAPER);
            // add a scheme if none to make a valid URL
            if (!RE_SCHEME.test(t)) { t = "http://" + t; }
            // get hostname
            // force using http to make sure hostname work
            t = new URL(t);
            t.protocol = 'http:';
            t = t.hostname;
            // unescape "*"
            t = t.replace(RE_HOST_UNESCAPER, FN_HOST_UNESCAPER);
            // replace "**..." with "*"
            t = t.replace(RE_ASTERISK_FIXER, '');
            // remove "www."
            if (t.startsWith('www.')) {
              t = t.slice(4);
            }
            // convert IDN to punycode
            t = punycode.toASCII(t);
          } catch (ex) {
            this.set('', {ruleOnly: true, error: ex});
            break;
          }
          if (t !== ruleOld) {
            if (this.type === 'domain' || !strict) {
              this.set(t, {ruleOnly: true});
            } else {
              this.set('', {ruleOnly: true});
            }
          }
          break;
        }
      }
      return this;
    }

    toString() {
      return `${this.rule}${this.sep}${this.comment}`;
    }
  }

  class TransformRule {
    constructor(text) {
      this.raw = '';
      this.rule = '';
      this.sep = '';
      this.replacement = '';
      this.sep2 = '';
      this.comment = '';
      this.type = null;
      this.error = null;
      this.set(text, {ruleOnly:false});
    }

    set(text, {ruleOnly = true, error = null} = {}) {
      this.raw = text;
      this.type = null;
      this.error = error;

      const m = RE_TRANSFORM_RULE.exec(text);
      if (m[2]) {
        this.type = 'regex';
        this.pattern = m[3];
        this.flags = m[4];
      } else if (m[5]) {
        this.type = 'plain';
      }
      this.rule = m[1];
      if (!ruleOnly) {
        this.sep = m[6] || '';
        this.replacement = m[7] || '';
        this.sep2 = m[8] || '';
        this.comment = m[9] || '';
      }
      return this;
    }

    validate(strict = false) {
      const ruleOld = this.rule;
      switch (this.type) {
        case 'regex': {
          try {
            new RegExp(this.pattern, this.flags);
          } catch (ex) {
            this.set('', {ruleOnly: true, error: ex});
          }
          break;
        }
        case 'plain': {
          // nothing to validate
          break;
        }
      }
      return this;
    }

    toString() {
      return `${this.rule}${this.sep}${this.replacement}${this.sep2}${this.comment}`;
    }
  }

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
      this._transformRules = new Map();
    }

    addBlockList(blockList, listText, url) {
      if (url) {
        blockList.sources.push(url);
      }
      for (const ruleLine of utils.getLines(listText)) {
        const rule = this.parseRuleLine(ruleLine);
        if (url) {
          rule.src = url;
        }
        blockList.rawRules.push(rule);
        if (rule.type !== null && !blockList.rules.has(rule.rule)) {
          blockList.rules.set(rule.rule, rule);
        }
      }
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
        const rulesText = utils.getLines(text)
          .map(rule => this.parseRuleLine(rule).validate(true).toString())
          .join('\n');
        this.addBlackList(rulesText, url);
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

    addTransformRules(rulesText) {
      for (const ruleLine of utils.getLines(rulesText)) {
        const rule = this.parseTransformRuleLine(ruleLine);
        if (!(rule.rule && rule.replacement)) { continue; }

        let regex;
        if (rule.type === 'regex') {
          regex = new RegExp(rule.pattern, rule.flags);
        } else {
          regex = new RegExp(utils.escapeRegExp(rule.rule).replace(RE_ASTERISK_FIXER, "[^:/?#]*"));
        }

        if (!this._transformRules.has(rule.rule)) {
          this._transformRules.set(rule.rule, {rule, regex});
        }
      }
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
      const hostnameMatchBlockList = (hostname, blocklist) => {
        if ((hostname.startsWith('[') && hostname.endsWith(']')) || RE_IPV4.test(hostname)) {
          // IP hostname
          for (const rule of blocklist.standardRulesDict.match(hostname)) {
            return rule;
          }
          return null;
        }

        // domain name hostname
        if (hostname.startsWith('www.')) {
          hostname = hostname.slice(4);
        }

        let domain = hostname;
        let pos;
        while (true) {
          for (const rule of blocklist.standardRulesDict.match(domain)) {
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
          urlObj = new URL((RE_SCHEME.test(urlOrHostname) ? '' : 'http://') + urlOrHostname);
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

    parseRuleLine(ruleLine) {
      return new Rule(ruleLine);
    }

    parseTransformRuleLine(ruleLine) {
      return new TransformRule(ruleLine);
    }

    /**
     * Transform the rule.
     * @param {Rule} rule - the rule to transform
     * @param {string} mode - the way to transform
     *     - "standard": transform only if not regex.
     *     - "url": transform only if source is a URL.
     *     - *: transform anyway.
     */
    transform(rule, mode = 'standard') {
      switch (mode) {
        case 'standard': {
          if (rule.type !== 'regex') {
            this._transform(rule);
          }
          break;
        }
        case 'url': {
          if (rule.type === null && RE_SCHEME.test(rule.rule)) {
            this._transform(rule);
          }
          break;
        }
        default: {
          this._transform(rule);
          break;
        }
      }
      return rule;
    }

    _transform(rule) {
      if (!rule.rule) {
        return;
      }
      for (const [, tRule] of this._transformRules) {
        tRule.regex.lastIndex = 0;
        const match = tRule.regex.exec(rule.rule);
        if (!match) { continue; }
        const leftContext = RegExp.leftContext;
        const rightContext = RegExp.rightContext;
        const useRegex = RE_REGEX_RULE.test(tRule.rule.replacement);
        const ruleText = tRule.rule.replacement.replace(RE_TRANSFORM_PLACEHOLDER, (_, m) => {
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
        rule.set(ruleText);
        return true;
      }
      return false;
    }

    makeCachedRules(...args) {
      const cacheRules = (blockList) => {
        const standardRulesDict = new Trie();
        const regexRulesDict = new Map();
        for (const [, rule] of blockList.rules) {
          if (rule.type === 'regex') {
            // RegExp rule
            regexRulesDict.set(new RegExp(rule.pattern, rule.flags), rule);
          } else {
            // domain, ipv4, ipv6 rule
            standardRulesDict.add(rule.rule, rule);
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
  const TRIE_TOKEN_ANYCHAR = Symbol('?');
  const TRIE_TOKEN_ANYCHARS = Symbol('*');
  const TRIE_TOKEN_MAP = new Map([
    ['?', TRIE_TOKEN_ANYCHAR],
    ['*', TRIE_TOKEN_ANYCHARS],
  ]);

  /**
   * Prefix trie that supports wildcards.
   */
  class Trie {
    constructor() {
      this._trie = new Map();
    }

    /**
     * Add a pattern for matching.
     *
     * @param {string} pattern - The pattern for matching which works like a
     *      dictionary key. Replace any "**" with "*" as it may cause
     *      duplicated matches a performance issue.
     * @param {*} [value=pattern] - The value when the pattern is matched.
     */
    add(pattern, value = pattern) {
      let trie = this._trie;
      for (const part of Array.from(pattern)) {
        const token = TRIE_TOKEN_MAP.get(part) || part;
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

    /**
     * Match a string against the provided patterns.
     *
     * @param {string} str - The string for matching.
     * @yields {*} The value of each matched pattern.
     */
    *match(str) {
      const parts = Array.from(str);
      const queue = [[this._trie, 0]];
      while (queue.length) {
        const [trie, i] = queue.pop();
        const part = parts[i];
        const subqueue = [];
        let next;

        if (i < parts.length) {
          if (next = trie.get(part)) {
            subqueue.push([next, i + 1]);
          }

          if (next = trie.get(TRIE_TOKEN_ANYCHAR)) {
            subqueue.push([next, i + 1]);
          }

          if (trie.token === TRIE_TOKEN_ANYCHARS) {
            subqueue.push([trie, i + 1]);
          }

          if (next = trie.get(TRIE_TOKEN_ANYCHARS)) {
            // this should not happen when trie.token === TRIE_TOKEN_ANYCHARS
            subqueue.push([next, i]);
          }
        } else {
          // yield values if ending trie matches
          if (next = trie.get(TRIE_TOKEN_EOT)) {
            for (const [value, _] of next) {
              yield value;
            }
          }

          // check "*" as it could take no length
          if (next = trie.get(TRIE_TOKEN_ANYCHARS)) {
            subqueue.push([next, i]);
          }
        }

        // add to queue using reversed order
        while (subqueue.length) {
          queue.push(subqueue.pop());
        }
      }
    }
  }

  return ContentFarmFilter;

}));
