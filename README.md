# X Unfollowers 🐦

> See who doesn't follow you back on X (Twitter) — browser-based, no API keys, no installs.

Inspired by [InstagramUnfollowers](https://github.com/davidarroyo1234/InstagramUnfollowers) by davidarroyo1234.

## 🚀 Usage

### Desktop
1. Copy the script from **[YOUR_USERNAME.github.io/x-unfollowers](https://YOUR_USERNAME.github.io/x-unfollowers)**
2. Go to **x.com** and log in to your account
3. Open the browser console:
   - Windows: `Ctrl + Shift + J`
   - Mac: `⌘ + Option + J`
4. Paste the code and press **Enter**
5. A panel appears — click **SCAN**
6. See who's not following you back 👀

### Mobile (Android)
1. Download [Kiwi Browser](https://kiwibrowser.com/) (supports DevTools on Android)
2. Open x.com and log in
3. Open the console via the menu → DevTools
4. Follow the same steps as desktop

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔍 Full scan | Paginates through all your following/followers automatically |
| 🤍 Whitelist | Click any avatar to protect accounts from the list. Persists between sessions via `localStorage` |
| 🔎 Search & filter | Filter by "not following back" or "whitelisted", search by name or @handle |
| 🌙 Dark mode | Automatically matches X's dark/light theme |
| 🚦 Rate-limit safe | Adds delays between API calls, auto-retries on 429 errors |
| 🔒 Zero data leak | Script only talks to `api.twitter.com` using your existing session |

---

## 🔒 Privacy

This script runs **entirely in your browser**. It uses X's internal API the same way the X website does — authenticated with your existing session cookies. **No data is sent to any third-party server.**

Whitelist data is stored in your browser's `localStorage` under the key `xuf_whitelist`.

---

## 🛠️ Development

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/x-unfollowers.git
cd x-unfollowers

# Edit the source
# Main script: src/main.js

# Build dist/bundle.js (requires Python 3)
python3 build.py

# Serve locally for testing
python3 -m http.server 8080
# Open http://localhost:8080
```

### Project structure

```
x-unfollowers/
├── index.html        ← GitHub Pages site (copy button)
├── src/
│   └── main.js       ← Source script (readable)
├── dist/
│   └── bundle.js     ← Built script (pasted in console)
├── build.py          ← Build script
└── README.md
```

---

## ⚠️ Notes

- Processing time scales with the number of accounts you follow
- X's free API tier rate-limits at ~15 req/15 min — the script handles this automatically
- Tested on Chrome and Firefox (Chromium-based browsers recommended)
- If the panel doesn't appear, make sure you're on x.com (not a sub-page)

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

*Not affiliated with X Corp / Twitter.*
