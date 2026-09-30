(() => {
  'use strict';
  if (globalThis.__readAloudSaverContent) return;
  globalThis.__readAloudSaverContent = true;

  const MAX_CLIP_BYTES = 64 * 1024 * 1024;
  const MAX_CACHE_BYTES = 128 * 1024 * 1024;
  const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
  const clips = [];
  let lastError = '';
  let host;
  let shadow;
  let currentId;
  let busy = false;
  let panelHidden = false;
  let sequence = 0;
  const mp3Available = () => typeof globalThis.lamejs?.Mp3Encoder === 'function';

  function detectFormat(buffer) {
    const bytes = new Uint8Array(buffer);
    const text = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
    if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE') return { mimeType: 'audio/wav', extension: 'wav' };
    if (bytes.length >= 12 && text(4, 4) === 'ftyp') return { mimeType: 'audio/mp4', extension: 'm4a' };
    if (bytes.length >= 27 && text(0, 4) === 'OggS') return { mimeType: 'audio/ogg', extension: 'ogg' };
    if (bytes.length >= 4 && text(0, 4) === 'fLaC') return { mimeType: 'audio/flac', extension: 'flac' };
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { mimeType: 'audio/webm', extension: 'webm' };
    if (bytes.length >= 10 && text(0, 3) === 'ID3') return { mimeType: 'audio/mpeg', extension: 'mp3' };
    if (bytes.length >= 7 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0 && ((bytes[2] >> 2) & 0x0f) < 13) return { mimeType: 'audio/aac', extension: 'aac' };
    if (bytes.length >= 4 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0 && (bytes[2] & 0xf0) !== 0 && (bytes[2] & 0xf0) !== 0xf0 && (bytes[2] & 0x0c) !== 0x0c) return { mimeType: 'audio/mpeg', extension: 'mp3' };
    return null;
  }

  const sizeLabel = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const publicClip = clip => ({ id: clip.id, filename: clip.filename, bytes: clip.blob.size, mimeType: clip.mimeType, extension: clip.extension });
  const state = () => ({ available: clips.length > 0, clips: [...clips].reverse().map(publicClip), error: lastError || undefined, busy, canConvertMp3: mp3Available() });

  function node(tag, attributes = {}, text) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createPanel() {
    if (host) return;
    host = node('div', { id: 'read-aloud-saver-panel-host' });
    // Styling the host directly makes the panel independent of page CSS.
    host.style.cssText = 'all:initial!important;position:fixed!important;right:20px!important;bottom:20px!important;z-index:2147483646!important;width:320px!important;max-width:calc(100vw - 24px)!important;display:block!important;';
    shadow = host.attachShadow({ mode: 'closed' });
    const stylesheet = node('link', { rel: 'stylesheet', href: chrome.runtime.getURL('content.css') });
    shadow.append(stylesheet);
    const section = node('section', { class: 'panel', 'aria-label': 'ChatGPT Read Aloud Saver' });
    const header = node('div', { class: 'header' });
    header.append(node('span', { class: 'mark', 'aria-hidden': 'true' }, '↓'));
    const title = node('div', { class: 'titles' });
    title.append(node('strong', {}, 'ChatGPT Read Aloud Saver'), node('span', {}, 'Audio from this chat'));
    const dismiss = node('button', { class: 'dismiss', type: 'button', 'aria-label': 'Hide audio panel', title: 'Hide panel; audio stays available in the extension' }, '×');
    dismiss.addEventListener('click', () => { panelHidden = true; host.style.setProperty('display', 'none', 'important'); });
    header.append(title, dismiss);
    section.append(header, node('p', { id: 'ras-status', role: 'status', 'aria-live': 'polite' }));
    const clipSelect = node('select', { id: 'ras-clips', 'aria-label': 'Captured audio' });
    clipSelect.addEventListener('change', () => { currentId = clipSelect.value; updatePanel(); });
    section.append(clipSelect);
    const player = node('audio', { id: 'ras-player', controls: '', preload: 'none', 'aria-label': 'Preview captured audio' });
    section.append(player);
    const row = node('div', { class: 'download-row' });
    const format = node('select', { id: 'ras-format', 'aria-label': 'Download format' });
    format.append(node('option', { value: 'original' }, 'Original audio'), node('option', { value: 'wav' }, 'WAV'));
    if (mp3Available()) format.append(node('option', { value: 'mp3' }, 'MP3'));
    const download = node('button', { id: 'ras-download', type: 'button' }, 'Save audio');
    download.addEventListener('click', async () => {
      const result = await downloadClip(currentId, format.value);
      if (!result.ok) showError(result.error);
    });
    row.append(format, download);
    section.append(row, node('p', { class: 'footnote' }, 'Saved locally. Captured clips clear when this tab reloads.'));
    shadow.append(section);
    (document.body || document.documentElement).append(host);
  }

  function updatePanel() {
    createPanel();
    if (!panelHidden) host.style.setProperty('display', 'block', 'important');
    const current = clips.find(clip => clip.id === currentId) || clips.at(-1);
    currentId = current?.id;
    const status = shadow.getElementById('ras-status');
    status.textContent = busy ? 'Preparing your audio file…' : lastError || (current ? `Read Aloud audio ready · ${current.extension.toUpperCase()} · ${sizeLabel(current.blob.size)}` : 'Play Read Aloud to capture the audio.');
    status.className = lastError ? 'error' : '';
    const select = shadow.getElementById('ras-clips');
    select.replaceChildren(...[...clips].reverse().map(clip => node('option', { value: clip.id }, `${clip.filename} · ${sizeLabel(clip.blob.size)}`)));
    select.value = currentId || '';
    select.hidden = clips.length < 2;
    select.disabled = busy;
    const player = shadow.getElementById('ras-player');
    player.hidden = !current;
    if (current && player.getAttribute('src') !== current.url) player.src = current.url;
    shadow.getElementById('ras-format').disabled = busy || !current;
    shadow.getElementById('ras-download').disabled = busy || !current;
  }

  function showError(error) {
    lastError = String(error || 'The audio could not be saved. Please play Read Aloud again.').slice(0, 350);
    panelHidden = false;
    updatePanel();
  }

  function capture(message) {
    const buffer = message.arrayBuffer;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4 || buffer.byteLength > MAX_CLIP_BYTES) {
      showError('This audio is empty or too large. Try a shorter Read Aloud response.');
      return;
    }
    const format = detectFormat(buffer);
    if (!format) { showError('This response did not contain a supported audio file. Try Read Aloud again.'); return; }
    const id = typeof message.id === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(message.id) ? message.id : `audio-${Date.now()}-${++sequence}`;
    if (clips.some(clip => clip.id === id)) return;
    while (clips.length >= 5 || clips.reduce((total, clip) => total + clip.blob.size, 0) + buffer.byteLength > MAX_CACHE_BYTES) {
      const removed = clips.shift();
      if (!removed) break;
      URL.revokeObjectURL(removed.url);
    }
    const blob = new Blob([buffer], { type: format.mimeType });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ChatGPT-Read-Aloud-${stamp}-${++sequence}.${format.extension}`;
    clips.push({ id, filename, blob, url: URL.createObjectURL(blob), ...format });
    currentId = id;
    lastError = '';
    panelHidden = false;
    updatePanel();
  }

  async function decode(clip) {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Audio conversion is unavailable in this browser. Download the original audio instead.');
    const context = new AudioContextClass();
    try {
      const audio = await context.decodeAudioData(await clip.blob.arrayBuffer());
      if (!audio.length || audio.numberOfChannels < 1 || audio.numberOfChannels > 2) throw new Error('This audio cannot be converted here. Download the original audio instead.');
      if (audio.length * audio.numberOfChannels * 2 + 44 > MAX_OUTPUT_BYTES) throw new Error('This recording is too long to convert in this tab. Download the original audio instead.');
      return audio;
    } catch (error) {
      if (/Download the original/.test(error.message)) throw error;
      throw new Error('Your browser could not decode this audio for conversion. Download the original audio instead.');
    } finally { await context.close().catch(() => {}); }
  }

  function pcm16(sample) {
    const value = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    return Math.round(value < 0 ? value * 0x8000 : value * 0x7fff);
  }

  async function encodeWav(audio) {
    const channels = audio.numberOfChannels;
    const dataBytes = audio.length * channels * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, dataBytes, true);
    const samples = Array.from({ length: channels }, (_, channel) => audio.getChannelData(channel));
    let offset = 44;
    for (let sample = 0; sample < audio.length; sample++) {
      for (let channel = 0; channel < channels; channel++) { view.setInt16(offset, pcm16(samples[channel][sample]), true); offset += 2; }
      if (sample > 0 && sample % 262144 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function encodeMp3(audio) {
    if (!mp3Available()) throw new Error('MP3 conversion is unavailable. Choose original audio or WAV.');
    const channels = audio.numberOfChannels;
    const encoder = new globalThis.lamejs.Mp3Encoder(channels, audio.sampleRate, 128);
    const samples = Array.from({ length: channels }, (_, channel) => audio.getChannelData(channel));
    const chunks = [];
    let totalBytes = 0;
    for (let start = 0, block = 0; start < audio.length; start += 1152, block++) {
      const count = Math.min(1152, audio.length - start);
      const input = samples.map(channel => {
        const data = new Int16Array(count);
        for (let i = 0; i < count; i++) data[i] = pcm16(channel[start + i]);
        return data;
      });
      const output = encoder.encodeBuffer(input[0], input[1]);
      if (output.length) { chunks.push(new Uint8Array(output)); totalBytes += output.length; }
      if (totalBytes > MAX_OUTPUT_BYTES) throw new Error('The converted file is too large. Download the original audio instead.');
      if (block % 64 === 63) await new Promise(resolve => setTimeout(resolve, 0));
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(new Uint8Array(tail));
    return new Blob(chunks, { type: 'audio/mpeg' });
  }

  function saveBlob(blob, filename, originalUrl) {
    const url = originalUrl || URL.createObjectURL(blob);
    const anchor = node('a', { href: url, download: filename });
    anchor.style.display = 'none';
    (document.body || document.documentElement).append(anchor);
    anchor.click();
    anchor.remove();
    // The browser needs time to begin reading a converted Blob URL.
    if (!originalUrl) setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function downloadClip(id, format = 'original') {
    if (busy) return { ok: false, error: 'An audio file is already being prepared. Please wait.' };
    const clip = id ? clips.find(item => item.id === id) : clips.at(-1);
    if (!clip) return { ok: false, error: 'Play Read Aloud for a response first, then download its audio.' };
    if (!['original', 'wav', 'mp3'].includes(format)) return { ok: false, error: 'Choose original audio, WAV, or MP3.' };
    busy = true;
    lastError = '';
    updatePanel();
    try {
      if (format === 'original' || format === clip.extension) {
        saveBlob(clip.blob, clip.filename, clip.url);
      } else {
        const audio = await decode(clip);
        const blob = format === 'wav' ? await encodeWav(audio) : await encodeMp3(audio);
        saveBlob(blob, clip.filename.replace(/\.[^.]+$/, `.${format}`));
      }
      return { ok: true };
    } catch (error) {
      lastError = error.message || 'The audio could not be saved. Try downloading the original audio.';
      return { ok: false, error: lastError };
    } finally { busy = false; updatePanel(); }
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== 'read-aloud-saver') return;
    if (message.type === 'AUDIO_CAPTURED') capture(message);
    else if (message.type === 'AUDIO_ERROR' || message.type === 'AUDIO_CAPTURE_ERROR') showError(message.error);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.type === 'GET_AUDIO_STATE') { sendResponse(state()); return false; }
    if (message?.type === 'DOWNLOAD_AUDIO') {
      downloadClip(message.id, message.format || 'original').then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === 'SHOW_AUDIO_PANEL') { panelHidden = false; updatePanel(); sendResponse({ ok: true }); return false; }
    return false;
  });
})();
