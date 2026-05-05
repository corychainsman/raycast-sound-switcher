import { Action, ActionPanel, closeMainWindow, Color, Icon, List, LocalStorage, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import {
  AudioDeviceState,
  DeviceType,
  SwitchAudioSourceMissingError,
  createSwitchAudioSourceBackend,
  getAudioDeviceState,
  switchAudioDevicePair,
} from "./audio";

type ViewState =
  | { status: "loading" }
  | { status: "missing-backend" }
  | { status: "error"; error: Error }
  | { status: "ready"; audio: AudioDeviceState; isRefreshing: boolean };

const AUDIO_DEVICE_STATE_CACHE_KEY = "audio-device-state";
const currentDeviceAccessory = [{ icon: { source: Icon.CheckCircle, tintColor: Color.Green } }];

export default function Command() {
  const [state, setState] = useState<ViewState>({ status: "loading" });

  async function reload({ preserveReadyState = false } = {}) {
    setState((previousState) =>
      preserveReadyState && previousState.status === "ready"
        ? { ...previousState, isRefreshing: true }
        : { status: "loading" },
    );

    try {
      const backend = await createSwitchAudioSourceBackend();
      const audio = await getAudioDeviceState(backend);
      setState({ status: "ready", audio, isRefreshing: false });
      void cacheAudioDeviceState(audio);
    } catch (error) {
      if (error instanceof SwitchAudioSourceMissingError) {
        setState({ status: "missing-backend" });
      } else {
        setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
      }
    }
  }

  useEffect(() => {
    async function loadCachedDevicesAndRefresh() {
      const cachedAudio = await getCachedAudioDeviceState();

      if (cachedAudio) {
        setState({ status: "ready", audio: cachedAudio, isRefreshing: true });
        void reload({ preserveReadyState: true });
      } else {
        void reload();
      }
    }

    void loadCachedDevicesAndRefresh();
  }, []);

  const isLoading = state.status === "loading" || (state.status === "ready" && state.isRefreshing);

  if (state.status === "missing-backend") {
    return (
      <List isLoading={false}>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="SwitchAudioSource is not installed"
          description="Install the required backend with: brew install switchaudio-osx"
        />
      </List>
    );
  }

  if (state.status === "error") {
    return (
      <List isLoading={false}>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Could not load audio devices"
          description={state.error.message}
        />
      </List>
    );
  }

  const audio = state.status === "ready" ? state.audio : undefined;

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search sound devices" filtering={{ keepSectionOrder: true }}>
      {audio?.isMixedCurrent ? (
        <List.Section
          title="Current Audio"
          subtitle={`Input: ${audio.currentInput ?? "Unknown"} | Output: ${audio.currentOutput ?? "Unknown"}`}
        />
      ) : null}

      <List.Section title="Unified Devices" subtitle={`${audio?.pairs.length ?? 0} devices`}>
        {audio?.pairs.map((pair) => (
          <List.Item
            key={`unified:${pair.id}`}
            title={pair.displayName}
            subtitle={`${pair.inputName} + ${pair.outputName}`}
            accessories={pair.isCurrent ? currentDeviceAccessory : undefined}
            actions={
              <ActionPanel>
                <Action
                  title="Switch Input and Output"
                  icon={Icon.ArrowClockwise}
                  onAction={async () => {
                    const toast = await showToast({
                      style: Toast.Style.Animated,
                      title: `Switching to ${pair.displayName}`,
                    });

                    try {
                      const backend = await createSwitchAudioSourceBackend();
                      await switchAudioDevicePair(backend, pair, audio.currentInput, audio.currentOutput);
                      const updatedAudio = markAudioPairCurrent(audio, pair.id);
                      setState({ status: "ready", audio: updatedAudio, isRefreshing: false });
                      void cacheAudioDeviceState(updatedAudio);
                      toast.style = Toast.Style.Success;
                      toast.title = `Switched to ${pair.displayName}`;
                      await closeMainWindow({ clearRootSearch: true });
                    } catch (error) {
                      toast.style = Toast.Style.Failure;
                      toast.title = `Could not switch to ${pair.displayName}`;
                      toast.message = error instanceof Error ? error.message : String(error);
                    }
                  }}
                />
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={() => void reload()} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>

      <List.Section title="Outputs" subtitle={`${audio?.outputDevices.length ?? 0} devices`}>
        {audio?.outputDevices.map((device) => (
          <List.Item
            key={`output:${device}`}
            title={device}
            accessories={device === audio.currentOutput ? currentDeviceAccessory : undefined}
            actions={
              <ActionPanel>
                <Action
                  title="Switch Output"
                  icon={Icon.ArrowClockwise}
                  onAction={() => void switchSingleAudioDevice(audio, "output", device)}
                />
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={() => void reload()} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>

      <List.Section title="Inputs" subtitle={`${audio?.inputDevices.length ?? 0} devices`}>
        {audio?.inputDevices.map((device) => (
          <List.Item
            key={`input:${device}`}
            title={device}
            accessories={device === audio.currentInput ? currentDeviceAccessory : undefined}
            actions={
              <ActionPanel>
                <Action
                  title="Switch Input"
                  icon={Icon.ArrowClockwise}
                  onAction={() => void switchSingleAudioDevice(audio, "input", device)}
                />
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={() => void reload()} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );

  async function switchSingleAudioDevice(audio: AudioDeviceState, type: DeviceType, device: string) {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Switching ${type} to ${device}`,
    });

    try {
      const backend = await createSwitchAudioSourceBackend();
      await backend.setDevice(type, device);
      const updatedAudio = markSingleAudioDeviceCurrent(audio, type, device);
      setState({ status: "ready", audio: updatedAudio, isRefreshing: false });
      void cacheAudioDeviceState(updatedAudio);
      toast.style = Toast.Style.Success;
      toast.title = `Switched ${type} to ${device}`;
      await closeMainWindow({ clearRootSearch: true });
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = `Could not switch ${type} to ${device}`;
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }
}

async function getCachedAudioDeviceState(): Promise<AudioDeviceState | undefined> {
  const cached = await LocalStorage.getItem<string>(AUDIO_DEVICE_STATE_CACHE_KEY);
  if (!cached) return undefined;

  try {
    const audio = JSON.parse(cached) as AudioDeviceState;
    return isAudioDeviceState(audio) ? audio : undefined;
  } catch {
    return undefined;
  }
}

async function cacheAudioDeviceState(audio: AudioDeviceState) {
  await LocalStorage.setItem(AUDIO_DEVICE_STATE_CACHE_KEY, JSON.stringify(audio));
}

function isAudioDeviceState(value: unknown): value is AudioDeviceState {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<AudioDeviceState>;
  return (
    Array.isArray(candidate.pairs) &&
    candidate.pairs.every(isAudioDevicePair) &&
    Array.isArray(candidate.inputDevices) &&
    candidate.inputDevices.every((device) => typeof device === "string") &&
    Array.isArray(candidate.outputDevices) &&
    candidate.outputDevices.every((device) => typeof device === "string")
  );
}

function isAudioDevicePair(value: unknown) {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.inputName === "string" &&
    typeof candidate.outputName === "string" &&
    typeof candidate.isCurrent === "boolean"
  );
}

function markAudioPairCurrent(audio: AudioDeviceState, pairId: string): AudioDeviceState {
  const pairs = audio.pairs.map((pair) => ({ ...pair, isCurrent: pair.id === pairId }));
  const currentPair = pairs.find((pair) => pair.id === pairId);

  return {
    ...audio,
    pairs,
    currentInput: currentPair?.inputName,
    currentOutput: currentPair?.outputName,
    currentPair,
    isMixedCurrent: false,
  };
}

function markSingleAudioDeviceCurrent(audio: AudioDeviceState, type: DeviceType, device: string): AudioDeviceState {
  const currentInput = type === "input" ? device : audio.currentInput;
  const currentOutput = type === "output" ? device : audio.currentOutput;
  const pairs = audio.pairs.map((pair) => ({
    ...pair,
    isCurrent: pair.inputName === currentInput && pair.outputName === currentOutput,
  }));
  const currentPair = pairs.find((pair) => pair.isCurrent);

  return {
    ...audio,
    pairs,
    currentInput,
    currentOutput,
    currentPair,
    isMixedCurrent: Boolean(currentInput && currentOutput && !currentPair),
  };
}
