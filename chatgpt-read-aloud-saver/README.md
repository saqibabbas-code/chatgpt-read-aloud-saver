# ChatGPT Read Aloud Saver

**For Chromium-based desktop browsers · by [saqibabbas-code](https://github.com/saqibabbas-code)**

An extension that adds a preview and download panel when ChatGPT supplies Read Aloud audio. Save the supplied file, or convert it locally to MP3 or WAV. No API key, microphone, subscription, or external conversion service is used by this extension.

## Install on your computer

1. If you downloaded the ZIP, right-click it in File Explorer and choose **Extract All**. Keep the extracted folder somewhere permanent.
2. Open your browser’s extensions page: `chrome://extensions` (Chrome), `edge://extensions` (Edge), or `brave://extensions` (Brave).
3. Turn on **Developer mode**, then click **Load unpacked**.
4. Select the **chatgpt-read-aloud-saver** folder containing `manifest.json`. Do not select the ZIP or its outer folder.
5. Refresh any ChatGPT tabs already open. You can pin **ChatGPT Read Aloud Saver** from your browser's extensions menu.

For a visual walkthrough, open [INSTALL.html](INSTALL.html). Select the folder directly containing `manifest.json`.

## Save a response

1. Open the response you want on `https://chatgpt.com` in your browser.
2. Use ChatGPT's **Read Aloud** control for that response.
3. When the audio file finishes loading, a **ChatGPT Read Aloud Saver** player appears at the bottom right. Choose **MP3**, **WAV**, or **Original audio**, then click **Save audio**.
4. Find the file in your browser's Downloads, or the folder selected in your browser's download settings. You can then copy it to your phone.

The toolbar popup also lists captured files. If you hide the player, use **Show player in ChatGPT** in the popup to bring it back.

The extension waits for the complete audio response to arrive. You do not need to leave its popup open or manually record playback. Availability depends on when ChatGPT finishes sending the audio; it is not guaranteed to be instant. It uses the voice supplied for that Read Aloud response. This version has no independent voice selector, bulk download, or combined-file export.

## Seven- to eight-minute audio

The loading timeout is **15 minutes**, giving an eight-minute response time to arrive even if delivery is slow. This timeout measures loading time, not the duration of the saved audio. The file must fit the size limits below. An eight-minute MP3 at 128 kbps is approximately **7.7 MB**.

This extension saves audio ChatGPT actually supplies. It cannot extend or repair a response that ChatGPT itself stops generating early.

## Formats

- **Original audio** preserves the received bytes. The actual container determines the extension: AAC, M4A, MP3, OGG/Opus, WebM, WAV, or FLAC. It does not rename one format to another.
- **MP3** converts audio locally at 128 kbps using the bundled encoder. An original MP3 is saved directly without re-encoding.
- **WAV** creates an uncompressed 16-bit PCM audio file and is usually much larger.

Conversion depends on your browser being able to decode the supplied format. If conversion fails, choose **Original audio**. Changing playback speed in the preview does not change the exported file's speed.

## Limits and troubleshooting

- Keep the ChatGPT tab open until you download. Refreshing or closing it clears captured clips.
- The most recent five clips are retained, with a 64 MiB individual limit and a 128 MiB total cache limit.
- Two audio files can load at once. A capture exceeding 15 minutes stops without interrupting ChatGPT's original playback.
- Conversion is refused when decoded PCM16 audio would exceed 128 MiB; download the original instead.
- This is designed for Chromium-based **desktop** browsers such as Chrome, Edge, and Brave. It does not add controls to the ChatGPT mobile app or record live Voice Mode calls.

**No player appears:** Refresh ChatGPT after installation, then play Read Aloud on a short response. The extension captures future audio responses. ChatGPT may have cached already-played audio, changed delivery, or used a worker/cross-origin route this version cannot observe.

**Conversion fails:** Choose Original audio. Some browser/codec combinations cannot decode every supplied format.

**No download appears:** Check your browser's Downloads and any download-blocked indicator. Try the on-page player again. The clip remains available until it is evicted or the tab reloads.

**Extension cannot load:** Choose the folder directly containing `manifest.json` and use a current Chromium-based desktop browser.

## Privacy

The extension runs only on `chatgpt.com` and `chat.openai.com`. Site access lets it observe audio responses and show its player. The `activeTab` permission lets the popup communicate with the current ChatGPT tab. No microphone, cookies, browsing-history, downloads-history, or account-token permission is requested.

The audio capture and conversion code makes no network requests of its own. It copies existing audio responses inside the page, checks supported audio signatures, and keeps them in that tab's memory. Files download only after a save control is clicked. ChatGPT itself still makes its normal network requests. Opening a GitHub or other external link navigates to that website; those links do not upload captured audio.

ChatGPT Read Aloud Saver is an independent community extension by **saqibabbas-code**. It is not affiliated with or endorsed by OpenAI or any browser vendor.

## Verification and source

Automated smoke checks cover capture, downloads and conversion using simulated browser APIs; the bundled MP3 encoder is tested directly. Live signed-in ChatGPT capture in Chrome, Edge, Brave, or other browsers has not been verified. Compatibility may change if ChatGPT changes audio delivery.

All extension source is included. MP3 encoding uses unmodified **lamejs 1.2.1**. Its license, attribution, and complete source package are in `vendor/`. Machine-specific paths in one upstream sample test were replaced with relative paths; the runtime encoder is unchanged. See `vendor/NOTICE.txt`.

## Maintainer

GitHub: [saqibabbas-code](https://github.com/saqibabbas-code). Repository: [chatgpt-read-aloud-saver](https://github.com/saqibabbas-code/chatgpt-read-aloud-saver).

## References

[Brave extension support](https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave), [Chromium content scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts), [audio decoding](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData), [lamejs](https://github.com/zhuker/lamejs).

## Browser support

Designed for desktop Chromium browsers, including Chrome, Edge and Brave. Other Chromium browsers require compatible extension support. Firefox and Safari are not supported by this package. Live signed-in capture has not been verified in these browsers.
