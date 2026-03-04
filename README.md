# Tabarchive

Tab archiver for Firefox. Extension plus native host.

## Dev
Run `npm --prefix extension run dev` for dev build. Run
`npm --prefix extension run build` for prod build. Run
`npm --prefix extension test` plus `python3 -m pytest native/tests -q` for
tests.

## Local Install
Run `native/install.sh`. Then load `extension/dist/manifest.json` as temporary
Firefox add-on.

## Layout
`extension/` contains add-on code. `native/` contains host code.

## Data
Archive DB lives at `~/.tabarchive/`. Upgrading extension keeps DB.
