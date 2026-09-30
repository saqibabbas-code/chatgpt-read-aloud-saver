(() => {
  "use strict";

  const HOOK_KEY = Symbol.for("read-aloud-saver.page-hook.v1");
  if (window[HOOK_KEY]) return;
  Object.defineProperty(window, HOOK_KEY, {value: true, configurable: false});

  const MAX_BYTES = 64 * 1024 * 1024;
  const MAX_CONCURRENT = 2;
  // Allow an eight-minute response to arrive even when audio is streamed slowly.
  const TIMEOUT_MS = 15 * 60 * 1000;
  const jobs = new Set();
  const recentErrors = new Map();
  const xhrDetails = new WeakMap();
  let pageHidden = false;

  function safeUrl(value) {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin && url.protocol === "https:" ? url : null;
    } catch { return null; }
  }

  function messageIdFrom(url, body) {
    const isId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
    for (const key of ["message_id", "messageId", "messageid"]) {
      const value = url?.searchParams.get(key);
      if (isId(value)) return value;
    }
    // Inspect only small caller-provided JSON strings and retain only an ID.
    // Request bodies/headers/cookies/tokens are never copied or transmitted.
    if (typeof body === "string" && body.length <= 32768) {
      try {
        const parsed = JSON.parse(body);
        for (const value of [parsed?.message_id, parsed?.messageId]) {
          if (isId(value)) return value;
        }
      } catch {}
    }
    return null;
  }

  function classify(url, contentType = "") {
    if (!url) return {capture: false, knownRoute: false};
    const path = url.pathname.toLowerCase();
    if (/(?:transcri(?:be|ption|ptions|bing)|upload|whisper)(?:[\/_-]|$)/.test(path)) return {capture: false, knownRoute: false};
    const knownRoute = /(?:^|\/)(?:synthesize|synthesis|read[_-]?aloud|speech)(?:[\/_-]|$)/.test(path);
    const audioRoute = /(?:^|\/)audio(?:\/|$)/.test(path);
    const audioMime = /^audio\//i.test(contentType.trim());
    return {capture: knownRoute || audioRoute || audioMime, knownRoute};
  }

  function metadata(url, messageId, knownRoute) {
    return {
      id: crypto.randomUUID(), url: url.pathname, messageId: messageId || null,
      knownRoute
    };
  }

  function postError(meta, error) {
    if (pageHidden || !meta?.knownRoute) return;
    const key = `${meta.url}:${error}`;
    const previous = recentErrors.get(key) || 0;
    if (Date.now() - previous < 5000) return;
    recentErrors.set(key, Date.now());
    if (recentErrors.size > 30) recentErrors.delete(recentErrors.keys().next().value);
    try {
      window.postMessage({
        source: "read-aloud-saver", type: "AUDIO_ERROR", id: meta.id,
        url: meta.url, messageId: meta.messageId, error
      }, location.origin);
    } catch {}
  }

  function ascii(bytes, offset, text) {
    if (offset + text.length > bytes.length) return false;
    for (let index = 0; index < text.length; index += 1) {
      if (bytes[offset + index] !== text.charCodeAt(index)) return false;
    }
    return true;
  }

  function audioFormat(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 4) return null;
    if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE")) return {mimeType: "audio/wav", extension: "wav"};
    if (ascii(bytes, 0, "fLaC")) return {mimeType: "audio/flac", extension: "flac"};
    if (ascii(bytes, 4, "ftyp") && bytes.length >= 12) return {mimeType: "audio/mp4", extension: "m4a"};
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return {mimeType: "audio/webm", extension: "webm"};
    if (ascii(bytes, 0, "OggS")) {
      for (let index = 28; index < Math.min(bytes.length - 7, 512); index += 1) {
        if (ascii(bytes, index, "OpusHead")) return {mimeType: "audio/ogg", extension: "ogg"};
      }
      return null;
    }
    if (ascii(bytes, 0, "ID3") && bytes.length >= 10) return {mimeType: "audio/mpeg", extension: "mp3"};
    if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0 && bytes.length >= 7) {
      const frequencyIndex = (bytes[2] >> 2) & 0x0f;
      if (frequencyIndex < 13) return {mimeType: "audio/aac", extension: "aac"};
    }
    if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
      const version = (bytes[1] >> 3) & 3;
      const layer = (bytes[1] >> 1) & 3;
      const bitrate = (bytes[2] >> 4) & 15;
      const frequency = (bytes[2] >> 2) & 3;
      if (version !== 1 && layer !== 0 && bitrate > 0 && bitrate < 15 && frequency !== 3) return {mimeType: "audio/mpeg", extension: "mp3"};
    }
    return null;
  }

  function postAudio(buffer, meta) {
    if (pageHidden) return;
    if (!buffer.byteLength) throw new Error("ChatGPT returned an empty audio file. Try Read Aloud again.");
    const format = audioFormat(buffer);
    if (!format) throw new Error("This response was not a supported audio file. Try Read Aloud again.");
    window.postMessage({
      source: "read-aloud-saver", type: "AUDIO_CAPTURED", id: meta.id,
      mimeType: format.mimeType, extension: format.extension,
      url: meta.url, messageId: meta.messageId, arrayBuffer: buffer
    }, location.origin, [buffer]);
  }

  function canCapture(meta, length) {
    if (pageHidden) return false;
    if (length > MAX_BYTES) {
      postError(meta, "This audio file is larger than the 64 MB capture limit.");
      return false;
    }
    if (jobs.size >= MAX_CONCURRENT) {
      postError(meta, "Two audio files are already being captured. Play this response again after they finish.");
      return false;
    }
    return true;
  }

  async function captureReader(reader, meta) {
    let timer;
    let abortReject;
    let aborted = false;
    const pieces = [];
    let total = 0;
    const abortPromise = new Promise((resolve, reject) => { abortReject = reject; });
    const job = {
      cancel(reason) {
        if (aborted) return;
        aborted = true;
        abortReject(new Error(reason));
        // A cloned fetch body is a tee. Awaiting cancellation could wait for
        // the original response too, so cancellation is intentionally detached.
        try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
      }
    };
    jobs.add(job);
    timer = setTimeout(() => job.cancel("Audio capture took longer than fifteen minutes. Try Read Aloud again."), TIMEOUT_MS);
    try {
      while (true) {
        const chunk = await Promise.race([reader.read(), abortPromise]);
        if (chunk.done) break;
        if (!chunk.value?.byteLength) continue;
        total += chunk.value.byteLength;
        if (total > MAX_BYTES) {
          job.cancel("This audio file is larger than the 64 MB capture limit.");
          throw new Error("This audio file is larger than the 64 MB capture limit.");
        }
        pieces.push(chunk.value);
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const piece of pieces) {
        merged.set(piece, offset);
        offset += piece.byteLength;
      }
      postAudio(merged.buffer, meta);
    } catch (error) {
      if (!pageHidden) postError(meta, error.message || "The audio could not be captured. Try Read Aloud again.");
    } finally {
      clearTimeout(timer);
      pieces.length = 0;
      jobs.delete(job);
      try { reader.releaseLock(); } catch {}
    }
  }

  function observeFetch(response, requestUrl, requestBody) {
    try {
      const url = safeUrl(response.url || requestUrl);
      const details = classify(url, response.headers.get("content-type") || "");
      if (!details.capture) return;
      const meta = metadata(url, messageIdFrom(url, requestBody) || messageIdFrom(safeUrl(requestUrl), requestBody), details.knownRoute);
      if (!response.ok) {
        postError(meta, `ChatGPT could not return the audio (HTTP ${response.status}). Try Read Aloud again.`);
        return;
      }
      if (!canCapture(meta, Number(response.headers.get("content-length")) || 0)) return;
      const clone = response.clone();
      if (!clone.body) {
        postError(meta, "ChatGPT returned no audio. Try Read Aloud again.");
        return;
      }
      // Detached consumption cannot reject or delay the native fetch promise.
      void captureReader(clone.body.getReader(), meta).catch(() => {});
    } catch {
      // A consumed/unclonable response must never break the page's request.
    }
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = new Proxy(originalFetch, {
      apply(target, thisArg, args) {
        const result = Reflect.apply(target, thisArg, args);
        let requestUrl = "";
        let requestBody;
        try {
          requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || String(args[0]);
          requestBody = args[1]?.body;
        } catch {}
        return result.then(response => {
          observeFetch(response, requestUrl, requestBody);
          return response;
        }, error => {
          try {
            const url = safeUrl(requestUrl);
            const details = classify(url);
            if (details.knownRoute) postError(metadata(url, messageIdFrom(url, requestBody), true), "ChatGPT could not load the audio. Try Read Aloud again.");
          } catch {}
          throw error;
        });
      }
    });
  }

  function observeXhr(xhr, request) {
    try {
      const url = safeUrl(xhr.responseURL || request.url);
      const details = classify(url, xhr.getResponseHeader("content-type") || "");
      if (!details.capture) return;
      const meta = metadata(url, messageIdFrom(url) || request.messageId, details.knownRoute);
      if (xhr.status < 200 || xhr.status >= 300) {
        postError(meta, "ChatGPT could not load the audio. Try Read Aloud again.");
        return;
      }
      const body = xhr.response;
      if (xhr.responseType === "arraybuffer" && body instanceof ArrayBuffer) {
        if (canCapture(meta, body.byteLength)) {
          try { postAudio(body.slice(0), meta); }
          catch (error) { postError(meta, error.message || "The audio could not be captured. Try Read Aloud again."); }
        }
      } else if (xhr.responseType === "blob" && body instanceof Blob) {
        if (canCapture(meta, body.size)) void captureReader(body.stream().getReader(), meta).catch(() => {});
      } else if (details.knownRoute) {
        postError(meta, "This audio response could not be saved directly. Try playing Read Aloud again.");
      }
    } catch {
      // Leave the original XHR and its events untouched even if observation fails.
    }
  }

  if (window.XMLHttpRequest?.prototype) {
    const prototype = window.XMLHttpRequest.prototype;
    const originalOpen = prototype.open;
    const originalSend = prototype.send;
    prototype.open = new Proxy(originalOpen, {
      apply(target, thisArg, args) {
        const result = Reflect.apply(target, thisArg, args);
        try { xhrDetails.set(thisArg, {url: String(args[1]), messageId: null}); } catch {}
        return result;
      }
    });
    prototype.send = new Proxy(originalSend, {
      apply(target, thisArg, args) {
        const request = xhrDetails.get(thisArg);
        if (request) {
          request.messageId = messageIdFrom(safeUrl(request.url), args[0]);
          thisArg.addEventListener("loadend", () => observeXhr(thisArg, request), {once: true});
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
  }

  window.addEventListener("pagehide", () => {
    pageHidden = true;
    for (const job of jobs) job.cancel("The page was closed before audio capture finished.");
    recentErrors.clear();
  });
  // Keep the single installed hook useful after back/forward cache restoration.
  window.addEventListener("pageshow", () => { pageHidden = false; });
})();
