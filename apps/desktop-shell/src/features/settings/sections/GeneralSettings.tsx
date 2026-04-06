import { SettingGroup, SettingRow } from "../components/SettingGroup";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSettingsStore, type ThemeMode } from "@/state/settings-store";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
] as const;

export function GeneralSettings() {
  const theme = useSettingsStore((state) => state.theme);
  const fontSize = useSettingsStore((state) => state.fontSize);
  const language = useSettingsStore((state) => state.language);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const setFontSize = useSettingsStore((state) => state.setFontSize);
  const setLanguage = useSettingsStore((state) => state.setLanguage);

  const themes: { value: ThemeMode; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];

  const fontSizes = [12, 13, 14, 15, 16];

  return (
    <div className="space-y-4">
      <SettingGroup title="Appearance">
        <SettingRow label="Theme" description="Choose your preferred color scheme">
          <div className="flex gap-1">
            {themes.map((t) => (
              <Button
                key={t.value}
                variant={theme === t.value ? "default" : "outline"}
                size="sm"
                className="text-xs"
                onClick={() => setTheme(t.value)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label="Font Size" description="Editor and terminal font size">
          <div className="flex gap-1">
            {fontSizes.map((size) => (
              <Button
                key={size}
                variant={fontSize === size ? "default" : "outline"}
                size="sm"
                className={cn("w-10 text-xs")}
                onClick={() => setFontSize(size)}
              >
                {size}
              </Button>
            ))}
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup
        title="Language"
        description="Application display language"
      >
        <SettingRow label="Language">
          <div className="flex gap-1">
            {LANGUAGES.map((lang) => (
              <Button
                key={lang.value}
                variant={language === lang.value ? "default" : "outline"}
                size="sm"
                className="text-xs"
                onClick={() => setLanguage(lang.value)}
              >
                {lang.label}
              </Button>
            ))}
          </div>
        </SettingRow>
      </SettingGroup>
    </div>
  );
}
