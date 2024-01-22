async function init(event) {
  utils.loadLanguages(document, {htmlOptions: {
    ALLOWED_TAGS: ['h3', 'p', 'ul', 'ol', 'li', 'pre', 'blockquote', 'a', '#text'],
  }});

  for (const elem of document.querySelectorAll('a.refresh')) {
    elem.href = '#';
    elem.addEventListener('click', (event) => {
      event.preventDefault();
      location.reload();
    });
  }

  let ok = true;
  for (const [perm, value] of Object.entries(await utils.checkPermissions())) {
    if (!value) {
      document.getElementById(`startup-${perm}`).hidden = false;
      ok = false;
    }
  }

  if (ok) {
    document.getElementById("startup-ok").hidden = false;
  } else {
    document.getElementById("startup-go").hidden = false;
  }
}

document.addEventListener('DOMContentLoaded', init);
