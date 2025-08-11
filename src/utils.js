// Polyfill for MV2
if (typeof browser !== 'undefined') {
  if (browser?.browserAction && !browser?.action) {
    browser.action = browser.browserAction;
  }
}

(function (root, factory) {
  // Browser globals
  root.utils = factory(
    root.window,
    root.document,
    root.console,
  );
}(this, function (window, document, console) {

  'use strict';

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
     *   - storage.sync not available: storage.sync methods fail if Firefox
     *     config webextensions.storage.sync.enabled is not set to true.
     *   - the data to be stored exceeds quota or other limit
     *   - other unclear reason (during data syncing?)
     *
     * - clear: clear sync and local
     */
    defaultOptions: {
      userBlacklist: "",
      userWhitelist: "",
      userGraylist: "",
      webBlacklists: "https://danny0838.github.io/content-farm-terminator/files/blocklist/content-farms.txt",
      webBlacklistsCacheDuration: 24 * 60 * 60 * 1000,
      webBlacklistsUpdateInterval: 5 * 60 * 1000,
      transformRules: "",
      suppressHistory: false,
      showLinkMarkers: true,
      showContextMenuCommands: true,
      quickContextMenuCommands: false,
      showUnblockButton: true,
      tempUnblockDuration: 8000,
      tempUnblockCountdownBase: 10000,
      tempUnblockCountdownIncrement: 500,
      tempUnblockCountdownReset: 24 * 60 * 60 * 1000,
      tempUnblockCountdown: -1,
      tempUnblockLastAccess: -1,
    },

    /**
     * Use storage.local > storage.sync > passed values
     *
     * @param {string|string[]|Object} [options] - An object for key-value pairs,
     *     or key(s) with corresponding values of defaultOptions.
     */
    async getOptions(options = this.defaultOptions) {
      if (typeof options === "string") {
        options = {[options]: this.defaultOptions[options]};
      } else if (Array.isArray(options)) {
        options = options.reduce((rv, key) => {
          rv[key] = this.defaultOptions[key];
          return rv;
        }, {});
      }
      const keys = Object.keys(options);

      let syncResult;
      try {
        syncResult = await browser.storage.sync.get(keys);
      } catch (ex) {
        syncResult = {};
      }

      // merge options from storage.local to options from storage.sync
      const localResult = await browser.storage.local.get(keys);
      return Object.assign({}, options, syncResult, localResult);
    },

    async setOptions(options) {
      try {
        await browser.storage.sync.set(options);
        await browser.storage.local.remove(Object.keys(options));
      } catch (ex) {
        await browser.storage.local.set(options);
      }
    },

    async clearOptions() {
      try {
        await browser.storage.sync.clear();
      } catch (ex) {}
      await browser.storage.local.clear();
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

      // Whether this is a dev build.
      if (/^\d+\.\d+\.\d+\D/.test(browser.runtime.getManifest().version)) {
        soup.add('devbuild');
      }

      if (/\bMobile\b/.test(ua)) {
        soup.add('mobile');
      }

      // Synchronous -- order of tests is important
      var match;
      if ((match = /\bFirefox\/(\d+)/.exec(ua)) !== null) {
        flavor.major = parseInt(match[1], 10) || 0;
        soup.add('mozilla').add('firefox');
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

      Object.defineProperty(this, 'userAgent', {value: flavor});
      return flavor;
    },

    lang(...args) {
      const msgRegex = /__MSG_(.*?)__/g;
      const msgReplacer = (m, k) => utils.lang(k);
      const fn = this.lang = (key, args) => {
        const msg = browser.i18n.getMessage(key, args);
        if (msg) {
          // recursively replace __MSG_key__
          return msg.replace(msgRegex, msgReplacer);
        }
        return "__MSG_" + key + "__";
      };
      return fn(...args);
    },

    loadLanguages(...args) {
      const msgRegex = /__MSG_(.*?)__/g;
      const msgReplacer = (m, k) => utils.lang(k);
      const fn = this.loadLanguages = (rootNode = document) => {
        const doc = rootNode.ownerDocument || rootNode;
        const walker = doc.createNodeIterator(rootNode, 5 /* NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT */);

        let node = walker.nextNode();
        while (node) {
          switch (node.nodeType) {
            case 1:
              for (const attr of node.attributes) {
                attr.nodeValue = attr.nodeValue.replace(msgRegex, msgReplacer);
              }
              break;
            case 3:
              node.nodeValue = node.nodeValue.replace(msgRegex, msgReplacer);
              break;
          }
          node = walker.nextNode();
        }
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
        " ": "&nbsp;",
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
      const reStandard = /[-/\\^$*+?.|()[\]{}]/g;
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

    /**
     * A helper to normalize URL.hostname for compatibility and performance.
     *
     * @param {string} hostname - a URL.hostname (or URL.host)
     */
    getNormalizedHostname(hostname) {
      // Preserved for historical reason and potential future usage.
      return hostname;
    },

    getNormalizedUrl(url) {
      let urlObj;
      try {
        urlObj = (url instanceof URL) ? url : new URL(url);
      } catch (ex) {
        return null;
      }

      const u = urlObj.username;
      const p = urlObj.password;
      const t = urlObj.port;
      return urlObj.protocol + '//' +
          (u ? u + (p ? ':' + p : '') + '@' : '') +
          this.getNormalizedHostname(urlObj.hostname) +
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
      if (doctype.systemId) { ret += ' "' + doctype.systemId + '"'; }
      ret += ">\n";
      return ret;
    },

    readFileAsDocument(blob) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.responseType = "document";
        xhr.onload = () => resolve(xhr.response);
        xhr.onerror = () => reject(new Error("Network request failed."));
        xhr.open("GET", URL.createObjectURL(blob), true);
        xhr.send();
      });
    },

    getBlockedPageUrl(url, {blockType = 1 /* BLOCK_TYPE_HOSTNAME */, inFrame = false, tabId = null, requestId = null} = {}) {
      url = utils.getNormalizedUrl(url);

      const redirectUrlObj = new URL(browser.runtime.getURL('blocked.html'));
      redirectUrlObj.searchParams.set('url', url);
      if (tabId) { redirectUrlObj.searchParams.set('t', tabId); }
      if (requestId) { redirectUrlObj.searchParams.set('r', requestId); }
      redirectUrlObj.searchParams.set('type', blockType);
      const redirectUrl = redirectUrlObj.href;

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

    async sleep(ms) {
      await new Promise(r => setTimeout(() => r(), ms));
    },

    async back() {
      const url = location.href;
      history.back();
      await this.sleep(100);
      if (location.href !== url) { return; }

      const tab = await browser.tabs.getCurrent();
      return await browser.runtime.sendMessage({
        cmd: 'closeTab',
        args: {tabId: tab.id},
      });
    },
  };

  return utils;

}));
