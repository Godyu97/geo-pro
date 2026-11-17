import { expect, type Page } from "@playwright/test";

export async function expectTextContrast(page: Page) {
  const ratios = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is required for color conversion");
    function luminance(variable: string) {
      if (!context) throw new Error("Missing color context");
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = style.getPropertyValue(variable).trim();
      context.fillRect(0, 0, 1, 1);
      const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map((value) => {
        const component = value / 255;
        return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    }
    return [
      ["--foreground", "--background"], ["--muted-foreground", "--card"],
      ["--muted-foreground", "--background"], ["--primary-foreground", "--primary"],
      ["--secondary-foreground", "--secondary"], ["--destructive", "--card"],
      ["--sidebar-foreground", "--sidebar"],
    ].map(([foreground, background]) => {
      const a = luminance(foreground), b = luminance(background);
      return { foreground, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
  });
  for (const result of ratios) expect(result.ratio, `${result.foreground} on ${result.background}`).toBeGreaterThanOrEqual(4.5);
}
