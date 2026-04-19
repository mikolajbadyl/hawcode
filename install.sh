#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${HOME}/.local/share/hawcode"
BIN_DIR="${HOME}/.local/bin"
BINARY_NAME="hawcode"

echo "Building..."
bun run build

echo "Installing to ${APP_DIR}..."
mkdir -p "${APP_DIR}"
mkdir -p "${BIN_DIR}"

# Copy everything from dist to APP_DIR
# Use cp -r to ensure directories like theme/ and assets/ are copied
cp -r dist/* "${APP_DIR}/"

echo "Creating symlink in ${BIN_DIR}/${BINARY_NAME}..."
ln -sf "${APP_DIR}/${BINARY_NAME}" "${BIN_DIR}/${BINARY_NAME}"

echo "Done. Make sure ${BIN_DIR} is in your PATH."
echo "  Add to ~/.bashrc or ~/.zshrc if needed:"
echo "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
