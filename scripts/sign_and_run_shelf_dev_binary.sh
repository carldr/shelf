#!/bin/sh
# Cargo runs this in place of each binary it starts, which includes the app under `pnpm tauri dev`.
# It signs the binary with the identity and identifier in src-tauri/tauri.local.conf.json, then starts it.
# A stable signature lets the Keychain keep "Always Allow" across rebuilds. Without the local settings,
# the binary keeps its ad-hoc signature, and the Keychain asks again after each rebuild.
set -eu

shelf_binary_path="$1"
shift
tauri_local_config_path="$(dirname "$0")/../src-tauri/tauri.local.conf.json"

if codesign_identity=$(plutil -extract bundle.macOS.signingIdentity raw -o - "$tauri_local_config_path" 2>/dev/null) &&
  bundle_identifier=$(plutil -extract identifier raw -o - "$tauri_local_config_path" 2>/dev/null); then
  codesign --force --sign "$codesign_identity" --identifier "$bundle_identifier" "$shelf_binary_path" 2>/dev/null ||
    echo "sign_and_run_shelf_dev_binary.sh: codesign failed; the binary keeps its ad-hoc signature." >&2
fi

exec "$shelf_binary_path" "$@"
