import type { Editor } from '../../dist/editor.js'
import tweet from './assets/tweet-challenge.png?inline'

// Built-in assets have stable document IDs, so saved demos remain portable.
export const imageAssets = { 'tweet-challenge': tweet } as const
export const tweetSize = { width: 1224, height: 248 } as const
export const registerImages = async (editor: Pick<Editor, 'registerImage'>): Promise<void> => {
  await Promise.all(
    Object.entries(imageAssets).map(async ([name, url]: readonly [string, string]) => {
      const response = await fetch(url)
      const bitmap = await createImageBitmap(await response.blob())
      try {
        editor.registerImage(name, bitmap)
      } finally {
        bitmap.close()
      }
    }),
  )
}
