async function init(event) {
  utils.loadLanguages(document, {htmlOptions: {
    ALLOWED_TAGS: ['h3', 'p', 'ul', 'ol', 'li', 'pre', 'blockquote', 'a', '#text'],
  }});

  let ok = true;

  if (!await browser.permissions.contains({permissions: ["webRequestBlocking"]})) {
    document.getElementById('startup-web-request-blocking').hidden = false;
    ok = false;
  }

  if (!await browser.permissions.contains({origins : ["http://*/", "https://*/"]})) {
    document.getElementById('host-permissions').hidden = false;
    ok = false;
  }

  if (ok) {
    document.getElementById('startup-ok').hidden = false;
  } else {
    document.getElementById('startup-go').hidden = false;
  }
}

document.addEventListener('DOMContentLoaded', init);
