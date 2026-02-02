# Env Masker

A VS Code extension that specifically masks values in `.env` files to prevent accidental exposure during screen sharing or streaming.

<img width="583" height="202" alt="image" src="https://github.com/user-attachments/assets/8964f857-ef42-45d3-a531-f3f42fac7795" />

## Features

- **Automatic Masking**: Automatically detects `.env` files and masks values after the `=` sign.
- **Discord-Style Spoilers**: 
  - Values are hidden by default.
  - **Click to Reveal**: Click on a masked value to reveal it.
  - **Persistent**: Once revealed, it stays visible until you close the file or use the "Hide All" command.
- **Toggle Control**: Enable/Disable globally via commands.

## Usage

- **Activate**: Open any `.env`, `.properties`, or `plaintext` file that looks like an environment file.
- **Toggle**: Use `Ctrl+Shift+P` -> `Env Masker: Toggle Masking`.
- **Hide All**: Use `Ctrl+Shift+P` -> `Env Masker: Hide All` to re-mask revealed values.

## Installation

1. Download the `.vsix` file from [here](https://github.com/hqnseung/env-masker/releases/)
2. In VS Code, go to Extensions -> `...` (Views and More Actions) -> `Install from VSIX...`
3. Select the file.
