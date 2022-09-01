import last from 'it-last'
import pipe from 'it-pipe'

import { CarWriter } from '@ipld/car'
import {importer, ImportResult} from 'ipfs-unixfs-importer'
import { getNormaliser } from './utils/normalise-input'
import type { ImportCandidateStream, ImportCandidate } from 'ipfs-core-types/src/utils'
import type { MultihashHasher } from 'multiformats/hashes/interface'
export type { ImportCandidateStream }

import { Blockstore } from '../blockstore'
import { MemoryBlockStore } from '../blockstore/memory'
import { unixfsImporterOptionsDefault } from './constants'
import { CIDVersion } from 'multiformats/cid'

export interface PackProperties {
  input: ImportCandidateStream | ImportCandidate,
  blockstore?: Blockstore,
  cidVersion?: CIDVersion;
  maxChunkSize?: number,
  maxChildrenPerNode?: number,
  wrapWithDirectory?: boolean,
  hasher?: MultihashHasher,
  customStreamSink?: (sources: AsyncGenerator<ImportResult, void, unknown>) => AsyncGenerator<any, void, unknown>
  /**
   * Use raw codec for leaf nodes. Default: true.
   */
  rawLeaves?: boolean
}

export async function pack ({ input, blockstore: userBlockstore, cidVersion, hasher, maxChunkSize, maxChildrenPerNode, wrapWithDirectory, rawLeaves }: PackProperties) {
  if (!input || (Array.isArray(input) && !input.length)) {
    throw new Error('missing input file(s)')
  }

  const blockstore = userBlockstore ? userBlockstore : new MemoryBlockStore()

  // Consume the source
  const rootEntry = await last(pipe(
    getNormaliser(input),
    (source: any) => importer(source, blockstore, {
      ...unixfsImporterOptionsDefault,
      cidVersion: cidVersion !== undefined ? cidVersion : unixfsImporterOptionsDefault.cidVersion,
      hasher: hasher || unixfsImporterOptionsDefault.hasher,
      maxChunkSize: maxChunkSize || unixfsImporterOptionsDefault.maxChunkSize,
      maxChildrenPerNode: maxChildrenPerNode || unixfsImporterOptionsDefault.maxChildrenPerNode,
      wrapWithDirectory: wrapWithDirectory === false ? false : unixfsImporterOptionsDefault.wrapWithDirectory,
      rawLeaves: rawLeaves == null ? unixfsImporterOptionsDefault.rawLeaves : rawLeaves
    })
  ))

  if (!rootEntry || !rootEntry.cid) {
    throw new Error('given input could not be parsed correctly')
  }

  const root = rootEntry.cid
  const { writer, out: carOut } = await CarWriter.create([root])
  const carOutIter = carOut[Symbol.asyncIterator]()

  let writingPromise: Promise<void>
  const writeAll = async () => {
    for await (const block of blockstore.blocks()) {
      // `await` will block until all bytes in `carOut` are consumed by the user
      // so we have backpressure here
      await writer.put(block)
    }
    await writer.close()
    if (!userBlockstore) {
      await blockstore.close()
    }
  }

  const out: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator] () {
      if (writingPromise != null) {
        throw new Error('Multiple iterator not supported')
      }
      // don't start writing until the user starts consuming the iterator
      writingPromise = writeAll()
      return {
        async next () {
          const result = await carOutIter.next()
          if (result.done) {
            await writingPromise // any errors will propagate from here
          }
          return result
        }
      }
    }
  }

  return { root, out }
}
