export function scaleCoordinate(value: number, sourceSize: number, targetSize: number): number {
  if (sourceSize < 2 || targetSize < 2) throw new Error("Coordinate spaces must be at least 2 pixels.");
  return Math.round((value / (sourceSize - 1)) * (targetSize - 1));
}
