import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SWITCH_AUDIO_SOURCE_PATHS = [
  "/opt/homebrew/bin/SwitchAudioSource",
  "/usr/local/bin/SwitchAudioSource",
] as const;

export type DeviceType = "input" | "output";

export type AudioDevicePair = {
  id: string;
  displayName: string;
  inputName: string;
  outputName: string;
  isCurrent: boolean;
};

export type AudioDeviceState = {
  pairs: AudioDevicePair[];
  inputDevices: string[];
  outputDevices: string[];
  currentInput?: string;
  currentOutput?: string;
  currentPair?: AudioDevicePair;
  isMixedCurrent: boolean;
};

export class SwitchAudioSourceMissingError extends Error {
  constructor() {
    super("SwitchAudioSource is not installed");
    this.name = "SwitchAudioSourceMissingError";
  }
}

export class SwitchAudioSourceCommandError extends Error {
  constructor(
    readonly operation: string,
    readonly cause: unknown,
  ) {
    super(`SwitchAudioSource failed while trying to ${operation}`);
    this.name = "SwitchAudioSourceCommandError";
  }
}

type CommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export type AudioBackend = {
  listDevices(type: DeviceType): Promise<string[]>;
  getCurrentDevice(type: DeviceType): Promise<string | undefined>;
  setDevice(type: DeviceType, name: string): Promise<void>;
};

export async function createSwitchAudioSourceBackend(runner: CommandRunner = execFileAsync): Promise<AudioBackend> {
  const binary = await resolveSwitchAudioSource();

  async function run(args: string[]) {
    try {
      return await runner(binary, args);
    } catch (error) {
      throw new SwitchAudioSourceCommandError(args.join(" "), error);
    }
  }

  return {
    async listDevices(type) {
      const result = await run(["-a", "-t", type]);
      return parseDeviceList(result.stdout);
    },
    async getCurrentDevice(type) {
      const result = await run(["-c", "-t", type]);
      return parseDeviceList(result.stdout)[0];
    },
    async setDevice(type, name) {
      await run(["-s", name, "-t", type]);
    },
  };
}

export async function resolveSwitchAudioSource(envPath = process.env.PATH ?? ""): Promise<string> {
  for (const directory of envPath.split(delimiter).filter(Boolean)) {
    const candidate = `${directory}/SwitchAudioSource`;
    if (await canAccess(candidate)) return candidate;
  }

  for (const candidate of SWITCH_AUDIO_SOURCE_PATHS) {
    if (await canAccess(candidate)) return candidate;
  }

  throw new SwitchAudioSourceMissingError();
}

async function canAccess(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function parseDeviceList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeDeviceName(name: string): string {
  return name
    .replace(/\b(?:Microphone|Speakers|Speaker|Headphones|Headphone|Input|Output)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isVirtualDevice(name: string): boolean {
  return /\b(?:BlackHole|Soundflower|Loopback|VB-Cable|ZoomAudioDevice)\b/i.test(name);
}

export function buildAudioDeviceState(
  inputDevices: string[],
  outputDevices: string[],
  currentInput?: string,
  currentOutput?: string,
) {
  const outputsByNormalizedName = new Map<string, string>();

  for (const outputName of outputDevices) {
    const displayName = normalizeDeviceName(outputName);
    if (!displayName || isVirtualDevice(outputName) || isVirtualDevice(displayName)) continue;
    if (!outputsByNormalizedName.has(displayName)) {
      outputsByNormalizedName.set(displayName, outputName);
    }
  }

  const pairs: AudioDevicePair[] = [];
  const seenDisplayNames = new Set<string>();

  for (const inputName of inputDevices) {
    const displayName = normalizeDeviceName(inputName);
    const outputName = outputsByNormalizedName.get(displayName);

    if (!displayName || !outputName || seenDisplayNames.has(displayName)) continue;
    if (isVirtualDevice(inputName) || isVirtualDevice(displayName)) continue;

    pairs.push({
      id: displayName,
      displayName,
      inputName,
      outputName,
      isCurrent:
        normalizeDeviceName(currentInput ?? "") === displayName &&
        normalizeDeviceName(currentOutput ?? "") === displayName,
    });
    seenDisplayNames.add(displayName);
  }

  pairs.sort((left, right) => left.displayName.localeCompare(right.displayName));
  const sortedInputDevices = [...inputDevices].sort((left, right) => left.localeCompare(right));
  const sortedOutputDevices = [...outputDevices].sort((left, right) => left.localeCompare(right));

  const currentPair = pairs.find((pair) => pair.isCurrent);

  return {
    pairs,
    inputDevices: sortedInputDevices,
    outputDevices: sortedOutputDevices,
    currentInput,
    currentOutput,
    currentPair,
    isMixedCurrent: Boolean(
      currentInput && currentOutput && normalizeDeviceName(currentInput) !== normalizeDeviceName(currentOutput),
    ),
  } satisfies AudioDeviceState;
}

export async function getAudioDeviceState(backend: AudioBackend): Promise<AudioDeviceState> {
  const [inputDevices, outputDevices, currentInput, currentOutput] = await Promise.all([
    backend.listDevices("input"),
    backend.listDevices("output"),
    backend.getCurrentDevice("input"),
    backend.getCurrentDevice("output"),
  ]);

  return buildAudioDeviceState(inputDevices, outputDevices, currentInput, currentOutput);
}

export async function switchAudioDevicePair(
  backend: AudioBackend,
  pair: AudioDevicePair,
  previousInput?: string,
  previousOutput?: string,
) {
  try {
    await backend.setDevice("output", pair.outputName);
    await backend.setDevice("input", pair.inputName);
  } catch (error) {
    await rollbackAudioDevices(backend, previousInput, previousOutput);
    throw error;
  }
}

async function rollbackAudioDevices(backend: AudioBackend, previousInput?: string, previousOutput?: string) {
  await Promise.allSettled([
    previousOutput ? backend.setDevice("output", previousOutput) : Promise.resolve(),
    previousInput ? backend.setDevice("input", previousInput) : Promise.resolve(),
  ]);
}
