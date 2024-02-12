import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { Entry } from '../yauzl-ts/Entry'
import type { ZipFile } from '../yauzl-ts/ZipFile'
import { fromBuffer } from '../yauzl-ts/inputProcessors'

export type UnzipOptions = {
  // ToDo, but I would start with making yauzl defaults non-configureable and see if there is demand for flexibility there
}

export type SourceType = string | File | Blob | Buffer | Readable

export type TargetFileMetadata = {
  fullPath: string
  fileSize: number
}

// ToDo
export type FileGenerator = Generator<Entry, void, void>

export async function unzipToFilesystem(
  source: SourceType,
  targetDir: string,
  options: UnzipOptions,
): Promise<TargetFileMetadata> {
  if (!Buffer.isBuffer(source)) {
    throw new Error('Only buffer is currently supported')
  }

  const fileWrites: Promise<void>[] = [] // Array to track file write promises

  const result = await new Promise((operationResolve, operationReject) => {
    return new Promise<ZipFile | undefined>((openResolve, openReject) => {
      fromBuffer(source, { lazyEntries: true }, (err, result) => {
        if (err) {
          return openReject(err)
        }
        openResolve(result)
      })
    }).then((zipfile) => {
      if (!zipfile) {
        return
      }

      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          // Directory: create if doesn't exist
          const directoryPath = join(targetDir, entry.fileName)
          void mkdir(directoryPath, { recursive: true })
            .then(() => {
              zipfile.readEntry()
            })
            .catch((err) => {
              operationReject(err)
            })
        } else {
          // File: extract
          zipfile.openReadStream(
            entry,
            { decrypt: entry.isEncrypted() ? false : undefined },
            (err, readStream) => {
              if (err) {
                operationReject(err)
                return
              }
              if (!readStream) {
                operationReject(new Error('No readstream'))
                return
              }

              const filePath = join(targetDir, entry.fileName)
              fileWrites.push(
                (async () => {
                  await mkdir(dirname(filePath), { recursive: true })
                  await pipeline(readStream, createWriteStream(filePath)) // Use pipeline for proper error handling
                })(),
              )

              readStream.on('end', () => {
                zipfile.readEntry()
              })
            },
          )
        }
      })

      zipfile.on('end', () => {
        // Wait for all file writes to complete
        void Promise.all(fileWrites)
          .then(() => {
            operationResolve(undefined)
          })
          .catch((err) => {
            operationReject(err)
          })
      })

      zipfile.on('error', (err) => {
        operationReject(err)
      })

      zipfile.readEntry()
    })
  })

  return {
    fullPath: 'dummy', // Adjust as needed
    fileSize: 444, // Adjust as needed
  }
}

/**
 * Used to iterate over multiple files in an archive
 */
export function unzipToReadableGenerator(
  source: SourceType,
  options: UnzipOptions,
): Promise<FileGenerator>

/**
 * Used to extract a single-file archive
 */
export function unzipToReadable(source: SourceType, options: UnzipOptions): Promise<Readable>

/**
 * Used to extract a single-file archive
 */
export function unzipToBuffer(source: SourceType, options: UnzipOptions): Promise<Buffer>

// TBD
// Do we need to support filters for extracting just a subset of files?
//