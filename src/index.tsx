import { Action, ActionPanel, closeMainWindow, Icon, List, LocalStorage, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import {
  AudioDeviceState,
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
    <List isLoading={isLoading} searchBarPlaceholder="Search paired sound devices">
      {audio?.isMixedCurrent ? (
        <List.Section
          title="Current Audio"
          subtitle={`Input: ${audio.currentInput ?? "Unknown"} | Output: ${audio.currentOutput ?? "Unknown"}`}
        />
      ) : null}

      <List.Section title="Devices">
        {audio?.pairs.map((pair) => (
          <List.Item
            key={pair.id}
            title={pair.displayName}
            subtitle={`${pair.inputName} + ${pair.outputName}`}
            accessories={pair.isCurrent ? [{ icon: Icon.CheckCircle, tooltip: "Current input and output" }] : undefined}
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
    </List>
  );
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
  return Array.isArray(candidate.pairs) && candidate.pairs.every(isAudioDevicePair);
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
