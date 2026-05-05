# Sound Switcher

Switch macOS input and output sound devices together, or control them separately from Raycast.

## Requirements

This extension uses `SwitchAudioSource` to read and change macOS sound devices.

Install it with Homebrew:

```sh
brew install switchaudio-osx
```

The extension checks the current `PATH`, `/opt/homebrew/bin`, and `/usr/local/bin` for the `SwitchAudioSource` binary.

## Usage

Open **Sound Switcher** in Raycast to see:

- **Unified Devices**: matched input and output devices that can be switched together.
- **Outputs**: all output devices.
- **Inputs**: all input devices.

The current device in each section is shown with a green check mark. Devices are cached from the last run so the list opens quickly, then refreshes in the background.

## Troubleshooting

If Raycast says `SwitchAudioSource is not installed`, confirm the binary is available:

```sh
which SwitchAudioSource
SwitchAudioSource -a -t output
SwitchAudioSource -a -t input
```

If Homebrew installed `SwitchAudioSource` somewhere else, make sure that directory is available in the environment Raycast uses.
