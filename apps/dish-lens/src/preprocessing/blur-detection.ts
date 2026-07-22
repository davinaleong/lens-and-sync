import sharp from "sharp";

const LAPLACIAN_KERNEL = {
  width: 3,
  height: 3,
  kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
} as const;

/**
 * Variance of the Laplacian of the greyscaled image - a standard proxy for
 * focus/sharpness. Flat, blurry regions produce near-zero edge response
 * (low variance); crisp edges produce large swings (high variance).
 */
export async function laplacianVariance(imageBuffer: Buffer): Promise<number> {
  const { data } = await sharp(imageBuffer)
    .greyscale()
    .convolve(LAPLACIAN_KERNEL)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixelCount = data.length;
  if (pixelCount === 0) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < pixelCount; i++) {
    sum += data[i] ?? 0;
  }
  const mean = sum / pixelCount;

  let squaredDiffSum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const diff = (data[i] ?? 0) - mean;
    squaredDiffSum += diff * diff;
  }

  return squaredDiffSum / pixelCount;
}

export async function isBlurry(imageBuffer: Buffer, varianceThreshold: number): Promise<boolean> {
  const variance = await laplacianVariance(imageBuffer);
  return variance < varianceThreshold;
}
