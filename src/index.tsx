import {
  ButtonItem,
  definePlugin,
  DialogButton,
  PanelSection,
  PanelSectionRow,
  ServerAPI,
  SliderField,
  staticClasses,
  ToggleField,
} from "decky-frontend-lib";
import { useEffect, useState, VFC } from "react";
import { FaFastForward } from "react-icons/fa";

// Speed presets (multiplier values)
const SPEED_PRESETS = [
  { label: "0.25x (Slow)", value: 0.25 },
  { label: "0.5x (Half)", value: 0.5 },
  { label: "1x (Normal)", value: 1.0 },
  { label: "2x (Fast)", value: 2.0 },
  { label: "4x (Faster)", value: 4.0 },
  { label: "8x (Insane)", value: 8.0 },
];

interface SpeedHackContentProps {
  serverAPI: ServerAPI;
}

const SpeedHackContent: VFC<SpeedHackContentProps> = ({ serverAPI }) => {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1.0);
  const [status, setStatus] = useState<string>("Idle");

  // Load persisted state on mount
  useEffect(() => {
    (async () => {
      const result = await serverAPI.callPluginMethod<{}, { enabled: boolean; speed: number }>(
        "get_state",
        {}
      );
      if (result.success) {
        setEnabled(result.result.enabled);
        setSpeedMultiplier(result.result.speed);
      }
    })();
  }, []);

  const applySpeed = async (newSpeed: number, newEnabled: boolean) => {
    setStatus("Applying...");
    const result = await serverAPI.callPluginMethod<
      { enabled: boolean; speed: number },
      { message: string }
    >("set_speed", { enabled: newEnabled, speed: newSpeed });

    if (result.success) {
      setStatus(result.result.message);
    } else {
      setStatus("Error: " + result.result);
    }
  };

  const handleToggle = async (val: boolean) => {
    setEnabled(val);
    await applySpeed(speedMultiplier, val);
  };

  const handleSlider = async (val: number) => {
    // Slider value 1-32, map to 0.25-8.0
    const mapped = parseFloat((val * 0.25).toFixed(2));
    setSpeedMultiplier(mapped);
    if (enabled) {
      await applySpeed(mapped, true);
    }
  };

  const handlePreset = async (value: number) => {
    setSpeedMultiplier(value);
    if (enabled) {
      await applySpeed(value, true);
    }
  };

  // Convert speed multiplier to slider position (1-32 range, step 0.25)
  const sliderValue = Math.round(speedMultiplier / 0.25);

  return (
    <>
      <PanelSection title="Speed Control">
        <PanelSectionRow>
          <ToggleField
            label="Enable Speed Hack"
            description={`Status: ${status}`}
            checked={enabled}
            onChange={handleToggle}
          />
        </PanelSectionRow>

        <PanelSectionRow>
          <SliderField
            label={`Speed: ${speedMultiplier}x`}
            description="Adjust game speed multiplier"
            value={sliderValue}
            min={1}
            max={32}
            step={1}
            disabled={!enabled}
            onChange={handleSlider}
            notchCount={5}
            notchLabels={[
              { notchIndex: 1, label: "0.25x" },
              { notchIndex: 4, label: "1x" },
              { notchIndex: 8, label: "2x" },
              { notchIndex: 16, label: "4x" },
              { notchIndex: 32, label: "8x" },
            ]}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Presets">
        {SPEED_PRESETS.map((preset) => (
          <PanelSectionRow key={preset.value}>
            <ButtonItem
              layout="below"
              onClick={() => handlePreset(preset.value)}
              disabled={!enabled}
            >
              {preset.label}
            </ButtonItem>
          </PanelSectionRow>
        ))}
      </PanelSection>

      <PanelSection title="Setup">
        <PanelSectionRow>
          <DialogButton
            onClick={async () => {
              const result = await serverAPI.callPluginMethod<{}, { message: string }>(
                "install_library",
                {}
              );
              setStatus(result.success ? result.result.message : "Install failed");
            }}
          >
            Build & Install Library
          </DialogButton>
        </PanelSectionRow>
        <PanelSectionRow>
          <DialogButton
            onClick={async () => {
              const result = await serverAPI.callPluginMethod<{}, { message: string }>(
                "get_launch_option",
                {}
              );
              setStatus(result.success ? result.result.message : "Failed");
            }}
          >
            Show Launch Option
          </DialogButton>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};

export default definePlugin((serverApi: ServerAPI) => {
  return {
    title: <div className={staticClasses.Title}>SpeedHack</div>,
    content: <SpeedHackContent serverAPI={serverApi} />,
    icon: <FaFastForward />,
    onDismount() {
      // Nothing to clean up
    },
  };
});
