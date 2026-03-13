#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ACTIONLINT_VERSION="${ACTIONLINT_VERSION:-1.7.11}"
BIN_DIR="${ROOT_DIR}/.tmp/actionlint/${ACTIONLINT_VERSION}"
BIN_PATH="${BIN_DIR}/actionlint"
DOWNLOAD_SCRIPT="${BIN_DIR}/download-actionlint.bash"

mkdir -p "${BIN_DIR}"

if [[ ! -x "${BIN_PATH}" ]]; then
  curl -fsSL \
    "https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash" \
    -o "${DOWNLOAD_SCRIPT}"
  bash "${DOWNLOAD_SCRIPT}" "${ACTIONLINT_VERSION}" "${BIN_DIR}"
fi

"${BIN_PATH}" "$@"
