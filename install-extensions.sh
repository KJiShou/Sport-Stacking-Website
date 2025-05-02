#!/bin/bash

# List of extensions to install
extensions=(
    "dbaeumer.vscode-eslint"
    "esbenp.prettier-vscode"
    "aaron-bond.better-comments"
    "usernamehw.errorlens"
    "formulahendry.auto-close-tag"
    "formulahendry.auto-rename-tag"
    "ms-vscode.atom-keybindings"
    "streetsidesoftware.code-spell-checker"
    "christian-kohler.path-intellisense"
    "PKief.material-icon-theme"
    "wix.vscode-import-cost"
    "dsznajder.es7-react-js-snippets"
    "eamodio.gitlens"
    "SonarSource.sonarlint-vscode"
)

# Install each extension
for extension in "${extensions[@]}"
do
    echo "Installing $extension..."
done

echo "All extensions have been installed!"
