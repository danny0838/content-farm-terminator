function print(text = '') {
  document.body.appendChild(document.createTextNode(text));
  document.body.appendChild(document.createTextNode('\n'));
}

async function showRequests(tabId, url) {
  const records = await browser.runtime.sendMessage({
    cmd: 'getRequestRecords',
    args: {tabId},
  });

  document.body.textContent = '';
  for (const [requestId, record] of records) {
    print(`Time: ${new Date(record.timestamp).toISOString()}`);

    if (record.referrer) {
      print(`Referrer: ${record.referrer}`);
    }

    print(`Request: ${record.initialUrl}`);

    if (record.redirects) {
      for (const [src, dest] of record.redirects) {
        print(`Redirect: ${dest}`);
      }
    }

    print();
  }

  if (url) {
    print(`Current URL: ${url}`);
  }
}

async function init(event) {
  utils.loadLanguages(document);

  const searchParams = new URL(location.href).searchParams;
  const tabId = parseInt(searchParams.get('t'), 10);
  const url = searchParams.get('url');

  await showRequests(tabId, url);
}

document.addEventListener('DOMContentLoaded', init);
