'use strict';

const ui = Object.fromEntries(['dot', 'status', 'headline', 'hint', 'download-area', 'clip', 'format', 'size', 'download', 'show-panel', 'message'].map(id => [id, document.getElementById(id)]));
let tabId = null;
let clips = [];
let pending = false;
let polling = false;
let revision = 0;
let transientMessage = '';

function message(text, error = false) {
  ui.message.textContent = text || '';
  ui.message.hidden = !text;
  ui.message.classList.toggle('error', error);
}

function updateSize() {
  const clip = clips.find(item => item.id === ui.clip.value);
  ui.size.textContent = clip ? `${(clip.bytes / 1024 / 1024).toFixed(2)} MB original` : '';
}

function render(state) {
  clips = state.clips || [];
  const hasAudio = state.available && clips.length > 0;
  const selected = ui.clip.value;
  const lastFirst = ui.clip.options[0]?.value;
  ui.clip.replaceChildren(...clips.map((clip, index) => {
    const option = document.createElement('option');
    option.value = clip.id;
    option.textContent = `${index === 0 ? 'Latest · ' : ''}${clip.filename}`;
    return option;
  }));
  if (clips.some(clip => clip.id === selected) && lastFirst === clips[0]?.id) ui.clip.value = selected;
  const mp3Option = ui.format.querySelector('option[value="mp3"]');
  mp3Option.disabled = !state.canConvertMp3;
  if (!state.canConvertMp3 && ui.format.value === 'mp3') ui.format.value = 'original';
  ui['download-area'].hidden = !hasAudio;
  ui.dot.classList.toggle('ready', hasAudio);
  ui.status.textContent = state.busy ? 'Preparing your audio…' : hasAudio ? 'Audio file ready' : 'Waiting for Read Aloud';
  ui.headline.textContent = hasAudio ? 'Ready to keep.' : 'Play it. Keep it.';
  ui.hint.textContent = hasAudio ? 'Save the original audio, or convert it to MP3 on your computer.' : 'Choose Read Aloud on a response. A Save audio player will appear when its file is ready.';
  for (const control of [ui.clip, ui.format, ui.download, ui['show-panel']]) control.disabled = pending || state.busy;
  ui.download.textContent = pending || state.busy ? 'Preparing audio…' : '↓ Save audio';
  if (state.error) message(state.error, true);
  else if (transientMessage) message(transientMessage);
  else message('');
  updateSize();
}

async function request(type, extra = {}) {
  return chrome.tabs.sendMessage(tabId, { type, ...extra });
}

async function refresh() {
  if (polling || pending || tabId === null) return;
  polling = true;
  const requestRevision = revision;
  try {
    const state = await request('GET_AUDIO_STATE');
    if (pending || requestRevision !== revision) return;
    if (!state) throw new Error('No response');
    render(state);
  } catch {
    if (pending || requestRevision !== revision) return;
    ui.status.textContent = 'Refresh ChatGPT to connect';
    ui['download-area'].hidden = true;
    ui.dot.classList.remove('ready');
    message('Refresh the ChatGPT tab once after installing this extension, then play Read Aloud again.');
  } finally { polling = false; }
}

async function act(type) {
  if (pending || tabId === null) return;
  pending = true;
  revision += 1;
  transientMessage = '';
  ui.download.disabled = true;
  ui['show-panel'].disabled = true;
  ui.format.disabled = true;
  ui.clip.disabled = true;
  ui.download.textContent = type === 'DOWNLOAD_AUDIO' ? 'Preparing audio…' : 'Opening player…';
  message('');
  try {
    const result = await request(type, { id: ui.clip.value, format: ui.format.value });
    if (!result?.ok) throw new Error(result?.error || 'Could not save this audio. Try the player inside ChatGPT.');
    transientMessage = type === 'DOWNLOAD_AUDIO' ? 'Download requested. Check your browser’s Downloads for your audio file.' : 'The player is now visible in your ChatGPT tab.';
  } catch (error) {
    transientMessage = error.message;
    message(error.message, true);
  } finally { pending = false; await refresh(); }
}

ui.clip.addEventListener('change', updateSize);
ui.download.addEventListener('click', () => act('DOWNLOAD_AUDIO'));
ui['show-panel'].addEventListener('click', () => act('SHOW_AUDIO_PANEL'));

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url || 'about:blank');
    if (url.protocol !== 'https:' || !['chatgpt.com', 'chat.openai.com'].includes(url.hostname)) {
      ui.status.textContent = 'Open ChatGPT to begin';
      ui.hint.textContent = 'Use this extension in your ChatGPT tab, then play Read Aloud on the response you want to keep.';
      return;
    }
    tabId = tab.id;
    await refresh();
  } catch { message('Open a ChatGPT conversation, then reopen this extension.', true); }
})();
const interval = setInterval(refresh, 1500);
window.addEventListener('pagehide', () => clearInterval(interval));
