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

  const RULE_TYPE_NONE        = 0;
  const RULE_TYPE_DOMAIN      = 1;
  const RULE_TYPE_IPV4        = 2;
  const RULE_TYPE_IPV6        = 3;
  const RULE_TYPE_PATTERN     = 4;
  const RULE_TYPE_REGEX       = 5;

  const TRULE_TYPE_NONE       = 0;
  const TRULE_TYPE_PLAIN      = 1;
  const TRULE_TYPE_REGEX      = 2;

  const RULE_ACTION_BLOCK     = 0 << 4;
  const RULE_ACTION_UNBLOCK   = 1 << 4;
  const RULE_ACTION_NOOP      = 2 << 4;

  class Rule {
    constructor(text, {action = RULE_ACTION_BLOCK, src = null} = {}) {
      this.raw = '';
      this.rule = '';
      this.sep = '';
      this.comment = '';
      this.type = null;
      this.action = action;
      this.src = src;
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
      this.type = RULE_TYPE_NONE;
      this.error = error;

      const m = RE_RULE.exec(text);
      if (m[2]) {
        this.type = RULE_TYPE_REGEX;
        this.pattern = m[3];
        this.flags = m[4];
      } else if (m[5]) {
        this.type = RULE_TYPE_IPV6;
        this.ip = m[5];
      } else if (m[6]) {
        this.type = RULE_TYPE_IPV4;
        this.ip = m[6];
      } else if (m[7]) {
        if (m[7].includes('*')) {
          this.type = RULE_TYPE_PATTERN;
          this.pattern = m[7];
        } else {
          this.type = RULE_TYPE_DOMAIN;
          this.domain = m[7];
        }
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
        case RULE_TYPE_REGEX: {
          try {
            new RegExp(this.pattern, this.flags);
          } catch (ex) {
            this.set('', {ruleOnly: true, error: ex});
          }
          break;
        }
        case RULE_TYPE_IPV4: {
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
        case RULE_TYPE_IPV6: {
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
        case RULE_TYPE_DOMAIN:
        case RULE_TYPE_PATTERN:
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
            // normalize
            t = utils.getNormalizedHostname(t);
          } catch (ex) {
            this.set('', {ruleOnly: true, error: ex});
            break;
          }
          if (t !== ruleOld) {
            if ([RULE_TYPE_DOMAIN, RULE_TYPE_PATTERN].includes(this.type) || !strict) {
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

    get token() {
      const prefix = this.action === RULE_ACTION_UNBLOCK ? '@@' : '';
      return `${prefix}${this.rule}`;
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
      this.type = TRULE_TYPE_NONE;
      this.error = error;

      const m = RE_TRANSFORM_RULE.exec(text);
      if (m[2]) {
        this.type = TRULE_TYPE_REGEX;
        this.pattern = m[3];
        this.flags = m[4];
      } else if (m[5]) {
        this.type = TRULE_TYPE_PLAIN;
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
        case TRULE_TYPE_REGEX: {
          try {
            new RegExp(this.pattern, this.flags);
          } catch (ex) {
            this.set('', {ruleOnly: true, error: ex});
          }
          break;
        }
        case TRULE_TYPE_PLAIN: {
          // nothing to validate
          break;
        }
      }
      return this;
    }

    toString() {
      return `${this.rule}${this.sep}${this.replacement}${this.sep2}${this.comment}`;
    }

    get token() {
      return this.rule;
    }
  }

  // Borrowed from uBlock Orign.
  const MAX_TOKEN_LENGTH = 7;

  const       DOT_TOKEN_HASH = 0x10000000;
  const       ANY_TOKEN_HASH = 0x20000000;
  const ANY_HTTPS_TOKEN_HASH = 0x30000000;
  const  ANY_HTTP_TOKEN_HASH = 0x40000000;
  const        NO_TOKEN_HASH = 0x50000000;
  const     EMPTY_TOKEN_HASH = 0xF0000000;
  const   INVALID_TOKEN_HASH = 0xFFFFFFFF;

  const TOKEN_REGEX = /[%0-9A-Za-z]+/g;
  const TOKEN_VALID_CHARS = (() => {
    const chars = '0123456789%abcdefghijklmnopqrstuvwxyz';
    const vtc = new Uint8Array(128);
    for (let i = 0, n = chars.length; i < n; i++) {
      vtc[chars.charCodeAt(i)] = i + 1;
    }
    return vtc;
  })();

  // Top 100 bad tokens according to occurrence and likelihood of false hit.
  // Check source code of uBlock Origin.
  const BAD_TOKENS = [
    ['https', 123617],
    ['com', 76987],
    ['js', 43620],
    ['www', 33129],
    ['jpg', 32221],
    ['images', 31812],
    ['css', 19715],
    ['png', 19140],
    ['static', 15724],
    ['net', 15239],
    ['de', 13155],
    ['img', 11109],
    ['assets', 10746],
    ['min', 7807],
    ['cdn', 7568],
    ['content', 6900],
    ['wp', 6444],
    ['fonts', 6095],
    ['svg', 5976],
    ['http', 5813],
    ['ssl', 5735],
    ['amazon', 5440],
    ['ru', 5427],
    ['fr', 5199],
    ['facebook', 5178],
    ['en', 5146],
    ['image', 5028],
    ['html', 4837],
    ['media', 4833],
    ['co', 4783],
    ['php', 3972],
    ['2019', 3943],
    ['org', 3924],
    ['jquery', 3531],
    ['02', 3438],
    ['api', 3382],
    ['gif', 3350],
    ['eu', 3322],
    ['prod', 3289],
    ['woff2', 3200],
    ['logo', 3194],
    ['themes', 3107],
    ['icon', 3048],
    ['google', 3026],
    ['v1', 3019],
    ['uploads', 2963],
    ['googleapis', 2860],
    ['v3', 2816],
    ['tv', 2762],
    ['icons', 2748],
    ['core', 2601],
    ['gstatic', 2581],
    ['ac', 2509],
    ['utag', 2466],
    ['id', 2459],
    ['ver', 2448],
    ['rsrc', 2387],
    ['files', 2361],
    ['uk', 2357],
    ['us', 2271],
    ['pl', 2262],
    ['common', 2205],
    ['public', 2076],
    ['01', 2016],
    ['na', 1957],
    ['v2', 1954],
    ['12', 1914],
    ['thumb', 1895],
    ['web', 1853],
    ['ui', 1841],
    ['default', 1825],
    ['main', 1737],
    ['false', 1715],
    ['2018', 1697],
    ['embed', 1639],
    ['player', 1634],
    ['dist', 1599],
    ['woff', 1593],
    ['global', 1593],
    ['json', 1572],
    ['11', 1566],
    ['600', 1559],
    ['app', 1556],
    ['styles', 1533],
    ['plugins', 1526],
    ['274', 1512],
    ['random', 1505],
    ['sites', 1505],
    ['imasdk', 1501],
    ['bridge3', 1501],
    ['news', 1496],
    ['width', 1494],
    ['thumbs', 1485],
    ['ttf', 1470],
    ['ajax', 1463],
    ['user', 1454],
    ['scripts', 1446],
    ['twitter', 1440],
    ['crop', 1431],
    ['new', 1412],
  ];

  class UrlTokenizer {
    constructor() {
      this.knownTokens = new Set();
      this.badTokens = new Map(BAD_TOKENS);
    }

    recordTokenUsage(token, tokenHash) {
      const cnt = this.badTokens.get(token) || 0;
      this.badTokens.set(token, cnt + 1);
      this.knownTokens.add(tokenHash);
    }

    tokenHashFromString(s) {
      const l = s.length;
      if (l === 0) { return EMPTY_TOKEN_HASH; }
      const vtc = TOKEN_VALID_CHARS;
      let th = vtc[s.charCodeAt(0)];
      for (let i = 1; i !== MAX_TOKEN_LENGTH && i !== l; i++) {
        th = th << 4 ^ vtc[s.charCodeAt(i)];
      }
      return th;
    }

    stringFromTokenHash(th) {
      if (th === 0) { return ''; }
      return th.toString(16);
    }

    *iterTokensFromUrl(url) {
      TOKEN_REGEX.lastIndex = 0;
      if (url.length > 2048) {
        url = url.slice(0, 2048);
      }
      for (;;) {
        const m = TOKEN_REGEX.exec(url);
        if (!m) { break; }
        const token = m[0].toLowerCase();
        const tokenHash = this.tokenHashFromString(token);
        if (this.knownTokens.has(tokenHash)) {
          yield tokenHash;
        }
      }
      yield ANY_TOKEN_HASH;
      yield NO_TOKEN_HASH;
    }

    extractTokenFromPattern(pattern) {
      let tokenHash = NO_TOKEN_HASH;
      TOKEN_REGEX.lastIndex = 0;
      let bestToken = null;
      let bestBadness = Infinity;
      for (;;) {
        const match = TOKEN_REGEX.exec(pattern);
        if (match === null) { break; }
        const {0: token, index} = match;
        const badness = token.length > 1 ? this.badTokens.get(token) || 0 : 1;
        if (badness >= bestBadness) { continue; }
        if (index > 0) {
          const c = pattern.charCodeAt(index - 1);
          if (c === 0x2A /* '*' */) { continue; }
        }
        const lastIndex = TOKEN_REGEX.lastIndex;
        if (lastIndex < pattern.length) {
          const c = pattern.charCodeAt(lastIndex);
          if (c === 0x2A /* '*' */) { continue; }
        }
        bestToken = token;
        if (badness === 0) { break; }
        bestBadness = badness;
      }
      if (bestToken !== null) {
        const token = bestToken;
        tokenHash = this.tokenHashFromString(token);
        this.recordTokenUsage(token, tokenHash);
      }
      return tokenHash;
    }

    extractTokenFromRegex(pattern) {
      let tokenHash = NO_TOKEN_HASH;
      pattern = regex.toTokenizableStr(pattern);
      TOKEN_REGEX.lastIndex = 0;
      let bestToken = null;
      let bestBadness = Infinity;
      for (;;) {
        const match = TOKEN_REGEX.exec(pattern);
        if (match === null) { break; }
        const {0: token, index} = match;
        if (index === 0 || pattern.charAt(index - 1) === '\x01') {
          continue;
        }
        const {lastIndex} = TOKEN_REGEX;
        if (lastIndex === pattern.length || pattern.charAt(lastIndex) === '\x01') {
          continue;
        }
        const badness = token.length > 1 ? this.badTokens.get(token) || 0 : 1;
        if (badness >= bestBadness) { continue; }
        bestToken = token;
        if (badness === 0) { break; }
        bestBadness = badness;
      }
      if (bestToken !== null) {
        const token = bestToken.toLowerCase();
        tokenHash = this.tokenHashFromString(token);
        this.recordTokenUsage(token, tokenHash);
      }
      return tokenHash;
    }
  }

  class regex {
    static firstCharCodeClass(s) {
      return /^[\x01\x03%0-9A-Za-z]/.test(s) ? 1 : 0;
    }

    static lastCharCodeClass(s) {
      return /[\x01\x03%0-9A-Za-z]$/.test(s) ? 1 : 0;
    }

    static tokenizableStrFromNode(node) {
      switch (node.type) {
        case 1: /* T_SEQUENCE, 'Sequence' */ {
          let s = '';
          for (let i = 0; i < node.val.length; i++) {
            s += this.tokenizableStrFromNode(node.val[i]);
          }
          return s;
        }
        case 2: /* T_ALTERNATION, 'Alternation' */
        case 8: /* T_CHARGROUP, 'CharacterGroup' */ {
          if (node.flags.NegativeMatch) { return '\x01'; }
          let firstChar = 0;
          let lastChar = 0;
          for (let i = 0; i < node.val.length; i++) {
            const s = this.tokenizableStrFromNode(node.val[i]);
            if (firstChar === 0 && this.firstCharCodeClass(s) === 1) {
              firstChar = 1;
            }
            if (lastChar === 0 && this.lastCharCodeClass(s) === 1) {
              lastChar = 1;
            }
            if (firstChar === 1 && lastChar === 1) { break; }
          }
          return String.fromCharCode(firstChar, lastChar);
        }
        case 4: /* T_GROUP, 'Group' */ {
          if (
            node.flags.NegativeLookAhead === 1 ||
            node.flags.NegativeLookBehind === 1
          ) {
            return '';
          }
          return this.tokenizableStrFromNode(node.val);
        }
        case 16: /* T_QUANTIFIER, 'Quantifier' */ {
          if (node.flags.max === 0) { return ''; }
          const s = this.tokenizableStrFromNode(node.val);
          const first = this.firstCharCodeClass(s);
          const last = this.lastCharCodeClass(s);
          if (node.flags.min !== 0) {
            return String.fromCharCode(first, last);
          }
          return String.fromCharCode(first + 2, last + 2);
        }
        case 32: /* T_UNICODECHAR, 'UnicodeChar' */
        case 64: /* T_HEXCHAR, 'HexChar' */ {
          // prevent confusion with internally used chars
          // (note: control chars are invalid in a normal URL)
          const code = parseInt(node.flags.Code, 16);
          if (0x00 <= code && code <= 0x03) { return '\x00'; }

          return node.flags.Char;
        }
        case 128: /* T_SPECIAL, 'Special' */ {
          const flags = node.flags;
          if (
            flags.EndCharGroup === 1 || // dangling `]`
            flags.EndGroup === 1 ||   // dangling `)`
            flags.EndRepeats === 1    // dangling `}`
          ) {
            throw new Error('Unmatched bracket');
          }
          return flags.MatchEnd === 1 ||
               flags.MatchStart === 1 ||
               flags.MatchWordBoundary === 1
            ? '\x00'
            : '\x01';
        }
        case 256: /* T_CHARS, 'Characters' */ {
          for (let i = 0; i < node.val.length; i++) {
            if (this.firstCharCodeClass(node.val[i]) === 1) {
              return '\x01';
            }
          }
          return '\x00';
        }
        // Ranges are assumed to always involve token-related characters.
        case 512: /* T_CHARRANGE, 'CharacterRange' */ {
          return '\x01';
        }
        case 1024: /* T_STRING, 'String' */ {
          return node.val;
        }
        case 2048: /* T_COMMENT, 'Comment' */ {
          return '';
        }
      }
      return '\x01';
    }

    static toTokenizableStr(reStr) {
      let s = '';
      try {
        // Depends on:
        // https://github.com/foo123/RegexAnalyzer
        const regexAnalyzer = Regex.Analyzer;

        const node = regexAnalyzer(reStr, false).tree();
        s = this.tokenizableStrFromNode(node);
      } catch(ex) {
        // Regex library not available or regex not parsable.
      }

      // Process optional sequences
      const reOptional = /[\x02\x03]+/;
      for (;;) {
        const match = reOptional.exec(s);
        if (match === null) { break; }
        const left = s.slice(0, match.index);
        const middle = match[0];
        const right = s.slice(match.index + middle.length);
        s = left;
        s += this.firstCharCodeClass(right) === 1 ||
            this.firstCharCodeClass(middle) === 1
          ? '\x01'
          : '\x00';
        s += this.lastCharCodeClass(left) === 1 ||
            this.lastCharCodeClass(middle) === 1
          ? '\x01'
          : '\x00';
        s += right;
      }

      return s;
    }
  }

  // Increase this whenever the compile format is changed.
  const COMPILE_VERSION = 3;

  const BLOCK_TYPE_NONE     = 0;
  const BLOCK_TYPE_HOSTNAME = 1;
  const BLOCK_TYPE_URL      = 2;

  class ContentFarmFilter {
    constructor() {
      this._rules = new Map();
      this._buckets = new Map();
      this._transformRules = new Map();
      this.urlTokenizer = new UrlTokenizer();

      this.RULE_ACTION_BLOCK = RULE_ACTION_BLOCK;
      this.RULE_ACTION_UNBLOCK = RULE_ACTION_UNBLOCK;
      this.RULE_ACTION_NOOP = RULE_ACTION_NOOP;

      this.BLOCK_TYPE_NONE = BLOCK_TYPE_NONE;
      this.BLOCK_TYPE_HOSTNAME = BLOCK_TYPE_HOSTNAME;
      this.BLOCK_TYPE_URL = BLOCK_TYPE_URL;
    }

    async init(options, optChanges) {
      this.addTransformRulesFromText(options.transformRules);

      this.addBlocklist('userGraylist', {
        sourceText: options.userGraylist,
        ruleOptions: {action: RULE_ACTION_NOOP},
        cacheDuration: options.webBlacklistsCacheDuration,
        renew: optChanges && optChanges.userGraylist,
      });
      this.addBlocklist('userBlacklist', {
        sourceText: options.userBlacklist,
        ruleOptions: {action: RULE_ACTION_BLOCK},
        cacheDuration: options.webBlacklistsCacheDuration,
        renew: optChanges && optChanges.userBlacklist,
      });
      this.addBlocklist('userWhitelist', {
        sourceText: options.userWhitelist,
        ruleOptions: {action: RULE_ACTION_UNBLOCK},
        cacheDuration: options.webBlacklistsCacheDuration,
        renew: optChanges && optChanges.userWhitelist,
      });

      // calculate added urls
      const addedUrls = new Set();
      if (optChanges && optChanges.webBlacklists) {
        const {newValue, oldValue} = optChanges.webBlacklists;
        const urlSet = new Set(this.urlsTextToLines(oldValue));
        for (const url of this.urlsTextToLines(newValue)) {
          if (!urlSet.has(url)) {
            addedUrls.add(url);
          }
        }
      }

      // run one by one to prevent memory overload if the list is large
      const urls = this.urlsTextToLines(options.webBlacklists);
      for (const url of urls) {
        this.addBlocklist(url, {
          ruleOptions: {action: RULE_ACTION_BLOCK, src: url},
          cacheDuration: options.webBlacklistsCacheDuration,
          renew: addedUrls.has(url),
        });
      }
    }

    async addBlocklist(urlOrName, {sourceText = null, ruleOptions, cacheDuration, renew}) {
      let compiled;
      try {
        if (renew) {
          throw new Error('force renew');
        }
        compiled = await this.getCompiledCache(urlOrName);
      } catch (ex) {
        let text = sourceText;
        if (text === null) {
          if (renew) {
            try {
              text = await this.fetchWebBlackList(urlOrName);
            } catch (ex) {
              console.error(`Failed to fetch blacklist from "${urlOrName}": ${ex.message}`);
            }
          } else {
            ({text} = await this.getCachedWebBlackList(urlOrName, cacheDuration));
          }
        }
        compiled = await this.compileBlocklist(urlOrName, text || '', ruleOptions);
      }
      if (!compiled) { return; }

      this.addCompiledRules(compiled, ruleOptions);
    }

    async compileBlocklist(urlOrName, rulesText, options) {
      const rv = {
        version: COMPILE_VERSION,
        time: Date.now(),
        rules: [],
      };

      for (const ruleLine of utils.getLines(rulesText)) {
        const rule = this.parseRuleLine(ruleLine, options).validate(true);
        const compiled = [
          `${rule.rule}${rule.comment ? ' ' + rule.comment : ''}`, // 0: rule
          DOT_TOKEN_HASH, // 1: tokenHash
        ];

        switch (rule.type) {
          case RULE_TYPE_PATTERN: {
            compiled[1] = this.urlTokenizer.extractTokenFromPattern(rule.pattern);
            break;
          }
          case RULE_TYPE_REGEX: {
            compiled[1] = this.urlTokenizer.extractTokenFromRegex(rule.pattern);
            break;
          }
          case RULE_TYPE_NONE: {
            // remove invalid rules
            continue;
          }
        }
        rv.rules.push(compiled);
      }

      await this.setCompiledCache(urlOrName, rv);

      return rv;
    }

    addCompiledRules(compiled, options) {
      for (const [ruleText, tokenHash] of compiled.rules) {
        const rule = this.parseRuleLine(ruleText, options);
        if (this._rules.has(rule.token)) { continue; }
        this._rules.set(rule.token, rule);
        switch (rule.type) {
          case RULE_TYPE_REGEX: {
            const bucket = this.setBucket(rule);
            bucket.units = bucket.units || new Map();
            let rules = bucket.units.get(tokenHash);
            if (!rules) {
              rules = new Set();
              bucket.units.set(tokenHash, rules);
            }
            rules.add(rule);
            this.urlTokenizer.knownTokens.add(tokenHash);
            break;
          }
          case RULE_TYPE_PATTERN: {
            const bucket = this.setBucket(rule);
            bucket.units = bucket.units || new Map();
            let rules = bucket.units.get(tokenHash);
            if (!rules) {
              rules = new Set();
              bucket.units.set(tokenHash, rules);
            }
            rules.add(rule);
            this.urlTokenizer.knownTokens.add(tokenHash);
            break;
          }
          case RULE_TYPE_DOMAIN: {
            const bucket = this.setBucket(rule);
            bucket.dict = bucket.dict || new Map();
            bucket.dict.set(rule.domain, rule);
            break;
          }
          case RULE_TYPE_IPV4:
          case RULE_TYPE_IPV6: {
            const bucket = this.setBucket(rule);
            bucket.dict = bucket.dict || new Map();
            bucket.dict.set(rule.ip, rule);
            break;
          }
        }
      }
    }

    addTransformRulesFromText(rulesText) {
      for (const ruleLine of utils.getLines(rulesText)) {
        const rule = this.parseTransformRuleLine(ruleLine);
        if (rule.type === TRULE_TYPE_NONE || !rule.replacement) { continue; }
        if (!this._transformRules.has(rule.token)) {
          this._transformRules.set(rule.token, rule);
        }
      }
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

      // fallback to 'omit' when host permission not granted to allow CORS fetch
      const credentials = await browser.permissions.contains({origins: [url]}) ? 'include' : 'omit';

      const response = await fetch(url, {
        credentials,
        cache: 'no-cache',
      });
      if (!response.ok) { throw new Error("response not ok"); }
      const text = await response.text();
      await this.setWebListCache(url, {time, text});
      return text;
    }

    /**
     * @typedef {Object} Source
     * @property {string} url - source URL
     * @property {string} [redirected] - redirected URL (or hostname only)
     */

    /**
     * @typedef {Object} Blocker
     * @property {?Rule} rule
     * @property {number} type - type of the block, see BLOCK_TYPE_*
     */

    /**
     * @param {Source} source
     * @returns {Blocker}
     */
    getBlocker(...args) {
      const matchIPv6 = (hostname, action) => {
        const bucket = this.getBucket(action | RULE_TYPE_IPV6);
        if (!bucket) { return null; }
        return bucket.dict.get(hostname.slice(1, -1));
      };

      const matchIPv4 = (hostname, action) => {
        const bucket = this.getBucket(action | RULE_TYPE_IPV4);
        if (!bucket) { return null; }
        return bucket.dict.get(hostname);
      };

      const matchDomain = (hostname, action) => {
        const bucket = this.getBucket(action | RULE_TYPE_DOMAIN);
        if (!bucket) { return null; }
        let domain = hostname;
        let pos;
        while (true) {
          const rule = bucket.dict.get(domain);
          if (rule) { return rule; }
          pos = domain.indexOf('.');
          if (pos === -1) { break; }
          domain = domain.slice(pos + 1);
        }
        return null;
      };

      const matchPattern = (hostname, action) => {
        const bucket = this.getBucket(action | RULE_TYPE_PATTERN);
        if (!bucket) { return null; }
        for (const tokenHash of this.urlTokenizer.iterTokensFromUrl(hostname)) {
          const rules = bucket.units.get(tokenHash);
          if (!rules) { continue; }
          for (const rule of rules) {
            if (!rule.regex) {
              let regexStr = rule.pattern
                .replace(/[.+^?${}()|[\]\\]/g, '\\$&')
                .replace(/\*+/g, '\\S*?');
              regexStr = '^(?:[^/?#]+\\.)?' + regexStr + '$';
              rule.regex = new RegExp(regexStr, 'i');
            }
            rule.regex.lastIndex = 0;
            if (rule.regex.test(hostname)) {
              return rule;
            }
          }
        }
        return null;
      };

      const matchRegex = (url, action) => {
        const bucket = this.getBucket(action | RULE_TYPE_REGEX);
        if (!bucket) { return null; }
        for (const tokenHash of this.urlTokenizer.iterTokensFromUrl(url)) {
          const rules = bucket.units.get(tokenHash);
          if (!rules) { continue; }
          for (const rule of rules) {
            if (!rule.regex) {
              rule.regex = new RegExp(rule.pattern, rule.flags);
            }
            rule.regex.lastIndex = 0;
            if (rule.regex.test(url)) {
              return rule;
            }
          }
        }
        return null;
      };

      const match = (url, hostname, action, result) => {
        let rule;
        if (hostname.startsWith('[') && hostname.endsWith(']')) {
          if (rule = matchIPv6(hostname, action)) {
            result.rule = rule;
            result.type = BLOCK_TYPE_HOSTNAME;
            return;
          }
        } else if (RE_IPV4.test(hostname)) {
          if (rule = matchIPv4(hostname, action)) {
            result.rule = rule;
            result.type = BLOCK_TYPE_HOSTNAME;
            return;
          }
        } else {
          if (rule = matchDomain(hostname, action)) {
            result.rule = rule;
            result.type = BLOCK_TYPE_HOSTNAME;
            return;
          }
          if (rule = matchPattern(hostname, action)) {
            result.rule = rule;
            result.type = BLOCK_TYPE_HOSTNAME;
            return;
          }
        }

        if (rule = matchRegex(url, action)) {
          result.rule = rule;
          result.type = BLOCK_TYPE_URL;
          return;
        }
      };

      const checkUrl = (urlToCheck, details) => {
        const result = {
          rule: null,
          type: BLOCK_TYPE_NONE,
        };

        let urlObj;
        try {
          urlObj = new URL(urlToCheck);
        } catch (ex) {
          // bad URL
          return result;
        }
        const hostname = utils.getNormalizedHostname(urlObj.hostname);
        const url = utils.getNormalizedUrl(urlObj);

        if (!details) {
          // check blacklist and then whitelist according to the likelihood of match
          match(url, hostname, RULE_ACTION_BLOCK, result);
          if (result.rule) {
            match(url, hostname, RULE_ACTION_UNBLOCK, result);
          }
        } else {
          // whitelist
          match(url, hostname, RULE_ACTION_UNBLOCK, result);
          if (result.rule) { return result; }

          // blacklist
          // a blacklist rule masked by graylist won't match here
          match(url, hostname, RULE_ACTION_BLOCK, result);
          if (result.rule) { return result; }

          // graylist
          match(url, hostname, RULE_ACTION_NOOP, result);
        }
        return result;
      };

      const fn = this.getBlocker = ({url, redirected, details = false}) => {
        const blocker = {
          rule: null,
          type: BLOCK_TYPE_NONE,
        };

        if (url) {
          let check = checkUrl(url, details);

          // check redirected if source URL is not blocked
          if (!(check.rule && check.rule.action === RULE_ACTION_BLOCK) && redirected) {
            // treat as http://* if hostname only
            const url = (RE_SCHEME.test(redirected) ? '' : 'http://') + redirected;
            check = checkUrl(url, details);
          }

          if (!details) {
            if (check.rule && check.rule.action === RULE_ACTION_BLOCK) {
              Object.assign(blocker, check);
            }
          } else {
            Object.assign(blocker, check);
          }
        }
        return blocker;
      };
      return fn(...args);
    }

    isInBlacklist(ruleLine) {
      const {token} = this.parseRuleLine(ruleLine);
      return this._rules.has(token);
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

    parseRuleLine(ruleLine, options) {
      return new Rule(ruleLine, options);
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
          if (rule.type !== RULE_TYPE_REGEX) {
            this._transform(rule);
          }
          break;
        }
        case 'url': {
          if (rule.type === RULE_TYPE_NONE && RE_SCHEME.test(rule.rule)) {
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
        if (!tRule.regex) {
          switch (tRule.type) {
            case TRULE_TYPE_REGEX: {
              tRule.regex = new RegExp(tRule.pattern, tRule.flags);
              break;
            }
            case TRULE_TYPE_PLAIN: {
              tRule.regex = new RegExp(utils.escapeRegExp(tRule.rule).replace(RE_ASTERISK_FIXER, "[^:/?#]*"));
              break;
            }
            default: {
              continue;
            }
          }
        }
        tRule.regex.lastIndex = 0;
        const match = tRule.regex.exec(rule.rule);
        if (!match) { continue; }
        const leftContext = RegExp.leftContext;
        const rightContext = RegExp.rightContext;
        const useRegex = RE_REGEX_RULE.test(tRule.replacement);
        const ruleText = tRule.replacement.replace(RE_TRANSFORM_PLACEHOLDER, (_, m) => {
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

    getBucket(key) {
      return this._buckets.get(key);
    }

    setBucket(rule) {
      const key = rule.action | rule.type;
      let bucket = this._buckets.get(key);
      if (bucket) { return bucket; }
      bucket = {};
      this._buckets.set(key, bucket);
      return bucket;
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

      // remove the compiled version as it's no longer uptodate
      await browser.storage.local.remove(this.compiledCacheKey(url));
    }

    async clearStaleWebListCache(webListChange) {
      const {newValue, oldValue} = webListChange;
      const urlSet = new Set(this.urlsTextToLines(newValue));
      const deletedUrls = this.urlsTextToLines(oldValue).filter(u => !urlSet.has(u));
      const keys = [];
      for (const url of deletedUrls) {
        keys.push(this.webListCacheKey(url));
        keys.push(this.compiledCacheKey(url));
      }
      await browser.storage.local.remove(keys);
    }

    compiledCacheKey(urlOrName) {
      return `cache/blocklist/compiled/${urlOrName}`;
    }

    async getCompiledCache(urlOrName) {
      const key = this.compiledCacheKey(urlOrName);
      const data = (await browser.storage.local.get(key))[key];
      if (data.version !== COMPILE_VERSION) {
        throw new Error(`Unsupported version for ${urlOrName}: ${data.version}`);
      }
      return data;
    }

    async setCompiledCache(urlOrName, data) {
      const key = this.compiledCacheKey(urlOrName);
      await browser.storage.local.set({[key]: data});
    }
  }

  return ContentFarmFilter;

}));
