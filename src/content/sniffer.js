// MAIN world 嗅探器：劫持 fetch / XHR，捕获 BOSS / 51job 的岗位接口 JSON 响应，
// 通过 window.postMessage 转发给 ISOLATED world 的 collector。
// 不改请求、不碰令牌/WAF —— 只被动读取页面自己发出的请求的响应。
(function () {
  const FLAG = '__jobHelperSnifferInstalled';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const CHANNEL = 'job-helper:sniffer';
  const REPLAY = 'replay-request';
  // 详情页的接口经常在 collector（document_idle）挂上监听之前就返回。
  // 先记在这里，等 collector 发 replay-request 再投递一次，打开原岗位才补得上 JD。
  const recent = [];

  function deliver(message) {
    try {
      window.postMessage(message, location.origin);
    } catch {}
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || data.source !== CHANNEL || data.type !== REPLAY) return;
    const copy = recent.slice();
    for (const message of copy) deliver({ ...message, replay: true });
  });

  // 独立副本：内容脚本不能 import。列表与 platforms.matchPlatformApi 一致；
  // 详情覆盖 job/detail、pc/recommend/job/detail、job/card、geek/job/detail（collector 也按详情处理）。
  function matchApi(urlStr) {
    let u;
    try {
      u = new URL(urlStr, location.href);
    } catch {
      return null;
    }
    const host = u.hostname;
    const path = u.pathname;
    if (/(^|\.)zhipin\.com$/i.test(host)) {
      // 列表 + 详情/卡片（点开某个岗位时触发，用于识别「当前岗位」）
      if (/\/wapi\/zpgeek\/(search\/joblist|pc\/recommend\/job\/list|mobile\/search\/joblist|job\/detail(?:\/[a-z]+)?|pc\/recommend\/job\/detail|job\/card|geek\/job\/detail)\.json/.test(path)) {
        return 'boss';
      }
    }
    if (/(^|\.)51job\.com$/i.test(host)) {
      if (/\/api\/job\/(search-(pc|h5)|detail)/.test(path)) return 'qcwy';
    }
    return null;
  }

  function post(platform, url, payload) {
    const message = { source: CHANNEL, platform, url, payload };
    recent.push(message);
    if (recent.length > 30) recent.shift();
    deliver(message);
  }

  // 非 JSON 不进重放队列，也不带响应正文。网络失败不是「非 JSON」，不记。
  function postDrop(platform, url) {
    deliver({ source: CHANNEL, type: 'sniff-drop', platform, url, reason: 'non-json' });
  }

  // —— fetch ——
  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (input, init) {
      const promise = origFetch(input, init);
      try {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const platform = matchApi(url);
        if (platform) {
          promise
            .then((res) => res.clone().json().then((data) => post(platform, url, data)).catch(() => postDrop(platform, url)))
            .catch(() => {});
        }
      } catch {}
      return promise;
    };
  }

  // —— XHR ——
  const proto = XMLHttpRequest.prototype;
  const origOpen = proto.open;
  const origSend = proto.send;
  proto.open = function (...args) {
    this.__jhUrl = String(args[1] ?? '');
    return origOpen.apply(this, args);
  };
  proto.send = function (...args) {
    const url = this.__jhUrl || '';
    const platform = url && matchApi(url);
    if (platform) {
      this.addEventListener('load', () => {
        try {
          const data = JSON.parse(String(this.responseText));
          post(platform, url, data);
        } catch {
          postDrop(platform, url);
        }
      });
    }
    return origSend.apply(this, args);
  };
})();
