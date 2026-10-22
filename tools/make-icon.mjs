import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
const product = process.argv.includes('restaurant') ? 'restaurant' : 'pos'
const svg = readFileSync(`apps/${product}/build/icon.svg`, 'utf8'),
  sizes = [16, 24, 32, 48, 64, 128, 256]
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
})
try {
  const page = await browser.newPage(),
    images = []
  for (const size of sizes) {
    const png = await page.evaluate(
      async ({ svg, size }) => {
        const img = new Image()
        img.src = 'data:image/svg+xml;base64,' + btoa(svg)
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        canvas.getContext('2d').drawImage(img, 0, 0, size, size)
        return canvas.toDataURL('image/png').split(',')[1]
      },
      { svg, size },
    )
    images.push(Buffer.from(png, 'base64'))
  }
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((png, i) => {
    const at = 6 + i * 16
    header[at] = header[at + 1] = sizes[i] === 256 ? 0 : sizes[i]
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  writeFileSync(`apps/${product}/build/icon.ico`, Buffer.concat([header, ...images]))
  writeFileSync(`apps/${product}/build/icon.png`, images.at(-1))
  console.log('Created Xzare multi-resolution Windows icon')
} finally {
  await browser.close()
}
