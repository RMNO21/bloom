import { Palette, Droplet, Contrast, Droplets, Sun, Square, Maximize2, Moon, Sparkles, Box } from "lucide-react";
import { SettingRow } from "./SettingRow";

export interface AppearanceTabProps {
	themeMode: string;
	handleThemeModeChange: (mode: string) => void;
	themeColor: string;
	handleThemeColorChange: (color: string) => void;
	themeOpacity: number;
	handleOpacityChange: (val: number) => void;
	themeSaturation: number;
	handleSaturationChange: (val: number) => void;
	themeBrightness: number;
	handleBrightnessChange: (val: number) => void;
	cornersEnabled: boolean;
	toggleCorners: () => void;
	scale: number;
	handleScaleChange: (val: number) => void;
	zeroShadowMode?: boolean;
	toggleZeroShadowMode?: () => void;
	borderStyle?: string;
	handleBorderStyleChange?: (val: string) => void;
	blurStyle?: string;
	handleBlurStyleChange?: (val: string) => void;
	applyThemePreset?: (preset: any) => void;
}

const THEME_PRESETS = [
	{ name: "OLED Black", mode: "dark", color: "#000000", opacity: 0.98, zeroShadow: true, border: "subtle", blur: "oled", bg: "#000000" },
	{ name: "Midnight", mode: "dark", color: "#0d0f14", opacity: 0.85, zeroShadow: true, border: "subtle", blur: "acrylic", bg: "#0d0f14" },
	{ name: "Slate", mode: "dark", color: "#1e222b", opacity: 0.8, zeroShadow: true, border: "subtle", blur: "acrylic", bg: "#1e222b" },
	{ name: "Deep Navy", mode: "custom", color: "#0b1526", opacity: 0.88, zeroShadow: true, border: "subtle", blur: "acrylic", bg: "#0b1526" },
	{ name: "Cyber Violet", mode: "custom", color: "#180d2b", opacity: 0.88, zeroShadow: true, border: "subtle", blur: "acrylic", bg: "#180d2b" },
	{ name: "Light Frosted", mode: "light", color: "#f8fafc", opacity: 0.85, zeroShadow: true, border: "subtle", blur: "frosted", bg: "#f1f5f9" }
];

export function AppearanceTab({
	themeMode,
	handleThemeModeChange,
	themeColor,
	handleThemeColorChange,
	themeOpacity,
	handleOpacityChange,
	themeSaturation,
	handleSaturationChange,
	themeBrightness,
	handleBrightnessChange,
	cornersEnabled,
	toggleCorners,
	scale,
	handleScaleChange,
	zeroShadowMode = true,
	toggleZeroShadowMode,
	borderStyle = "subtle",
	handleBorderStyleChange,
	blurStyle = "acrylic",
	handleBlurStyleChange,
	applyThemePreset
}: AppearanceTabProps) {
	const showCustomColor = themeMode === "custom";
	const showAdvancedSliders = themeMode === "custom" || themeMode === "adaptive";

	return (
		<>
			<div className="setting-group-label">Quick Theme Presets</div>
			<div className="setting-group" style={{ padding: "12px 14px" }}>
				<div className="theme-presets-grid">
					{THEME_PRESETS.map((p) => (
						<button
							key={p.name}
							type="button"
							className="theme-preset-card"
							onClick={() => applyThemePreset?.(p)}
						>
							<span className="theme-preset-preview" style={{ background: p.bg }} />
							<span className="theme-preset-name">{p.name}</span>
						</button>
					))}
				</div>
			</div>

			<div className="setting-group-label setting-group-label--spaced">Visual Effects & Shadows</div>
			<div className="setting-group">
				<SettingRow
					icon={Moon}
					label="Zero Shadow Mode"
					desc="Completely eliminate shadows, halos, and glowing rings around notch and cards for a clean minimal look"
				>
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={zeroShadowMode}
							onChange={toggleZeroShadowMode}
						/>
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={Box}
					label="Card Border Style"
					desc="Thickness and appearance of borders around the notch and widgets"
				>
					<select
						className="settings-select"
						value={borderStyle}
						onChange={(e) => handleBorderStyleChange?.(e.target.value)}
					>
						<option value="subtle">Subtle (1px translucent)</option>
						<option value="fine">Hairline (0.5px ultra-thin)</option>
						<option value="none">Borderless (Seamless flat)</option>
						<option value="accent">Tinted Accent</option>
					</select>
				</SettingRow>

				<SettingRow
					icon={Sparkles}
					label="Translucency Effect"
					desc="Background material and blur style behind notch and dock"
					divider={false}
				>
					<select
						className="settings-select"
						value={blurStyle}
						onChange={(e) => handleBlurStyleChange?.(e.target.value)}
					>
						<option value="acrylic">Acrylic Glass (Deep Blur)</option>
						<option value="mica">Windows Mica Effect</option>
						<option value="oled">Pure Solid Black (Zero Blur)</option>
						<option value="frosted">Frosted Minimal</option>
					</select>
				</SettingRow>
			</div>

			<div className="setting-group-label setting-group-label--spaced">Color & Theme</div>
			<div className="setting-group">
				<SettingRow icon={Palette} label="Theme Mode" desc="Configure visual styling">
					<select
						className="settings-select"
						value={themeMode}
						onChange={(e) => handleThemeModeChange(e.target.value)}
					>
						<option value="dark">Dark (Translucent)</option>
						<option value="light">Light (Translucent)</option>
						<option value="custom">Custom Color</option>
						<option value="adaptive">Adaptive Accent</option>
					</select>
				</SettingRow>

				{showCustomColor && (
					<SettingRow
						icon={Droplet}
						label="Custom Theme Color"
						desc="Choose layout background color"
					>
						<div className="color-picker-row">
							<input
								type="color"
								value={themeColor}
								onChange={(e) => handleThemeColorChange(e.target.value)}
								className="color-picker-input"
							/>
							<span className="color-picker-label">{themeColor.toUpperCase()}</span>
						</div>
					</SettingRow>
				)}

				<SettingRow
					icon={Contrast}
					label="Background Opacity"
					desc={`Adjust theme transparency (${Math.round(themeOpacity * 100)}%)`}
					divider={showAdvancedSliders}
				>
					<input
						type="range"
						min="0.1"
						max="1.0"
						step="0.05"
						value={themeOpacity}
						onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
						className="settings-slider"
					/>
				</SettingRow>

				{showAdvancedSliders && (
					<>
						<SettingRow
							icon={Droplets}
							label="Color Saturation"
							desc={`Adjust theme color vibrancy (${Math.round(themeSaturation * 100)}%)`}
						>
							<input
								type="range"
								min="0.0"
								max="1.0"
								step="0.02"
								value={themeSaturation}
								onChange={(e) => handleSaturationChange(parseFloat(e.target.value))}
								className="settings-slider"
							/>
						</SettingRow>

						<SettingRow
							icon={Sun}
							label="Background Brightness"
							desc={`Adjust background lightness (${Math.round(themeBrightness * 100)}%)`}
							divider={false}
						>
							<input
								type="range"
								min="0.0"
								max="1.0"
								step="0.02"
								value={themeBrightness}
								onChange={(e) => handleBrightnessChange(parseFloat(e.target.value))}
								className="settings-slider"
							/>
						</SettingRow>
					</>
				)}
			</div>

			<div className="setting-group-label setting-group-label--spaced">Display & Layout</div>
			<div className="setting-group">
				<SettingRow icon={Square} label="Screen Corners" desc="Rounded top screen corners (macOS style)">
					<label className="toggle-switch">
						<input type="checkbox" checked={cornersEnabled} onChange={toggleCorners} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={Maximize2}
					label="UI & Font Scale"
					desc={`Adjust desktop size (${Math.round(scale * 100)}%)`}
					divider={false}
				>
					<div className="scale-button-container">
						<button
							onClick={() => handleScaleChange(Math.max(0.8, parseFloat((scale - 0.1).toFixed(1))))}
							disabled={scale <= 0.8}
							className="scale-adjust-btn"
							title="Decrease Scale"
						>
							—
						</button>
						<span className="scale-display-value">{Math.round(scale * 100)}%</span>
						<button
							onClick={() => handleScaleChange(Math.min(1.3, parseFloat((scale + 0.1).toFixed(1))))}
							disabled={scale >= 1.3}
							className="scale-adjust-btn"
							title="Increase Scale"
						>
							+
						</button>
					</div>
				</SettingRow>
			</div>
		</>
	);
}
