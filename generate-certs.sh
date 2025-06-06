#!/bin/bash
set -e
CERT_DIR="./certs"
KEY_FILE="$CERT_DIR/key.pem"
CERT_FILE="$CERT_DIR/cert.pem"

if ! [ -x "$(command -v openssl)" ]; then
  echo "Error: openssl is not installed. Please install it to generate certificates." >&2
  exit 1
fi

mkdir -p "$CERT_DIR"
openssl req \
  -x509 \
  -newkey rsa:2048 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -days 3650 \
  -nodes \
  -subj "/C=US/ST=Local/L=Local/O=Local Dev/CN=localhost"

echo "✅ Certificates successfully generated in '$CERT_DIR/'"
