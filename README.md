# Tabarchive

Tab archiver for Firefox, Chrome, and Chromium. Extension plus native host.

## Dev
Run `npm --prefix extension run dev` for dev build. Run
`npm --prefix extension run build` for Firefox prod build. Run
`npm --prefix extension run build:chromium` for Chrome/Chromium prod build. Run
`npm --prefix extension test` plus `python3 -m pytest native/tests -q` for
tests.

## Local Install
For Firefox, run `native/install.sh --browser firefox`, then load
`extension/dist/manifest.json` as temporary add-on.

For Chrome/Chromium, load `extension/dist` as unpacked extension, copy extension
ID, then run `native/install.sh --browser chrome --extension-id <id>`. Use
`--browser chromium` or `--browser chrome-for-testing` for those channels.

## Layout
`extension/` contains add-on code. `native/` contains host code.

## Data
Archive DB lives at `~/.tabarchive/`. Upgrading extension keeps DB.
