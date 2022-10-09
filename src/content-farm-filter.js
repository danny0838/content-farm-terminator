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
        rules: new Map(),
      };
      this._whitelist = {
        rules: new Map(),
      };
      this._transformRules = new Map();
    }

    addBlockList(blockList, listText, url) {
      for (const ruleLine of utils.getLines(listText)) {
        const rule = this.parseRuleLine(ruleLine);
        if (url) {
          rule.src = url;
        }
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

    /**
     * @param {string[]} urls - URLs with hash stripped
     */
    async getCachedWebBlackList(url, cacheDuration) {
      const data = await this.getWebListCache(url);
      if (!data) {
        return {
          text: null,
          time: null,
          uptodate: false,
        };
      }
      return {
        text: data.text,
        time: data.time,
        uptodate: Date.now() - data.time < cacheDuration,
      };
    }

    /**
     * @param {string} url - a URL with hash stripped
     */
    async fetchWebBlackList(url) {
      const time = Date.now();
      let text;
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-cache',
      });
      if (!response.ok) { throw new Error("response not ok"); }
      text = await response.text();
      await this.setWebListCache(url, {time, text});
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
        const checked = new Set();
        for (const rule of blocklist.regexRulesDict.match(url)) {
          const regex = rule.regex;
          if (checked.has(regex)) {
            continue;
          }
          checked.add(regex);
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
      const cacheRegexRule = (rule, trie) => {
        rule.regex = new RegExp(rule.pattern, rule.flags);
        for (const tokens of regex.tokenize(rule.pattern)) {
          trie.addTokens(tokens, rule);
        }
      };

      const cacheRules = (blockList) => {
        const standardRulesDict = new Trie();
        const regexRulesDict = new Trie();
        for (const [, rule] of blockList.rules) {
          if (rule.type === 'regex') {
            cacheRegexRule(rule, regexRulesDict);
          } else if (rule.type === 'domain') {
            standardRulesDict.add(rule.domain, rule);
          } else if (rule.type === 'ipv4') {
            standardRulesDict.add(Trie.escape(rule.rule), rule);
          } else if (rule.type === 'ipv6') {
            standardRulesDict.add(Trie.escape(rule.rule), rule);
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

    webListCacheKey(url) {
      return `cache/blocklist/text/${url}`;
    }

    async getWebListCache(url) {
      const key = this.webListCacheKey(url);
      return (await browser.storage.local.get(key))[key];
    }

    /**
     * @param {string} url
     * @param {Object} data
     * @param {number} data.time
     * @param {string} data.text
     */
    async setWebListCache(url, data) {
      const key = this.webListCacheKey(url);
      await browser.storage.local.set({[key]: data});
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
  const TRIE_TOKEN_BRACKET_OPEN = Symbol('[');
  const TRIE_TOKEN_BRACKET_CLOSE = Symbol(']');
  const TRIE_TOKEN_MAP = new Map([
    ['?', TRIE_TOKEN_ANYCHAR],
    ['*', TRIE_TOKEN_ANYCHARS],
    ['[', TRIE_TOKEN_BRACKET_OPEN],
    [']', TRIE_TOKEN_BRACKET_CLOSE],
  ]);
  const TRIE_PATTERN_ESCAPER = /[*?[]/g;

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
      const tokens = this._expandWildcards(Array.from(pattern));
      this.addTokens(tokens, value);
    }

    /**
     * Add a pattern (in the form of an array of tokens) for matching.
     *
     * @param {(string|Symbol|Array.<(string|Symbol)>)} tokens - The pattern for matching.
     * @param {*} [value] - The value when the pattern is matched.
     */
    addTokens(tokens, value) {
      const queue = [[this._trie, 0]];
      while (queue.length) {
        const [trie, i] = queue.pop();
        const subqueue = [];
        const token = tokens[i];

        if (!token) {
          const token = TRIE_TOKEN_EOT;
          let next = trie.get(token);
          if (!next) {
            next = new Map();
            next.token = token;
            trie.set(token, next);
          }
          next.set(value, true);
          continue;
        }

        for (const t of Array.isArray(token) ? token : [token]) {
          let next = trie.get(t);
          if (!next) {
            next = new Map();
            next.token = t;
            trie.set(t, next);
          }
          subqueue.push([next, i + 1]);
        }

        // add to queue using reversed order
        while (subqueue.length) {
          queue.push(subqueue.pop());
        }
      }
    }

    _expandWildcards(parts) {
      const tokens = [];
      const escaped = [];
      let escaping = false;
      for (const part of parts) {
        const token = TRIE_TOKEN_MAP.get(part) || part;

        if (escaping) {
          if (token === TRIE_TOKEN_BRACKET_CLOSE) {
            escaping = false;
            if (escaped.length) {
              tokens.push(escaped.slice());
              escaped.length = 0;
            } else {
              tokens.push('[');
              tokens.push(']');
            }
            continue;
          }

          escaped.push(part);
          continue;
        }

        if (token === TRIE_TOKEN_BRACKET_OPEN) {
          escaping = true;
          continue;
        }

        if (token === TRIE_TOKEN_BRACKET_CLOSE) {
          tokens.push(']');
          continue;
        }

        tokens.push(token);
      }

      if (escaping) {
        tokens.push('[');
        for (const part of escaped) {
          tokens.push(part);
        }
      }

      return tokens;
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

    /**
     * Escape a string to be safe in a pattern.
     *
     * @param {string} str - The string to escape.
     * @returns {string} The escaped string.
     */
    static escape(str) {
      return str.replace(TRIE_PATTERN_ESCAPER, '[$&]');
    }
  }

  const REGEX_TOKEN_SOT = Symbol('^');
  const REGEX_TOKEN_EOT = Symbol('$');
  const REGEX_RE_STR_FIXER = /(\\[\s\S])|-/g;
  const REGEX_RE_STR_FIXER_FUNC = (m, e) => (e || `\\${m}`);

  class regex {
    static *tokenize(reStr) {
      try {
        // Depends on:
        // https://github.com/foo123/RegexAnalyzer
        const regexAnalyzer = Regex.Analyzer;

        // fix error for analyzer for [x-]
        reStr = reStr.replace(REGEX_RE_STR_FIXER, REGEX_RE_STR_FIXER_FUNC);

        const node = regexAnalyzer(reStr, false).tree();
        const tokens = this._tokenizeNode(node);
        yield* this._expandTokenSeq(tokens);
      } catch(ex) {
        // Certain regex cannot be parsed by the analyzer,
        // such as /\u{20000}/. Use wildcard instead.
        yield [TRIE_TOKEN_ANYCHARS];
      }
    }

    /**
     * @param {RegexNode} node
     * @returns {string|Symbol|Object}
     */
    static _tokenizeNode(node) {
      switch (node.type) {
        case 1: /* T_SEQUENCE, 'Sequence' */ {
          let seq = [];
          for (let i = 0, I = node.val.length; i < I; i++) {
            seq = seq.concat(this._tokenizeNode(node.val[i]));
          }
          return seq;
        }
        case 2: /* T_ALTERNATION, 'Alternation' */ {
          return [{alt: node.val.map(node => this._tokenizeNode(node))}];
        }
        case 4: /* T_GROUP, 'Group' */ {
          for (const flag of ['LookAhead', 'LookBehind', 'NegativeLookAhead', 'NegativeLookBehind']) {
            if (node.flags[flag]) { return []; }
          }
          return this._tokenizeNode(node.val);
        }
        case 8: /* T_CHARGROUP, 'CharacterGroup' */ {
          return [TRIE_TOKEN_ANYCHAR];
        }
        case 16: /* T_QUANTIFIER, 'Quantifier' */ {
          let seq = [], tokens;
          for (let i = 0, I = node.flags.min; i < I; i++) {
            tokens = tokens || this._tokenizeNode(node.val);
            seq = seq.concat(tokens);
          }
          if (node.flags.min !== node.flags.max) {
            seq = seq.concat([TRIE_TOKEN_ANYCHARS]);
          }
          return seq;
        }
        case 32: /* T_UNICODECHAR, 'UnicodeChar' */ {
          return [node.flags.Char];
        }
        case 64: /* T_HEXCHAR, 'HexChar' */ {
          return [node.flags.Char];
        }
        case 128: /* T_SPECIAL, 'Special' */ {
          if (node.flags.MatchStart) {
            return [REGEX_TOKEN_SOT];
          }
          if (node.flags.MatchEnd) {
            return [REGEX_TOKEN_EOT];
          }
          return [];
        }
        case 256: /* T_CHARS, 'Characters' */ {
          return [];
        }
        case 512: /* T_CHARRANGE, 'CharacterRange' */ {
          return [];
        }
        case 1024: /* T_STRING, 'String' */ {
          return Array.from(node.val);
        }
        case 2048: /* T_COMMENT, 'Comment' */ {
          return [];
        }
      }
      return [];
    }

    /**
     * @param {Array.<string|Symbol|Object>} seq
     * @yields {string|Symbol}
     */
    static *_expandTokenSeq(seq) {
      const queue = [[seq, 0]];
      while (queue.length) {
        const [seq, i] = queue.pop();
        const part = seq[i];

        // seq finished, tidy and yield it
        if (typeof part === 'undefined') {
          let newseq = seq;

          handleSOT: {
            const i = newseq.lastIndexOf(REGEX_TOKEN_SOT);
            if (i !== -1) {
              newseq = newseq.slice(i + 1);
            } else {
              newseq.unshift(TRIE_TOKEN_ANYCHARS);
            }
          }

          handleEOT: {
            const i = newseq.indexOf(REGEX_TOKEN_EOT);
            if (i !== -1) {
              newseq = newseq.slice(0, i);
            } else {
              newseq.push(TRIE_TOKEN_ANYCHARS);
            }
          }

          let fixedseq = [];
          for (const part of newseq) {
            // prevent consecutive **, ***, ...
            if (part === TRIE_TOKEN_ANYCHARS
                && fixedseq[fixedseq.length - 1] === TRIE_TOKEN_ANYCHARS) {
              continue;
            }

            // prevent consecutive *?*, *??*, ...
            if (part === TRIE_TOKEN_ANYCHARS
                && fixedseq[fixedseq.length - 1] === TRIE_TOKEN_ANYCHAR) {
              let i = fixedseq.length - 2;
              while (fixedseq[i] === TRIE_TOKEN_ANYCHAR) { i--; }
              if (fixedseq[i] === TRIE_TOKEN_ANYCHARS) {
                continue;
              }
            }
            fixedseq.push(part);
          }

          yield fixedseq;
          continue;
        }

        const subqueue = [];
        if (part.alt) {
          for (const subseq of part.alt) {
            const newseq = seq.slice(0, i).concat(subseq).concat(seq.slice(i + 1));
            subqueue.push([newseq, i]);
          }
        } else {
          subqueue.push([seq, i + 1]);
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
