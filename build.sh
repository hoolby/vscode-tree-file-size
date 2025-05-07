#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting build process for Tree File Size extension..."

# Check if vsce is installed
if ! command -v vsce &> /dev/null; then
    echo "📦 Installing vsce globally..."
    npm install -g @vscode/vsce
fi

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf out/
rm -f *.vsix

# Install dependencies
echo "📥 Installing dependencies..."
npm install

# Compile TypeScript
echo "🔨 Compiling TypeScript..."
npm run compile

# Package extension
echo "📦 Packaging extension..."
vsce package --allow-missing-repository

# Check if packaging was successful
if [ -f *.vsix ]; then
    echo "✅ Build completed successfully!"
    echo "📦 Extension package: $(ls *.vsix)"
    echo ""
    echo "To install the extension:"
    echo "1. Open VS Code"
    echo "2. Press Ctrl+Shift+X to open Extensions view"
    echo "3. Click on the '...' menu at the top"
    echo "4. Select 'Install from VSIX...'"
    echo "5. Select the .vsix file that was just created"
else
    echo "❌ Build failed - no .vsix file was created"
    exit 1
fi 