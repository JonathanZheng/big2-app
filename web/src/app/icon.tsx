import { ImageResponse } from "next/og";
import { Mark } from "@/components/app-mark";

// Home screen and browser tab icons, drawn in the app's Swiss brutal style.
export function generateImageMetadata() {
  return [32, 192, 512].map((size) => ({
    id: String(size),
    size: { width: size, height: size },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const size = Number(await id);
  return new ImageResponse(<Mark size={size} />, { width: size, height: size });
}
