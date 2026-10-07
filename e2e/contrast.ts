/** WCAG's relative luminance of a computed `rgb()` color. */
export function luminance(color: string): number {
  const channels = /^rgba?\((\d+), (\d+), (\d+)/.exec(color)?.slice(1);
  if (!channels) throw new Error(`Not an rgb() color: ${color}`);
  const [r = 0, g = 0, b = 0] = channels.map((channel) => {
    const c = Number(channel) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG's contrast ratio between two computed `rgb()` colors. */
export function contrast(one: string, other: string): number {
  const [light, dark] = [luminance(one), luminance(other)].sort(
    (a, b) => b - a,
  );
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}
