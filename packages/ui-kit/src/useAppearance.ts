import { useEffect, useState } from "react";
import { applyAppearance, loadAppearance, saveAppearance, watchSystemTheme, type Appearance } from "./appearance";

/** The app's theme and display style: applied to the page, remembered, and kept in
 *  step with the system while following it. */
export function useAppearance(): [Appearance, (appearance: Appearance) => void] {
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);
  useEffect(() => {
    applyAppearance(appearance);
    saveAppearance(appearance);
    if (appearance.theme !== "system") return;
    return watchSystemTheme(() => applyAppearance(appearance));
  }, [appearance]);
  return [appearance, setAppearance];
}
