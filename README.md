# Tabarchive

Tab archiver for Firefox, Chrome, and Chromium. Extension plus native host.

## Dev
All commands run from `extension/`. Build with `npm run dev` (development),
`npm run build` (Firefox production), or `npm run build:chromium`
(Chrome/Chromium production). Test with `npm test` and
`python3 -m pytest native/tests -q`.

## Local Install
For Firefox, run `native/install.sh --browser firefox`, then load
`extension/dist/manifest.json` as temporary add-on.

For Chrome/Chromium, load `extension/dist` as unpacked extension, copy extension
ID, then run `native/install.sh --browser chrome --extension-id <id>`. Use
`--browser chromium` or `--browser chrome-for-testing` for those channels.

## Layout
`extension/` holds the add-on. `native/` holds the host.

## Data
The archive database lives at `~/.tabarchive/`. Upgrading the extension preserves it.
