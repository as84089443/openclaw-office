import { access, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_OUTPUT_DIR,
  DEFAULT_MERCHANT_BRAND_NAME,
  PROJECT_ROOT,
  ensureDir,
  getArgValue,
  hasFlag,
  resolveMerchantBrandName,
  runCommand,
  upsertEnvFile,
} from './superfish-utils.mjs'

const MENU_WIDTH = 2500
const MENU_HEIGHT = 1686
const MAX_BYTES = 1024 * 1024
const SVG_FALLBACK_SOURCE = join(PROJECT_ROOT, 'public', 'line', 'merchant-rich-menu.svg')
function buildImagePrompt(brandName) {
  return [
    `Create a mobile-first LINE Official Account rich menu background for a restaurant SaaS named ${brandName}.`,
    'Use a clean neon futuristic restaurant operations aesthetic.',
    'Design four clear quadrants in a 2x2 layout with strong visual separation and large icon-led UI tiles.',
    'Top left represents 待審核 with approval/check motifs.',
    'Top right represents 顧客資訊 with customer cards and profile motifs.',
    'Bottom left represents 店家設定 with schedule/settings/storefront motifs.',
    'Bottom right represents 本週摘要 with charts/weekly digest motifs.',
    'Use cyan, lime, amber, and orange as primary accents on a dark but not muddy background.',
    'Avoid photoreal human faces, avoid watermark, avoid long paragraphs of text, avoid extra logos.',
    'Leave each quadrant readable at phone size with big shapes and low clutter.',
  ].join(' ')
}

async function generateSourceImage(sourcePath, prompt, explicitSourcePath = null) {
  if (explicitSourcePath) {
    await access(explicitSourcePath)
    return {
      sourcePath: explicitSourcePath,
      sourceKind: 'local-file',
      openAiUsed: false,
    }
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return {
      sourcePath: SVG_FALLBACK_SOURCE,
      sourceKind: 'fallback-svg',
      openAiUsed: false,
    }
  }

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size: '1536x1024',
      quality: 'medium',
      output_format: 'jpeg',
      output_compression: 70,
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || `${response.status} ${response.statusText}`
    throw new Error(`OpenAI image generation failed: ${detail}`)
  }

  const imageBase64 = data?.data?.[0]?.b64_json
  if (!imageBase64) {
    throw new Error('OpenAI image generation returned no image payload')
  }

  await writeFile(sourcePath, Buffer.from(imageBase64, 'base64'))
  return {
    sourcePath,
    sourceKind: 'openai-image',
    openAiUsed: true,
  }
}

async function compressToLineImage(sourcePath, outputPath) {
  const qualitySteps = ['75', '65', '55', '45', '35']
  let lastSize = null

  for (const quality of qualitySteps) {
    await runCommand('sips', [
      '-z',
      String(MENU_HEIGHT),
      String(MENU_WIDTH),
      '-s',
      'format',
      'jpeg',
      '-s',
      'formatOptions',
      quality,
      sourcePath,
      '--out',
      outputPath,
    ])

    const info = await stat(outputPath)
    lastSize = info.size
    if (info.size <= MAX_BYTES) {
      return {
        outputPath,
        outputBytes: info.size,
        format: 'jpeg',
        quality: Number(quality),
      }
    }
  }

  throw new Error(`Unable to compress rich menu asset below 1MB. Last size: ${lastSize}`)
}

export async function generateSuperfishRichMenu({ writeEnv = false, sourcePath = null } = {}) {
  await ensureDir(DEFAULT_OUTPUT_DIR)
  const brandName = resolveMerchantBrandName()
  const prompt = buildImagePrompt(brandName || DEFAULT_MERCHANT_BRAND_NAME)
  const sourceImagePath = join(DEFAULT_OUTPUT_DIR, 'merchant-rich-menu.source.jpg')
  const outputImagePath = join(DEFAULT_OUTPUT_DIR, 'merchant-rich-menu.jpg')
  const outputBase64Path = join(DEFAULT_OUTPUT_DIR, 'merchant-rich-menu.base64.txt')
  const metaPath = join(DEFAULT_OUTPUT_DIR, 'merchant-rich-menu.json')

  const source = await generateSourceImage(sourceImagePath, prompt, sourcePath)
  const compressed = await compressToLineImage(source.sourcePath, outputImagePath)
  const outputBuffer = await readFile(outputImagePath)
  const imageBase64 = outputBuffer.toString('base64')

  await writeFile(outputBase64Path, imageBase64, 'utf8')
  await writeFile(
    metaPath,
    JSON.stringify(
      {
        brandName,
        prompt,
        sourceKind: source.sourceKind,
        openAiUsed: source.openAiUsed,
        imagePath: outputImagePath,
        base64Path: outputBase64Path,
        outputBytes: compressed.outputBytes,
        format: compressed.format,
        quality: compressed.quality,
        width: MENU_WIDTH,
        height: MENU_HEIGHT,
      },
      null,
      2,
    ),
    'utf8',
  )

  if (writeEnv) {
    await upsertEnvFile({
      LINE_RICH_MENU_IMAGE_BASE64: '',
      FNB_LINE_RICH_MENU_IMAGE_BASE64: '',
      FNB_LINE_RICH_MENU_IMAGE_BASE64_PATH: outputBase64Path,
    })
  }

  return {
    ok: true,
    brandName,
    prompt,
    sourceKind: source.sourceKind,
    openAiUsed: source.openAiUsed,
    imagePath: outputImagePath,
    base64Path: outputBase64Path,
    outputBytes: compressed.outputBytes,
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
  }
}

async function main() {
  const requestedWriteEnv = hasFlag('--write-env') || getArgValue('--write-env') === 'true'
  const sourcePath = getArgValue('--source')
  const result = await generateSuperfishRichMenu({ writeEnv: requestedWriteEnv, sourcePath })
  console.log(JSON.stringify(result, null, 2))
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
