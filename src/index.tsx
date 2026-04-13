import {
  ButtonItem,
  DialogButton,
  PanelSection,
  PanelSectionRow,
  ServerAPI,
  SliderField,
  staticClasses,
  ToggleField,
} from "decky-frontend-lib";
import React, { useEffect, useState, VFC } from "react";
import { FaFastForward } from "react-icons/fa";

const SPEED_PRESETS = [
  { label: "0.25x (Slow)", value: 0.25 },
  { label: "0.5x (Half)", value: 0.5 },
  { label: "1x (Normal)", value: 1.0 },
  { label: "2x (Fast)", value: 2.0 },
  { label: "4x (Faster)", value: 4.0 },
  { label: "8x (Insane)", value: 8.0 },
];

// Inline style for the launch option box
const launchBoxStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.07)",
  borderRadius: "4px",
  padding: "8px",
  fontSize: "11px",
  fontFamily: "monospace",
  wordBreak: "break-all",
  lineHeight: "1.5",
  color: "#c6d4df",
  userSelect: "text",
  marginTop: "4px",
};

interface SpeedHackContentProps {
  serverAPI: ServerAPI;
}

const SpeedHackContent: VFC<SpeedHackContentProps> = ({ serverAPI }) => {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1.0);
  const [speedStatus, setSpeedStatus] = useState<string>("Idle");
  const [launchOption, setLaunchOption] = useState<string>("");
  const [buildStatus, setBuildStatus] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [diagnostics, setDiagnostics] = useState<string>("");

  // Load persisted state and launch option on mount
  useEffect(() => {
    (async () => {
      const stateResult = await serverAPI.callPluginMethod<{}, { enabled: boolean; speed: number }>(
        "get_state", {}
      );
      if (stateResult.success) {
        setEnabled(stateResult.result.enabled);
        setSpeedMultiplier(stateResult.result.speed);
      }

      // Pre-load the launch option so it's always visible
      const launchResult = await serverAPI.callPluginMethod<{}, { message: string }>(
        "get_launch_option", {}
      );
      if (launchResult.success) {
        setLaunchOption(launchResult.result.message);
      }
    })();
  }, []);

  const applySpeed = async (newSpeed: number, newEnabled: boolean) => {
    setSpeedStatus("Applying...");
    const result = await serverAPI.callPluginMethod<
      { enabled: boolean; speed: number },
      { message: string }
    >("set_speed", { enabled: newEnabled, speed: newSpeed });
    setSpeedStatus(result.success ? result.result.message : "Error: " + result.result);
  };

  const handleToggle = async (val: boolean) => {
    setEnabled(val);
    await applySpeed(speedMultiplier, val);
  };

  const handleSlider = async (val: number) => {
    const mapped = parseFloat((val * 0.25).toFixed(2));
    setSpeedMultiplier(mapped);
    if (enabled) await applySpeed(mapped, true);
  };

  const handlePreset = async (value: number) => {
    setSpeedMultiplier(value);
    if (enabled) await applySpeed(value, true);
  };

  const handleBuild = async () => {
    setBuildStatus("Building...");
    const result = await serverAPI.callPluginMethod<{}, { message: string }>(
      "install_library", {}
    );
    const msg = result.success ? result.result.message : "Build failed";
    setBuildStatus(msg);

    // Refresh launch option after build
    const launchResult = await serverAPI.callPluginMethod<{}, { message: string }>(
      "get_launch_option", {}
    );
    if (launchResult.success) setLaunchOption(launchResult.result.message);
  };

  const sliderValue = Math.round(speedMultiplier / 0.25);

  return (
    <>
      <PanelSection title="Speed Control">
        <PanelSectionRow>
          <ToggleField
            label="Enable Speed Hack"
            description={speedStatus}
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
              { notchIndex: 1,  label: "0.25x" },
              { notchIndex: 4,  label: "1x"    },
              { notchIndex: 8,  label: "2x"    },
              { notchIndex: 16, label: "4x"    },
              { notchIndex: 32, label: "8x"    },
            ]}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Presets">
        {SPEED_PRESETS.map((preset) => (
          <PanelSectionRow key={preset.value}>
            <ButtonItem
              label={preset.label}
              layout="below"
              onClick={() => handlePreset(preset.value)}
              disabled={!enabled}
            />
          </PanelSectionRow>
        ))}
      </PanelSection>

      <PanelSection title="Setup">
        {/* Launch option box */}
        <PanelSectionRow>
          <div style={{ width: "100%" }}>
            <div style={{ fontSize: "12px", marginBottom: "4px", color: "#8b929a" }}>
              Steam Launch Option
            </div>
            <div style={launchBoxStyle}>
              {launchOption
                ? launchOption
                : "Library not built yet — click Build below"}
            </div>
            <div style={{ fontSize: "11px", color: "#8b929a", marginTop: "4px" }}>
              Paste into: Library → game → Properties → Launch Options
            </div>
          </div>
        </PanelSectionRow>

        {/* Copy button — only shown when the library exists */}
        {launchOption && !launchOption.startsWith("Library") && (
          <PanelSectionRow>
            {React.createElement(DialogButton as React.ElementType, {
              onClick: async () => {
                await navigator.clipboard.writeText(launchOption);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              },
            }, copied ? "Copied!" : "Copy Launch Option")}
          </PanelSectionRow>
        )}

        <PanelSectionRow>
          {React.createElement(DialogButton as React.ElementType, {
            onClick: handleBuild,
          }, "Build / Rebuild Library")}
        </PanelSectionRow>

        {buildStatus !== "" && (
          <PanelSectionRow>
            <div style={{ fontSize: "11px", color: "#8b929a", wordBreak: "break-all" }}>
              {buildStatus}
            </div>
          </PanelSectionRow>
        )}

        <PanelSectionRow>
          {React.createElement(DialogButton as React.ElementType, {
            onClick: async () => {
              setDiagnostics("Checking...");
              const result = await serverAPI.callPluginMethod<{}, { message: string }>(
                "get_diagnostics", {}
              );
              setDiagnostics(result.success ? result.result.message : "Failed");
            },
          }, "Run Diagnostics")}
        </PanelSectionRow>

        {diagnostics !== "" && (
          <PanelSectionRow>
            <div style={{ ...launchBoxStyle, fontSize: "10px", whiteSpace: "pre-wrap" }}>
              {diagnostics}
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>
    </>
  );
};

export default (serverApi: ServerAPI) => ({
  title: React.createElement("div", { className: staticClasses.Title }, "SpeedHack"),
  content: React.createElement(SpeedHackContent, { serverAPI: serverApi }),
  icon: React.createElement(FaFastForward, null),
  onDismount() {},
});
