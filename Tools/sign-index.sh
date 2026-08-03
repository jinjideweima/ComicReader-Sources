#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPOSITORY_ROOT=${SCRIPT_DIR:h}
KEYCHAIN_SERVICE=com.jinjideweima.ComicReaderSources.signing

private_key=$(security find-generic-password \
  -a jinjideweima \
  -s "$KEYCHAIN_SERVICE" \
  -w)

COMICREADER_SOURCE_SIGNING_KEY="$private_key" \
  swift "$REPOSITORY_ROOT/Tools/sign_index.swift"

