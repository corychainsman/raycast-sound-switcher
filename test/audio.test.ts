import { describe, expect, it, vi } from "vitest";
import {
  AudioBackend,
  buildAudioDeviceState,
  normalizeDeviceName,
  parseDeviceList,
  switchAudioDevicePair,
} from "../src/audio";

describe("parseDeviceList", () => {
  it("trims blank lines from SwitchAudioSource output", () => {
    expect(parseDeviceList("\nMacBook Air Microphone\nPoly Blackwire 3325 Series\n\n")).toEqual([
      "MacBook Air Microphone",
      "Poly Blackwire 3325 Series",
    ]);
  });
});

describe("normalizeDeviceName", () => {
  it("normalizes built-in and headphone endpoint suffixes", () => {
    expect(normalizeDeviceName("MacBook Air Microphone")).toBe("MacBook Air");
    expect(normalizeDeviceName("MacBook Air Speakers")).toBe("MacBook Air");
    expect(normalizeDeviceName("AirPods Pro 3 Headphones")).toBe("AirPods Pro 3");
  });
});

describe("buildAudioDeviceState", () => {
  const inputs = ["Poly Blackwire 3325 Series", "BlackHole 2ch", "MacBook Air Microphone"];
  const outputs = ["DELL U3415W", "Poly Blackwire 3325 Series", "BlackHole 2ch", "MacBook Air Speakers"];

  it("lists only non-virtual paired devices", () => {
    const state = buildAudioDeviceState(inputs, outputs, "MacBook Air Microphone", "MacBook Air Speakers");

    expect(state.pairs.map((pair) => pair.displayName)).toEqual(["MacBook Air", "Poly Blackwire 3325 Series"]);
  });

  it("keeps alphabetical order while marking the current paired device", () => {
    const state = buildAudioDeviceState(inputs, outputs, "Poly Blackwire 3325 Series", "Poly Blackwire 3325 Series");

    expect(state.pairs.map((pair) => pair.displayName)).toEqual(["MacBook Air", "Poly Blackwire 3325 Series"]);
    expect(state.pairs[1]).toMatchObject({
      displayName: "Poly Blackwire 3325 Series",
      isCurrent: true,
    });
    expect(state.currentPair?.displayName).toBe("Poly Blackwire 3325 Series");
  });

  it("marks mixed current devices without pinning partial devices", () => {
    const state = buildAudioDeviceState(inputs, outputs, "MacBook Air Microphone", "Poly Blackwire 3325 Series");

    expect(state.isMixedCurrent).toBe(true);
    expect(state.currentPair).toBeUndefined();
    expect(state.pairs.every((pair) => !pair.isCurrent)).toBe(true);
  });

  it("groups duplicate normalized names as one item using the first pair", () => {
    const state = buildAudioDeviceState(
      ["Studio Microphone", "Studio Input"],
      ["Studio Speakers", "Studio Output"],
      undefined,
      undefined,
    );

    expect(state.pairs).toHaveLength(1);
    expect(state.pairs[0]).toMatchObject({
      displayName: "Studio",
      inputName: "Studio Microphone",
      outputName: "Studio Speakers",
    });
  });
});

describe("switchAudioDevicePair", () => {
  it("sets output then input", async () => {
    const setDevice = vi.fn<AudioBackend["setDevice"]>().mockResolvedValue(undefined);
    const backend = createMockBackend(setDevice);

    await switchAudioDevicePair(
      backend,
      {
        id: "MacBook Air",
        displayName: "MacBook Air",
        inputName: "MacBook Air Microphone",
        outputName: "MacBook Air Speakers",
        isCurrent: false,
      },
      "Poly Blackwire 3325 Series",
      "Poly Blackwire 3325 Series",
    );

    expect(setDevice).toHaveBeenNthCalledWith(1, "output", "MacBook Air Speakers");
    expect(setDevice).toHaveBeenNthCalledWith(2, "input", "MacBook Air Microphone");
  });

  it("rolls back previous output and input when switching fails", async () => {
    const error = new Error("input failed");
    const setDevice = vi
      .fn<AudioBackend["setDevice"]>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const backend = createMockBackend(setDevice);

    await expect(
      switchAudioDevicePair(
        backend,
        {
          id: "MacBook Air",
          displayName: "MacBook Air",
          inputName: "MacBook Air Microphone",
          outputName: "MacBook Air Speakers",
          isCurrent: false,
        },
        "Poly Blackwire 3325 Series",
        "Poly Blackwire 3325 Series",
      ),
    ).rejects.toThrow("input failed");

    expect(setDevice).toHaveBeenCalledWith("output", "Poly Blackwire 3325 Series");
    expect(setDevice).toHaveBeenCalledWith("input", "Poly Blackwire 3325 Series");
  });
});

function createMockBackend(setDevice: AudioBackend["setDevice"]): AudioBackend {
  return {
    listDevices: vi.fn(),
    getCurrentDevice: vi.fn(),
    setDevice,
  };
}
